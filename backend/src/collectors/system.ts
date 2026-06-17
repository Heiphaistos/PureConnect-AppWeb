import si from 'systeminformation'
import os from 'node:os'
import type { SystemStats } from '../types.js'

let prevNetStats: Awaited<ReturnType<typeof si.networkStats>> | null = null
let prevNetTime = Date.now()

export async function getSystemStats(): Promise<SystemStats> {
  const [l1, l5, l15] = os.loadavg()
  const [cpu, mem, disksRaw, netRaw, osInfo, load] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.osInfo(),
    si.currentLoad(),
  ])

  // Compute network bytes/sec
  const now = Date.now()
  const elapsed = (now - prevNetTime) / 1000
  const network = netRaw
    .filter((n) => n.iface && !n.iface.startsWith('lo') && !n.iface.startsWith('veth'))
    .map((n) => {
      const prev = prevNetStats?.find((p) => p.iface === n.iface)
      const rx_sec = prev && elapsed > 0 ? Math.max(0, (n.rx_bytes - prev.rx_bytes) / elapsed) : 0
      const tx_sec = prev && elapsed > 0 ? Math.max(0, (n.tx_bytes - prev.tx_bytes) / elapsed) : 0
      return {
        iface: n.iface,
        rx_bytes: n.rx_bytes,
        tx_bytes: n.tx_bytes,
        rx_sec: Math.round(rx_sec),
        tx_sec: Math.round(tx_sec),
      }
    })

  prevNetStats = netRaw
  prevNetTime = now

  const disks = disksRaw
    .filter((d) => d.size > 0 && d.mount && !d.mount.startsWith('/var/lib/docker'))
    .slice(0, 4)
    .map((d) => ({
      fs: d.fs,
      size: d.size,
      used: d.used,
      percent: Number(d.use.toFixed(1)),
      mount: d.mount,
    }))

  return {
    cpu: {
      usage: Number(load.currentLoad.toFixed(1)),
      cores: cpu.physicalCores,
      model: cpu.manufacturer + ' ' + cpu.brand,
      speed: cpu.speed,
      load1: l1,
      load5: l5,
      load15: l15,
    },
    memory: {
      total: mem.total,
      used: mem.active,
      free: mem.free,
      percent: Number(((mem.active / mem.total) * 100).toFixed(1)),
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
    },
    disks,
    network,
    uptime: si.time().uptime,
    hostname: osInfo.hostname,
    os: osInfo.distro + ' ' + osInfo.release,
    kernel: osInfo.kernel,
    collectedAt: now,
  }
}
