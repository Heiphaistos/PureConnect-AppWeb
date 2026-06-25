import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { redis } from '../redis.js'
import pty from 'node-pty'
import fs from 'node:fs'
import os from 'node:os'

const SHELL = process.env.SHELL ?? (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh')

// /etc est monté depuis le host — lire le vrai hostname du VPS
const VPS_HOSTNAME = (() => {
  try { return fs.readFileSync('/etc/hostname', 'utf8').trim() } catch { return os.hostname() }
})()

const MAX_MSG_BYTES = 4096

// Whitelist minimale — ne JAMAIS exposer JWT_SECRET / ADMIN_PASSWORD_HASH / REDIS_PASSWORD au terminal
const PTY_ENV: Record<string, string> = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  HOME: '/root',
  USER: 'root',
  LOGNAME: 'root',
  HOSTNAME: VPS_HOSTNAME,
  SHELL,
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  PM2_HOME: process.env.PM2_HOME ?? '/root/.pm2',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
}

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

export const consoleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/console', { websocket: true }, async (socket: WebSocket, req) => {
    const cookieToken = req.cookies?.['session']

    if (!(await isAuthenticated(cookieToken))) {
      socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
      socket.close(1008, 'Unauthorized')
      return
    }

    const ptyProcess = pty.spawn(SHELL, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: '/root',
      env: PTY_ENV,
    })

    ptyProcess.onData((data) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'data', data }))
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'exit', code: exitCode }))
        socket.close()
      }
    })

    socket.on('message', (raw) => {
      if (Buffer.byteLength(raw as Buffer) > MAX_MSG_BYTES) return
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; data?: string; cols?: number; rows?: number }
        if (msg.type === 'input' && msg.data !== undefined) {
          ptyProcess.write(msg.data)
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          ptyProcess.resize(
            Math.max(10, Math.min(500, Math.floor(msg.cols))),
            Math.max(5, Math.min(200, Math.floor(msg.rows))),
          )
        }
      } catch { /* ignore malformed messages */ }
    })

    socket.on('close', () => { try { ptyProcess.kill() } catch { /* already dead */ } })
    socket.on('error', () => { try { ptyProcess.kill() } catch { /* already dead */ } })
  })
}
