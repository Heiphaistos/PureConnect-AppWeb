import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { cache } from '../jobs/collector.js'
import type { HistoryResponse, MetricPoint } from '../types.js'

const VM_URL = process.env.VM_URL ?? 'http://localhost:8428'

interface HistoryQuery {
  metric: string
  start?: string
  end?: string
  step?: string
}

async function queryVm(query: string, start: number, end: number, step: number): Promise<MetricPoint[]> {
  const url = new URL(`${VM_URL}/api/v1/query_range`)
  url.searchParams.set('query', query)
  url.searchParams.set('start', String(start))
  url.searchParams.set('end', String(end))
  url.searchParams.set('step', String(step))

  const res = await fetch(url.toString())
  if (!res.ok) return []
  const data = (await res.json()) as {
    status: string
    data: { result: Array<{ values: [number, string][] }> }
  }
  if (data.status !== 'success' || !data.data.result.length) return []
  return data.data.result[0].values.map(([ts, v]) => ({ timestamp: ts * 1000, value: parseFloat(v) }))
}

const METRIC_QUERIES: Record<string, string> = {
  cpu: 'vps_cpu_usage_percent',
  memory: 'vps_memory_percent',
  net_in: 'vps_net_rx_sec',
  net_out: 'vps_net_tx_sec',
  load: 'vps_load_1m',
}

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // Current snapshot (from in-memory cache — ultra fast)
  app.get('/snapshot', async (_req, reply) => {
    if (!cache.system) return reply.status(503).send({ error: 'Collecting...' })
    return reply.send({
      system: cache.system,
      containers: cache.containers,
      processes: cache.processes,
      updatedAt: cache.updatedAt,
    })
  })

  // Historical time-series from VictoriaMetrics
  app.get<{ Querystring: HistoryQuery }>('/history', async (req, reply) => {
    const { metric, start, end, step } = req.query

    if (!metric || !METRIC_QUERIES[metric]) {
      return reply.status(400).send({ error: `Unknown metric. Valid: ${Object.keys(METRIC_QUERIES).join(', ')}` })
    }

    const nowSec = Math.floor(Date.now() / 1000)
    const endTs = end ? Number(end) : nowSec
    const startTs = start ? Number(start) : endTs - 3600
    const stepVal = step ? Number(step) : 15

    // Bounds: reject NaN/Infinity/negative timestamps, future end, unreasonable ranges
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || !Number.isFinite(stepVal)) {
      return reply.status(400).send({ error: 'Invalid numeric parameters' })
    }
    if (startTs < 0 || endTs < 0 || endTs > nowSec + 5) {
      return reply.status(400).send({ error: 'Timestamps out of range' })
    }
    if (endTs <= startTs) {
      return reply.status(400).send({ error: 'end must be after start' })
    }
    if (endTs - startTs > 7 * 24 * 3600) {
      return reply.status(400).send({ error: 'Range too large (max 7 days)' })
    }
    if (stepVal < 1 || stepVal > 3600) {
      return reply.status(400).send({ error: 'step must be between 1 and 3600 seconds' })
    }

    try {
      const points = await queryVm(METRIC_QUERIES[metric], startTs, endTs, stepVal)
      const response: HistoryResponse = { metric, points }
      return reply.send(response)
    } catch (err) {
      return reply.status(502).send({ error: 'VictoriaMetrics unavailable' })
    }
  })
}
