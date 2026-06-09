import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { cache } from '../jobs/collector.js'

export const pm2Routes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get('/processes', async (_req, reply) => {
    // Strip server-side filesystem paths before sending to client
    const processes = cache.processes.map(({ logFile: _lf, errFile: _ef, ...p }) => p)
    return reply.send({ processes, updatedAt: cache.updatedAt })
  })
}
