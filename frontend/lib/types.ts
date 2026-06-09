export type ContainerState = 'deployed' | 'pending' | 'failed'
export type ProcessState = 'deployed' | 'pending' | 'failed'

export interface Container {
  id: string
  shortId: string
  name: string
  image: string
  status: string
  state: ContainerState
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
  memoryPercent: number
  networkIn: number
  networkOut: number
  restartCount: number
  startedAt: string
  ports: string[]
}

export interface Pm2Process {
  pid: number
  name: string
  pm_id: number
  status: string
  state: ProcessState
  cpu: number
  memory: number
  restarts: number
  uptime: number
  instances: number
}

export interface CpuInfo {
  usage: number
  cores: number
  model: string
  speed: number
  load1: number
}

export interface MemInfo {
  total: number
  used: number
  free: number
  percent: number
  swapTotal: number
  swapUsed: number
}

export interface DiskInfo {
  fs: string
  size: number
  used: number
  percent: number
  mount: string
}

export interface NetInfo {
  iface: string
  rx_bytes: number
  tx_bytes: number
  rx_sec: number
  tx_sec: number
}

export interface SystemStats {
  cpu: CpuInfo
  memory: MemInfo
  disks: DiskInfo[]
  network: NetInfo[]
  uptime: number
  hostname: string
  os: string
  kernel: string
  collectedAt: number
}
