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
import { startCollector } from './jobs/collector.js'

// Fail fast: JWT_SECRET must be set and strong enough
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

// Security headers (disable CSP — managed by Next.js frontend)
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
})

// Global rate limit (in-memory — simple and reliable)
await app.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
})

// CORS: accept comma-separated list of allowed origins
const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
  .split(',')
  .map((u) => u.trim())

await app.register(cors, {
  origin: (origin, cb) => {
    // Allow same-origin requests (no Origin header) and listed origins
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true)
    } else {
      // Reject without error — browser enforces CORS, server returns 200 without CORS headers
      cb(null, false)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE'],
})

await app.register(cookie, {
  secret: JWT_SECRET,
})

await app.register(websocket, {
  options: {
    maxPayload: 1048576,
  },
})

// Health check (no auth)
app.get('/health', async () => ({ status: 'ok', ts: Date.now() }))

// Auth routes (no auth middleware) — stricter rate limit applied inside
await app.register(authRoutes, { prefix: '/api/auth' })

// Protected routes — auth checked inside each plugin
await app.register(metricsRoutes, { prefix: '/api/metrics' })
await app.register(dockerRoutes, { prefix: '/api/docker' })
await app.register(pm2Routes, { prefix: '/api/pm2' })
await app.register(logsRoutes, { prefix: '/ws' })

// Start background metric collector
startCollector()

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })
console.info(`[VPSConnect] Backend listening on :${port}`)
