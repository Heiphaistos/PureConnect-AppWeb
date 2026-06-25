import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { redis } from '../redis.js'
import { streamContainerLogs } from '../collectors/docker.js'
import { streamPm2Logs } from '../collectors/pm2.js'

const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/i
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
    async (socket: WebSocket, req) => {
      const cookieToken = req.cookies?.['session']

      if (!(await isAuthenticated(cookieToken))) {
        socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
        socket.close(1008, 'Unauthorized')
        return
      }

      const { id } = req.params
      if (!CONTAINER_ID_RE.test(id)) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid container ID' }))
        socket.close(1008, 'Invalid container ID')
        return
      }

      let stopped = false

      const stop = streamContainerLogs(
        id,
        (chunk) => {
          if (!stopped && socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'log', data: chunk }))
          }
        },
        () => {
          if (!stopped && socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'end' }))
          }
        },
      )

      socket.on('close', () => { stopped = true; stop() })
      socket.on('error', () => { stopped = true; stop() })
    },
  )

  // PM2 process log stream
  app.get<{ Params: { name: string } }>(
    '/logs/pm2/:name',
    { websocket: true },
    async (socket: WebSocket, req) => {
      const cookieToken = req.cookies?.['session']

      if (!(await isAuthenticated(cookieToken))) {
        socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
        socket.close(1008, 'Unauthorized')
        return
      }

      const { name } = req.params
      if (!PM2_NAME_RE.test(name)) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid process name' }))
        socket.close(1008, 'Invalid process name')
        return
      }

      let stopped = false
      let stopFn: (() => void) | null = null

      streamPm2Logs(
        name,
        (line) => {
          if (!stopped && socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'log', data: line }))
          }
        },
        () => {
          if (!stopped && socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'end' }))
          }
        },
      ).then((stop) => { stopFn = stop })

      socket.on('close', () => { stopped = true; stopFn?.() })
      socket.on('error', () => { stopped = true; stopFn?.() })
    },
  )
}
