'use client'

import { useEffect, useState } from 'react'
import { useSnapshot } from '@/hooks/useMetrics'
import { formatUptime, formatBytes } from '@/lib/utils'
import type { SystemStats } from '@/lib/types'

function LiveClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const fmt = () => {
      const d = new Date()
      setTime(d.toISOString().slice(11, 19))
    }
    fmt()
    const id = setInterval(fmt, 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="font-mono text-xs text-text-dim tabular-nums">{time} UTC</span>
}

function Divider() {
  return <div className="w-px h-3 bg-border" />
}

function getMainDisk(sys: SystemStats) {
  const root = sys.disks.find((d) => d.mount === '/')
  return root ?? sys.disks[0] ?? null
}

function getTotalNetwork(sys: SystemStats) {
  return sys.network.reduce(
    (acc, n) => ({ rx: acc.rx + n.rx_sec, tx: acc.tx + n.tx_sec }),
    { rx: 0, tx: 0 },
  )
}

function getAlerts(sys: SystemStats): string[] {
  const alerts: string[] = []
  if (sys.cpu.usage > 85) alerts.push(`CPU ${sys.cpu.usage.toFixed(0)}%`)
  if (sys.memory.percent > 88) alerts.push(`RAM ${sys.memory.percent.toFixed(0)}%`)
  const disk = getMainDisk(sys)
  if (disk && disk.percent > 85) alerts.push(`Disque ${disk.percent.toFixed(0)}%`)
  if (sys.memory.swapTotal > 0 && (sys.memory.swapUsed / sys.memory.swapTotal) > 0.8)
    alerts.push('Swap >80%')
  return alerts
}

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const { snapshot } = useSnapshot()
  const sys = snapshot?.system

  const disk = sys ? getMainDisk(sys) : null
  const net = sys ? getTotalNetwork(sys) : null
  const alerts = sys ? getAlerts(sys) : []
  const hasAlert = alerts.length > 0

  return (
    <header className="h-14 border-b border-border bg-base-900/80 backdrop-blur-sm flex items-center px-6 gap-6 sticky top-0 z-30">
      {/* Page title */}
      <div className="flex-1">
        <h1 className="font-display font-bold text-text-primary text-sm">{title}</h1>
        {subtitle && <p className="font-mono text-[10px] text-text-dim tracking-widest">{subtitle}</p>}
      </div>

      {/* Live stats pill */}
      {sys && (
        <div className="hidden md:flex items-center gap-3 bg-base-800 border border-border rounded-lg px-4 py-1.5 text-xs font-mono">
          {/* CPU */}
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim">CPU</span>
            <span className={sys.cpu.usage > 85 ? 'text-crimson' : sys.cpu.usage > 70 ? 'text-amber-400' : 'text-cyan-400'}>
              {sys.cpu.usage.toFixed(0)}%
            </span>
          </div>

          <Divider />

          {/* RAM */}
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim">RAM</span>
            <span className={sys.memory.percent > 88 ? 'text-crimson' : sys.memory.percent > 75 ? 'text-amber-400' : 'text-mint'}>
              {sys.memory.percent.toFixed(0)}%
            </span>
          </div>

          <Divider />

          {/* Disk */}
          {disk && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-text-dim">DISK</span>
                <span className={disk.percent > 85 ? 'text-crimson' : disk.percent > 70 ? 'text-amber-400' : 'text-violet-400'}>
                  {disk.percent.toFixed(0)}%
                </span>
                <span className="text-text-dim/50 text-[10px]">{disk.mount}</span>
              </div>
              <Divider />
            </>
          )}

          {/* Network */}
          {net && (net.rx > 0 || net.tx > 0) && (
            <>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-sky-400">
                  <span className="text-[10px]">↓</span>
                  {formatBytes(net.rx)}/s
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="text-[10px]">↑</span>
                  {formatBytes(net.tx)}/s
                </span>
              </div>
              <Divider />
            </>
          )}

          {/* Uptime */}
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim">UP</span>
            <span className="text-text-secondary">{formatUptime(sys.uptime)}</span>
          </div>
        </div>
      )}

      {/* Alert badge */}
      {hasAlert && (
        <div
          className="relative group cursor-default"
          title={alerts.join(' · ')}
        >
          <div className="flex items-center gap-1.5 bg-crimson/10 border border-crimson/40 text-crimson rounded-lg px-3 py-1 text-xs font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-crimson animate-pulse" />
            <span>{alerts.length} alerte{alerts.length > 1 ? 's' : ''}</span>
          </div>
          {/* Tooltip */}
          <div className="absolute right-0 top-8 hidden group-hover:flex flex-col gap-1 bg-base-800 border border-border rounded-lg px-3 py-2 text-xs font-mono text-crimson whitespace-nowrap z-50">
            {alerts.map((a) => (
              <span key={a}>⚠ {a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Live indicator */}
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full status-pulse ${hasAlert ? 'bg-amber-400' : 'bg-mint'}`} />
        <LiveClock />
      </div>
    </header>
  )
}
