import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import websocket from '@fastify/websocket'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { redis } from './redis.js'
import { authRoutes } from './routes/auth.js'
import { metricsRoutes } from './routes/metrics.js'
import { dockerRoutes } from './routes/docker.js'
import { pm2Routes } from './routes/pm2.js'
import { logsRoutes } from './routes/logs.js'
import { filesRoutes } from './routes/files.js'
import { consoleRoutes } from './routes/console.js'
import { startCollector } from './jobs/collector.js'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be set and at least 32 characters')
  process.exit(1)
}

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH
if (!ADMIN_PASSWORD_HASH || !ADMIN_PASSWORD_HASH.startsWith('$2')) {
  console.error('[FATAL] ADMIN_PASSWORD_HASH must be a valid bcrypt hash')
  process.exit(1)
}

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
  trustProxy: true,
})

await redis.connect()

await app.register(helmet, {
  // CSP volontairement désactivé : ce backend est une API JSON pure, il ne sert
  // jamais de HTML. Les autres headers helmet (X-Content-Type-Options, X-Frame-Options,
  // X-XSS-Protection, Referrer-Policy) restent actifs.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS : forcer HTTPS pour les futures connexions (1 an, inclut sous-domaines).
  // Activer uniquement si HTTPS est configuré (COOKIE_SECURE=true en prod).
  hsts: process.env.COOKIE_SECURE === 'true'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
})

await app.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
})

const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
  .split(',')
  .map((u) => u.trim())

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true)
    } else {
      cb(null, false)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
})

await app.register(cookie, {
  secret: JWT_SECRET,
})

await app.register(websocket, {
  options: {
    maxPayload: 1048576,
  },
})

app.get('/health', async () => ({ status: 'ok' }))

await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(metricsRoutes, { prefix: '/api/metrics' })
await app.register(dockerRoutes, { prefix: '/api/docker' })
await app.register(pm2Routes, { prefix: '/api/pm2' })
await app.register(filesRoutes, { prefix: '/api/files' })
await app.register(logsRoutes, { prefix: '/ws' })
await app.register(consoleRoutes, { prefix: '/ws' })

startCollector()

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })
console.info(`[VPSConnect] Backend listening on :${port}`)
