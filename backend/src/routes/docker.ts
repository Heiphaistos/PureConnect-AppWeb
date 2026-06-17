import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { cache } from '../jobs/collector.js'
import { startContainer, stopContainer, restartContainer } from '../collectors/docker.js'

const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/i

export const dockerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get('/containers', async (_req, reply) => {
    return reply.send({ containers: cache.containers, updatedAt: cache.updatedAt })
  })

  app.post('/containers/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!CONTAINER_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid container ID' })
    try {
      await startContainer(id)
      return reply.send({ ok: true })
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  app.post('/containers/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!CONTAINER_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid container ID' })
    try {
      await stopContainer(id)
      return reply.send({ ok: true })
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  app.post('/containers/:id/restart', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!CONTAINER_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid container ID' })
    try {
      await restartContainer(id)
      return reply.send({ ok: true })
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })
}
