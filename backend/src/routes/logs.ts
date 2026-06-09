import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { redis } from '../redis.js'
import { streamContainerLogs } from '../collectors/docker.js'
import { streamPm2Logs } from '../collectors/pm2.js'

// Docker container IDs: full 64-char hex or short 12-char hex
const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/i
// PM2 process names: alphanumeric, dashes, underscores
const PM2_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

async function isAuthenticated(token: string | undefined): Promise<boolean> {
  if (!token) return false
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sessionId: string }
    const session = await redis.get(`session:${payload.sessionId}`)
    return session !== null
  } catch {
    return false
  }
}

export const logsRoutes: FastifyPluginAsync = async (app) => {
  // Docker container log stream
  app.get<{ Params: { id: string } }>(
    '/logs/docker/:id',
    { websocket: true },
    async (connection: { socket: WebSocket }, req) => {
      // Auth via httpOnly cookie only — never accept token in URL (would appear in logs)
      const cookieToken = req.cookies?.['session']

      if (!(await isAuthenticated(cookieToken))) {
        connection.socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
        connection.socket.close(1008, 'Unauthorized')
        return
      }

      const { id } = req.params
      if (!CONTAINER_ID_RE.test(id)) {
        connection.socket.send(JSON.stringify({ type: 'error', message: 'Invalid container ID' }))
        connection.socket.close(1008, 'Invalid container ID')
        return
      }

      let stopped = false

      const stop = streamContainerLogs(
        id,
        (chunk) => {
          if (!stopped && connection.socket.readyState === 1) {
            connection.socket.send(JSON.stringify({ type: 'log', data: chunk }))
          }
        },
        () => {
          if (!stopped && connection.socket.readyState === 1) {
            connection.socket.send(JSON.stringify({ type: 'end' }))
          }
        },
      )

      connection.socket.on('close', () => {
        stopped = true
        stop()
      })

      connection.socket.on('error', () => {
        stopped = true
        stop()
      })
    },
  )

  // PM2 process log stream
  app.get<{ Params: { name: string } }>(
    '/logs/pm2/:name',
    { websocket: true },
    async (connection: { socket: WebSocket }, req) => {
      const cookieToken = req.cookies?.['session']

      if (!(await isAuthenticated(cookieToken))) {
        connection.socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
        connection.socket.close(1008, 'Unauthorized')
        return
      }

      const { name } = req.params
      if (!PM2_NAME_RE.test(name)) {
        connection.socket.send(JSON.stringify({ type: 'error', message: 'Invalid process name' }))
        connection.socket.close(1008, 'Invalid process name')
        return
      }

      let stopped = false
      let stopFn: (() => void) | null = null

      streamPm2Logs(
        name,
        (line) => {
          if (!stopped && connection.socket.readyState === 1) {
            connection.socket.send(JSON.stringify({ type: 'log', data: line }))
          }
        },
        () => {
          if (!stopped && connection.socket.readyState === 1) {
            connection.socket.send(JSON.stringify({ type: 'end' }))
          }
        },
      ).then((stop) => {
        stopFn = stop
      })

      connection.socket.on('close', () => {
        stopped = true
        stopFn?.()
      })

      connection.socket.on('error', () => {
        stopped = true
        stopFn?.()
      })
    },
  )
}
