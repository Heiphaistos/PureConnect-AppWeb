'use client'

import { Header } from '@/components/layout/Header'
import { StatCard } from '@/components/ui/Card'
import { PercentBar } from '@/components/ui/Badge'
import { MetricAreaChart } from '@/components/charts/AreaChart'
import { useSnapshot, useHistory } from '@/hooks/useMetrics'
import { formatBytes, formatUptime } from '@/lib/utils'
import { Server, Layers, Activity, HardDrive, Gauge } from 'lucide-react'

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={13} className="text-text-dim" />
      <h2 className="font-mono text-xs text-text-dim tracking-widest uppercase">{label}</h2>
    </div>
  )
}

function LoadBar({ value, max = 4 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = pct > 90 ? 'bg-crimson' : pct > 70 ? 'bg-amber-400' : 'bg-mint'
  return (
    <div className="w-full h-1 bg-base-700 rounded-full mt-1">
      <div className={`h-1 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function DashboardPage() {
  const { snapshot, loading } = useSnapshot()
  const { points: cpuHistory } = useHistory('cpu')
  const { points: memHistory } = useHistory('memory')
  const { points: netInHistory } = useHistory('net_in')
  const { points: netOutHistory } = useHistory('net_out')
  const { points: loadHistory } = useHistory('load')

  const sys = snapshot?.system
  const runningContainers = snapshot?.containers.filter((c) => c.state === 'deployed').length ?? 0
  const totalContainers = snapshot?.containers.length ?? 0
  const runningProcesses = snapshot?.processes.filter((p) => p.state === 'deployed').length ?? 0
  const totalProcesses = snapshot?.processes.length ?? 0

  const cpuCores = sys?.cpu.cores ?? 1

  return (
    <div className="flex-1 page-enter">
      <Header title="Dashboard" subtitle="VUE GLOBALE DU SYSTÈME" />

      <main className="p-6 space-y-6 max-w-[1400px]">
        {/* Quick stats */}
        <section>
          <SectionTitle icon={Server} label="Système" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="CPU"
              value={loading ? '—' : `${sys?.cpu.usage.toFixed(1) ?? 0}%`}
              sub={sys ? `${sys.cpu.cores} cœurs · ${sys.cpu.model.slice(0, 20)}` : undefined}
              accent={sys && sys.cpu.usage > 80 ? 'red' : 'cyan'}
            />
            <StatCard
              label="MÉMOIRE"
              value={loading ? '—' : `${sys?.memory.percent.toFixed(0) ?? 0}%`}
              sub={sys ? `${formatBytes(sys.memory.used)} / ${formatBytes(sys.memory.total)}` : undefined}
              accent={sys && sys.memory.percent > 85 ? 'red' : 'mint'}
            />
            <StatCard
              label="DOCKER"
              value={`${runningContainers}/${totalContainers}`}
              sub="conteneurs actifs"
              accent="cyan"
            />
            <StatCard
              label="PM2"
              value={`${runningProcesses}/${totalProcesses}`}
              sub="processus actifs"
              accent="mint"
            />
          </div>
        </section>

        {/* Load average */}
        {sys && (
          <section>
            <SectionTitle icon={Gauge} label="Charge système (load average)" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Load 1min card + history */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-mono text-xs text-text-dim tracking-widest">CHARGE — 1 HEURE</p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-mono text-[10px] text-text-dim">1min</p>
                      <p className="font-mono text-sm text-cyan-400">{sys.cpu.load1.toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[10px] text-text-dim">5min</p>
                      <p className="font-mono text-sm text-cyan-400/70">{sys.cpu.load5.toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[10px] text-text-dim">15min</p>
                      <p className="font-mono text-sm text-cyan-400/50">{sys.cpu.load15.toFixed(2)}</p>
                    </div>
                  </div>
                  </div>
                </div>
                <LoadBar value={sys.cpu.load1} max={cpuCores} />
                <p className="font-mono text-[10px] text-text-dim/50 mt-1.5">
                  Seuil critique : {cpuCores} cœurs
                </p>
                {loadHistory.length > 0 && (
                  <div className="mt-3">
                    <MetricAreaChart
                      data={loadHistory}
                      color="#06b6d4"
                      domain={[0, cpuCores * 1.5]}
                      unit=""
                      height={100}
                      loading={false}
                    />
                  </div>
                )}
              </div>

              {/* Swap info */}
              <div className="card p-4">
                <p className="font-mono text-xs text-text-dim tracking-widest mb-4">MÉMOIRE SWAP</p>
                {sys.memory.swapTotal > 0 ? (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <p className="font-mono text-xs text-text-secondary">
                        {formatBytes(sys.memory.swapUsed)} / {formatBytes(sys.memory.swapTotal)}
                      </p>
                      <p className="font-mono text-xs text-text-dim">
                        {((sys.memory.swapUsed / sys.memory.swapTotal) * 100).toFixed(1)}%
                      </p>
                    </div>
                    <PercentBar value={(sys.memory.swapUsed / sys.memory.swapTotal) * 100} />
                    <p className="font-mono text-[10px] text-text-dim/50 mt-2">
                      {sys.memory.swapUsed > sys.memory.swapTotal * 0.5
                        ? '⚠ Swap utilisé — RAM sous pression'
                        : 'Swap en bonne santé'}
                    </p>
                  </>
                ) : (
                  <p className="font-mono text-xs text-text-dim">Pas de swap configuré</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Charts row */}
        <section>
          <SectionTitle icon={Activity} label="Activité temps réel" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-xs text-text-dim tracking-widest">CPU — 1 HEURE</p>
                <p className="font-mono text-sm text-cyan-400">{sys?.cpu.usage.toFixed(1) ?? '—'}%</p>
              </div>
              <MetricAreaChart data={cpuHistory} color="#06b6d4" domain={[0, 100]} unit="%" height={120} loading={!cpuHistory.length} />
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-xs text-text-dim tracking-widest">RAM — 1 HEURE</p>
                <p className="font-mono text-sm text-mint">{sys?.memory.percent.toFixed(1) ?? '—'}%</p>
              </div>
              <MetricAreaChart data={memHistory} color="#00e898" domain={[0, 100]} unit="%" height={120} loading={!memHistory.length} />
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-xs text-text-dim tracking-widest">RÉSEAU ENTRANT — 1H</p>
                <p className="font-mono text-sm text-cyan-400">
                  {sys?.network[0] ? formatBytes(sys.network[0].rx_sec) + '/s' : '—'}
                </p>
              </div>
              <MetricAreaChart data={netInHistory} color="#22d9f0" domain={[0, 'auto'] as unknown as [number, number]} unit=" B/s" height={120} loading={!netInHistory.length} />
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-xs text-text-dim tracking-widest">RÉSEAU SORTANT — 1H</p>
                <p className="font-mono text-sm text-mint">
                  {sys?.network[0] ? formatBytes(sys.network[0].tx_sec) + '/s' : '—'}
                </p>
              </div>
              <MetricAreaChart data={netOutHistory} color="#00e898" domain={[0, 'auto'] as unknown as [number, number]} unit=" B/s" height={120} loading={!netOutHistory.length} />
            </div>
          </div>
        </section>

        {/* Disks */}
        {sys?.disks.length ? (
          <section>
            <SectionTitle icon={HardDrive} label="Stockage" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sys.disks.map((d) => (
                <div key={d.mount} className="card p-4">
                  <div className="flex justify-between items-center mb-2">
                    <p className="font-mono text-xs text-text-secondary">{d.mount}</p>
                    <p className="font-mono text-xs text-text-dim">{d.fs}</p>
                  </div>
                  <PercentBar value={d.percent} />
                  <div className="flex justify-between mt-1.5">
                    <p className="font-mono text-xs text-text-dim">{formatBytes(d.used)} utilisés</p>
                    <p className="font-mono text-xs text-text-dim">{formatBytes(d.size)} total</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* System info footer */}
        {sys && (
          <section>
            <SectionTitle icon={Layers} label="Informations système" />
            <div className="card p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="font-mono text-xs text-text-dim mb-0.5">HÔTE</p>
                  <p className="font-mono text-xs text-text-secondary">{sys.hostname}</p>
                </div>
                <div>
                  <p className="font-mono text-xs text-text-dim mb-0.5">OS</p>
                  <p className="font-mono text-xs text-text-secondary">{sys.os}</p>
                </div>
                <div>
                  <p className="font-mono text-xs text-text-dim mb-0.5">KERNEL</p>
                  <p className="font-mono text-xs text-text-secondary">{sys.kernel}</p>
                </div>
                <div>
                  <p className="font-mono text-xs text-text-dim mb-0.5">UPTIME</p>
                  <p className="font-mono text-xs text-text-secondary">{formatUptime(sys.uptime)}</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
