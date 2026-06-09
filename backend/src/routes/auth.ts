import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { redis } from '../redis.js'
import type { AuthSession } from '../types.js'

const SESSION_TTL = 60 * 60 * 24 // 24h

interface LoginBody {
  password: string
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Strict rate limit on login: 10 attempts / 15 minutes per IP
  app.post<{ Body: LoginBody }>('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          error: 'Too many login attempts. Try again in 15 minutes.',
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { password } = req.body
    const hash = process.env.ADMIN_PASSWORD_HASH ?? ''

    const valid = await bcrypt.compare(password, hash)
    if (!valid) {
      // Constant-time delay to mitigate timing attacks
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 200))
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const sessionId = randomUUID()
    const session: AuthSession = {
      sessionId,
      ip: req.ip,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL * 1000,
    }

    await redis.set(`session:${sessionId}`, JSON.stringify(session), 'EX', SESSION_TTL)

    const token = jwt.sign({ sessionId }, process.env.JWT_SECRET!, { expiresIn: '24h' })

    // COOKIE_SECURE=true only when HTTPS is active (set in .env)
    const secureCookie = process.env.COOKIE_SECURE === 'true'

    reply
      .setCookie('session', token, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'strict',
        maxAge: SESSION_TTL,
        path: '/',
      })
      .send({ ok: true })
  })

  app.post('/logout', async (req, reply) => {
    const token = req.cookies['session']
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sessionId: string }
        await redis.del(`session:${payload.sessionId}`)
      } catch { /* expired token — still clear the cookie */ }
    }
    const secureCookie = process.env.COOKIE_SECURE === 'true'
    reply
      .clearCookie('session', {
        path: '/',
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'strict',
      })
      .send({ ok: true })
  })

  app.get('/me', {
    config: {
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
  }, async (req, reply) => {
    const token = req.cookies['session']
    if (!token) return reply.status(401).send({ error: 'Not authenticated' })
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sessionId: string }
      const raw = await redis.get(`session:${payload.sessionId}`)
      if (!raw) return reply.status(401).send({ error: 'Session expired' })
      return reply.send({ authenticated: true, sessionId: payload.sessionId })
    } catch {
      return reply.status(401).send({ error: 'Invalid token' })
    }
  })
}
