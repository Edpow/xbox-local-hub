export interface AuthStatus {
  authenticated: boolean
  pending: boolean
  challenge?: {
    userCode: string
    verificationUri: string
    expiresInSeconds: number
    intervalSeconds: number
    message: string
    startedAt: string
  }
  error?: string
  tokenFile: string
  updatedAt: string
  mock?: boolean
}

export interface SessionSnapshot {
  active: boolean
  mode: 'xbox' | 'mock'
  serverId: string | null
  sessionId: string | null
  state: string
  startedAt: string | null
  lastError: string | null
  keepaliveSeconds: number | null
  sdpExchangedAt: string | null
  iceExchangedAt: string | null
  serverDetails: {
    ipAddress?: string
    port?: number
    ipV4Address?: string
    ipV4Port?: number
    ipV6Address?: string | null
    ipV6Port?: number
    stunServerAddress?: string | null
  } | null
  mock?: MockStats
}

export interface MockSlotStats {
  frames: number
  lastSequence: number
  lastAt: string | null
  buttons: number
  leftTrigger: number
  rightTrigger: number
  leftStickX: number
  leftStickY: number
  rightStickX: number
  rightStickY: number
}

export interface MockStats {
  connectionState: string
  iceConnectionState: string
  channels: string[]
  controlMessages: Array<{ at: string; message: unknown }>
  registeredSlots: number[]
  packets: number
  bytes: number
  lastPacketAt: string | null
  slots: Record<string, MockSlotStats>
  startedAt: string
}

export interface PlayerAssignment {
  slot: number
  controllerId: string
  controllerName: string
  source: 'web' | 'native' | 'manual'
  assignedAt: string
}

export interface PlayerSnapshot {
  slots: Array<PlayerAssignment | null>
  assignments: PlayerAssignment[]
}

export interface AppState {
  version: string
  mode: 'xbox' | 'mock'
  now: string
  uptimeSeconds: number
  auth: AuthStatus
  session: SessionSnapshot
  players: PlayerSnapshot
  diagnostics: {
    wsClients: number
    rttMs: number | null
    lastLanScanAt: string | null
    lanErrors: string[]
  }
}

export interface ConsoleEntry {
  serverId: string | null
  name: string
  source: 'xbox-live' | 'lan' | 'mock'
  address?: string
  smartglassUuid?: string
  powerState?: string
  consoleType?: string
  connectable: boolean
  note?: string
}

export interface ConsoleListResult {
  consoles: ConsoleEntry[]
  lanScan: {
    lastScanAt: string | null
    durationMs: number | null
    errors: string[]
    targets: string[]
  }
  warnings: string[]
}

export interface LogEntry {
  ts: string
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
  data?: unknown
}

export interface IceCandidatePayload {
  candidate: string
  sdpMid?: string | number | null
  sdpMLineIndex?: number | string | null
}

const params = new URLSearchParams(window.location.search)
const queryToken = params.get('token')
if (queryToken) {
  try {
    sessionStorage.setItem('xlh.token', queryToken)
  } catch {
    // private mode
  }
}

export function accessToken(): string {
  if (queryToken) return queryToken
  try {
    return sessionStorage.getItem('xlh.token') ?? ''
  } catch {
    return ''
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = accessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!response.ok) {
    const body = data as { message?: string; error?: string } | null
    throw new ApiError(body?.message ?? body?.error ?? `HTTP ${response.status}`, response.status)
  }
  return data as T
}

export class RelaySocket {
  private socket: WebSocket | null = null
  private retry = 0
  private closed = false

  constructor(
    private readonly onEvent: (event: { type: string; data?: unknown }) => void,
    private readonly onStatus: (status: 'connecting' | 'online' | 'offline') => void,
  ) {}

  connect(): void {
    this.closed = false
    this.open()
  }

  private open(): void {
    if (this.closed) return
    this.onStatus('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const token = accessToken()
    const url = `${protocol}://${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`
    const socket = new WebSocket(url)
    this.socket = socket

    socket.onopen = () => {
      this.retry = 0
      this.onStatus('online')
    }
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; t?: number; data?: unknown }
        if (message.type === 'ping' && typeof message.t === 'number') {
          socket.send(JSON.stringify({ type: 'pong', t: message.t }))
          return
        }
        if (message.type) this.onEvent({ type: message.type, data: message.data })
      } catch {
        // ignore
      }
    }
    socket.onerror = () => {
      // onclose handles reconnection
    }
    socket.onclose = () => {
      this.onStatus('offline')
      if (this.closed) return
      this.retry++
      const delay = Math.min(8_000, 500 * 2 ** Math.min(this.retry, 4))
      window.setTimeout(() => this.open(), delay)
    }
  }

  close(): void {
    this.closed = true
    this.socket?.close()
    this.socket = null
  }
}

export function isEmbedMode(): boolean {
  return params.get('embed') === '1'
}

export function isTestMode(): boolean {
  return params.get('test') === '1'
}
