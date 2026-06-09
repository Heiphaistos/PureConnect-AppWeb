import type { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { redis } from '../redis.js'
import type { AuthSession } from '../types.js'

const PUBLIC_PATHS = new Set(['/api/auth/login', '/health'])

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (PUBLIC_PATHS.has(req.url)) return

  // Cookie-only auth — no Authorization header fallback (dead code that widens attack surface)
  const token = req.cookies['session']
  if (!token) {
    reply.status(401).send({ error: 'Unauthorized' })
    return
  }

  let payload: { sessionId: string } & jwt.JwtPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET ?? '') as typeof payload
  } catch {
    reply.status(401).send({ error: 'Invalid token' })
    return
  }

  const raw = await redis.get(`session:${payload.sessionId}`)
  if (!raw) {
    reply.status(401).send({ error: 'Session expired' })
    return
  }

  const session: AuthSession = JSON.parse(raw)
  if (session.expiresAt < Date.now()) {
    await redis.del(`session:${payload.sessionId}`)
    reply.status(401).send({ error: 'Session expired' })
    return
  }
}
