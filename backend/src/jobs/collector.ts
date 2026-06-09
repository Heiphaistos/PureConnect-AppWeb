import { getSystemStats } from '../collectors/system.js'
import { listContainers } from '../collectors/docker.js'
import { listProcesses } from '../collectors/pm2.js'
import type { SystemStats, Container, Pm2Process } from '../types.js'

const VM_URL = process.env.VM_URL ?? 'http://localhost:8428'
const INTERVAL_MS = 5_000

// In-memory cache for the latest snapshot (frontend polls this via /api/metrics/snapshot)
export const cache = {
  system: null as SystemStats | null,
  containers: [] as Container[],
  processes: [] as Pm2Process[],
  updatedAt: 0,
}

function toPrometheus(lines: string[]): string {
  return lines.join('\n') + '\n'
}

// Escape backslash, double-quote, newline per Prometheus text format spec
function lbl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').slice(0, 128)
}

async function pushToVictoriaMetrics(metrics: string): Promise<void> {
  try {
    await fetch(`${VM_URL}/api/v1/import/prometheus`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: metrics,
    })
  } catch {
    // VM might not be ready yet — silent fail
  }
}

function buildSystemMetrics(s: SystemStats): string[] {
  const ts = Math.floor(s.collectedAt / 1000) * 1000
  const lines: string[] = [
    `vps_cpu_usage_percent ${s.cpu.usage} ${ts}`,
    `vps_memory_used_bytes ${s.memory.used} ${ts}`,
    `vps_memory_total_bytes ${s.memory.total} ${ts}`,
    `vps_memory_percent ${s.memory.percent} ${ts}`,
    `vps_load_1m ${s.cpu.load1} ${ts}`,
  ]
  for (const disk of s.disks) {
    const labels = `{mount="${lbl(disk.mount)}",fs="${lbl(disk.fs)}"}`
    lines.push(`vps_disk_used_bytes${labels} ${disk.used} ${ts}`)
    lines.push(`vps_disk_size_bytes${labels} ${disk.size} ${ts}`)
    lines.push(`vps_disk_percent${labels} ${disk.percent} ${ts}`)
  }
  for (const net of s.network) {
    const l = `{iface="${lbl(net.iface)}"}`
    lines.push(`vps_net_rx_bytes_total${l} ${net.rx_bytes} ${ts}`)
    lines.push(`vps_net_tx_bytes_total${l} ${net.tx_bytes} ${ts}`)
    lines.push(`vps_net_rx_sec${l} ${net.rx_sec} ${ts}`)
    lines.push(`vps_net_tx_sec${l} ${net.tx_sec} ${ts}`)
  }
  return lines
}

function buildContainerMetrics(containers: Container[]): string[] {
  const ts = Date.now()
  const lines: string[] = []
  for (const c of containers) {
    const l = `{name="${lbl(c.name)}",image="${lbl(c.image)}",id="${lbl(c.shortId)}"}`
    lines.push(`docker_cpu_percent${l} ${c.cpuPercent} ${ts}`)
    lines.push(`docker_memory_usage_bytes${l} ${c.memoryUsage} ${ts}`)
    lines.push(`docker_memory_percent${l} ${c.memoryPercent} ${ts}`)
    lines.push(`docker_net_in_bytes${l} ${c.networkIn} ${ts}`)
    lines.push(`docker_net_out_bytes${l} ${c.networkOut} ${ts}`)
    lines.push(`docker_restarts_total${l} ${c.restartCount} ${ts}`)
  }
  return lines
}

function buildPm2Metrics(processes: Pm2Process[]): string[] {
  const ts = Date.now()
  const lines: string[] = []
  for (const p of processes) {
    const l = `{name="${lbl(p.name)}",pm_id="${p.pm_id}"}`
    lines.push(`pm2_cpu_percent${l} ${p.cpu} ${ts}`)
    lines.push(`pm2_memory_bytes${l} ${p.memory} ${ts}`)
    lines.push(`pm2_restarts_total${l} ${p.restarts} ${ts}`)
  }
  return lines
}

export function startCollector(): void {
  async function tick(): Promise<void> {
    try {
      const [system, containers, processes] = await Promise.all([
        getSystemStats(),
        listContainers(),
        listProcesses(),
      ])

      cache.system = system
      cache.containers = containers
      cache.processes = processes
      cache.updatedAt = Date.now()

      const metrics = toPrometheus([
        ...buildSystemMetrics(system),
        ...buildContainerMetrics(containers),
        ...buildPm2Metrics(processes),
      ])
      await pushToVictoriaMetrics(metrics)
    } catch (err) {
      console.warn('[Collector] Tick error:', (err as Error).message)
    }
  }

  // First tick immediately, then every 5s
  tick()
  setInterval(tick, INTERVAL_MS)
}
