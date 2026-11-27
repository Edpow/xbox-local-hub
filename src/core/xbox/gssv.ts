/**
 * Xbox Remote Play (xHome) session REST client.
 *
 * Flow validated against public reverse-engineered documentation and the
 * open-source clients Greenlight, XStreaming and xbox-xcloud-player:
 *
 *   POST /v5/sessions/home/play         -> sessionId + sessionPath
 *   GET  /v5/sessions/home/:id/state    -> Provisioning / Provisioned ...
 *   GET  /v5/sessions/home/:id/configuration
 *   POST /v5/sessions/home/:id/sdp      -> offer
 *   GET  /v5/sessions/home/:id/sdp      -> answer (exchangeResponse)
 *   POST /v5/sessions/home/:id/ice      -> local candidates
 *   GET  /v5/sessions/home/:id/ice      -> remote candidates
 *   POST /v5/sessions/home/:id/keepalive
 *   DELETE /v5/sessions/home/:id
 */

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface GssvClientOptions {
  /** e.g. https://uks.core.gssv-play-prodxhome.xboxlive.com */
  baseUri: string
  /** xHome streaming token (`gsToken`). */
  gsToken: string
  fetchImpl?: FetchLike
  userAgent?: string
  timeoutMs?: number
}

export interface SessionStartResult {
  sessionId: string
  sessionPath: string
  state: string
  raw: unknown
}

export interface SessionState {
  state: string
  detailedSessionState?: number
  errorDetails?: { code?: string | number | null; message?: string | null }
  transferUri?: string
  maxSessionDurationInSeconds?: number
  raw: unknown
}

export interface SessionConfiguration {
  keepAlivePulseInSeconds?: number
  serverDetails?: {
    ipAddress?: string
    port?: number
    ipV4Address?: string
    ipV4Port?: number
    ipV6Address?: string | null
    ipV6Port?: number
    iceExchangePath?: string
    stunServerAddress?: string | null
    srtp?: { key?: string }
  }
  raw: unknown
}

export interface IceCandidate {
  candidate: string
  sdpMid?: string | number | null
  sdpMLineIndex?: number | string | null
  [key: string]: unknown
}

export interface SdpExchangeResult {
  sdp: string
  sdpType?: string
  status?: string
  configuration?: Record<string, unknown>
  raw: unknown
}

export class GssvError extends Error {
  readonly status: number
  readonly body: string
  readonly url: string

  constructor(url: string, status: number, body: string) {
    super(`Xbox session API ${status} on ${url}: ${body.slice(0, 500)}`)
    this.name = 'GssvError'
    this.url = url
    this.status = status
    this.body = body
  }
}

const DEVICE_INFO = JSON.stringify({
  appInfo: {
    env: {
      clientAppId: 'Microsoft.GamingApp',
      clientAppType: 'native',
      clientAppVersion: '2203.1001.4.0',
      clientSdkVersion: '8.5.2',
      httpEnvironment: 'prod',
      sdkInstallId: '',
    },
  },
  dev: {
    hw: { make: 'Microsoft', model: 'Surface Pro', sdktype: 'native' },
    os: { name: 'Windows 11', ver: '22631.2715', platform: 'desktop' },
    displayInfo: {
      dimensions: { widthInPixels: 1920, heightInPixels: 1080 },
      pixelDensity: { dpiX: 1, dpiY: 1 },
    },
  },
})

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const SDP_CONFIGURATION = {
  chatConfiguration: {
    bytesPerSample: 2,
    expectedClipDurationMs: 20,
    format: { codec: 'opus', container: 'webm' },
    numChannels: 1,
    sampleFrequencyHz: 24000,
  },
  chat: { minVersion: 1, maxVersion: 1 },
  control: { minVersion: 1, maxVersion: 3 },
  input: { minVersion: 1, maxVersion: 8 },
  message: { minVersion: 1, maxVersion: 1 },
} as const

export function normalizeBaseUri(baseUri: string): string {
  const trimmed = baseUri.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

export class GssvClient {
  private readonly baseUri: string
  private readonly gsToken: string
  private readonly fetchImpl: FetchLike
  private readonly userAgent: string
  private readonly timeoutMs: number
  private sessionPath: string | null = null
  private sessionIdValue: string | null = null

  constructor(options: GssvClientOptions) {
    this.baseUri = normalizeBaseUri(options.baseUri)
    this.gsToken = options.gsToken
    this.fetchImpl = options.fetchImpl ?? fetch
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.timeoutMs = options.timeoutMs ?? 30_000
    if (!this.gsToken) throw new Error('GssvClient requires a streaming token')
  }

  get host(): string {
    return this.baseUri
  }

  get sessionId(): string | null {
    return this.sessionIdValue
  }

  private sessionUrl(resource?: string): string {
    if (!this.sessionPath) throw new Error('No active Xbox session')
    const path = this.sessionPath.startsWith('http')
      ? this.sessionPath
      : `${this.baseUri}/${this.sessionPath.replace(/^\/+/, '')}`
    return resource ? `${path.replace(/\/+$/, '')}/${resource}` : path
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.gsToken}`,
      'User-Agent': this.userAgent,
      ...extra,
    }
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(this.headers())) {
      if (!headers.has(key)) headers.set(key, value)
    }
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers,
        signal: controller.signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new GssvError(url, response.status, text)
      }
      return response
    } finally {
      clearTimeout(timer)
    }
  }

  private async requestJson(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.request(url, init)
    if (response.status === 204) return null
    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  async startSession(serverId: string, locale = 'en-US'): Promise<SessionStartResult> {
    if (!serverId) throw new Error('serverId is required')
    const url = `${this.baseUri}/v5/sessions/home/play`
    const body = {
      titleId: '',
      systemUpdateGroup: '',
      clientSessionId: '',
      settings: {
        nanoVersion: 'V3;WebrtcTransport.dll',
        enableTextToSpeech: false,
        highContrast: 0,
        locale,
        useIceConnection: false,
        timezoneOffsetMinutes: 120,
        sdkType: 'web',
        osName: 'windows',
      },
      serverId,
      fallbackRegionNames: [],
    }
    const data = (await this.requestJson(url, {
      method: 'POST',
      headers: { 'X-MS-Device-Info': DEVICE_INFO },
      body: JSON.stringify(body),
    })) as Record<string, unknown> | null

    if (!data || typeof data !== 'object') {
      throw new Error('Unexpected empty response from /play')
    }
    const sessionPath = typeof data.sessionPath === 'string' ? data.sessionPath : ''
    if (!sessionPath) throw new Error('Xbox did not return a sessionPath')
    const parts = sessionPath.split('/').filter(Boolean)
    const derivedId =
      typeof data.sessionId === 'string' && data.sessionId
        ? data.sessionId
        : (parts[parts.length - 1] ?? '')
    if (!derivedId) throw new Error('Xbox did not return a sessionId')

    this.sessionPath = sessionPath
    this.sessionIdValue = derivedId
    return {
      sessionId: derivedId,
      sessionPath,
      state: typeof data.state === 'string' ? data.state : 'Provisioning',
      raw: data,
    }
  }

  async getState(): Promise<SessionState> {
    const data = (await this.requestJson(this.sessionUrl('state'))) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') throw new Error('Empty session state response')
    return {
      state: typeof data.state === 'string' ? data.state : 'Unknown',
      detailedSessionState:
        typeof data.detailedSessionState === 'number' ? data.detailedSessionState : undefined,
      errorDetails:
        data.errorDetails && typeof data.errorDetails === 'object'
          ? (data.errorDetails as SessionState['errorDetails'])
          : undefined,
      transferUri: typeof data.transferUri === 'string' ? data.transferUri : undefined,
      maxSessionDurationInSeconds:
        typeof data.maxSessionDurationInSeconds === 'number'
          ? data.maxSessionDurationInSeconds
          : undefined,
      raw: data,
    }
  }

  async waitForProvisioned(
    options: { timeoutMs?: number; intervalMs?: number; onState?: (state: SessionState) => void } = {},
  ): Promise<SessionState> {
    const timeoutMs = options.timeoutMs ?? 90_000
    const intervalMs = options.intervalMs ?? 1_000
    const deadline = Date.now() + timeoutMs
    let last: SessionState | null = null
    while (Date.now() < deadline) {
      const state = await this.getState()
      last = state
      options.onState?.(state)
      if (state.state === 'Provisioned' || state.state === 'ReadyToConnect') return state
      if (state.state === 'Failed') {
        throw new Error(
          `Xbox session failed: ${state.errorDetails?.message ?? state.errorDetails?.code ?? 'unknown error'}`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new Error(
      `Timed out waiting for the Xbox session (last state: ${last?.state ?? 'none'})`,
    )
  }

  async getConfiguration(): Promise<SessionConfiguration> {
    const data = (await this.requestJson(this.sessionUrl('configuration'))) as
      | Record<string, unknown>
      | null
    if (!data || typeof data !== 'object') throw new Error('Empty session configuration')
    return {
      keepAlivePulseInSeconds:
        typeof data.keepAlivePulseInSeconds === 'number'
          ? data.keepAlivePulseInSeconds
          : undefined,
      serverDetails:
        data.serverDetails && typeof data.serverDetails === 'object'
          ? (data.serverDetails as SessionConfiguration['serverDetails'])
          : undefined,
      raw: data,
    }
  }

  async sendSdpOffer(sdp: string): Promise<void> {
    if (!sdp.trim()) throw new Error('Empty SDP offer')
    await this.request(this.sessionUrl('sdp'), {
      method: 'POST',
      body: JSON.stringify({
        messageType: 'offer',
        sdp,
        configuration: SDP_CONFIGURATION,
      }),
    })
  }

  async waitForSdpAnswer(options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<SdpExchangeResult> {
    const timeoutMs = options.timeoutMs ?? 20_000
    const intervalMs = options.intervalMs ?? 500
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const data = (await this.requestJson(this.sessionUrl('sdp'))) as Record<string, unknown> | null
      if (data && typeof data.exchangeResponse === 'string' && data.exchangeResponse) {
        const parsed = parseExchangeResponse(data.exchangeResponse) as Record<string, unknown> | null
        if (parsed && typeof parsed === 'object' && typeof parsed.sdp === 'string') {
          return {
            sdp: parsed.sdp,
            sdpType: typeof parsed.sdpType === 'string' ? parsed.sdpType : undefined,
            status: typeof parsed.status === 'string' ? parsed.status : undefined,
            configuration:
              parsed.configuration && typeof parsed.configuration === 'object'
                ? (parsed.configuration as Record<string, unknown>)
                : undefined,
            raw: parsed,
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new Error('Timed out waiting for the Xbox SDP answer')
  }

  async sendIceCandidates(candidates: IceCandidate[]): Promise<void> {
    await this.request(this.sessionUrl('ice'), {
      method: 'POST',
      body: JSON.stringify({
        messageType: 'iceCandidate',
        candidate: candidates,
      }),
    })
  }

  async waitForIceCandidates(options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<IceCandidate[]> {
    const timeoutMs = options.timeoutMs ?? 15_000
    const intervalMs = options.intervalMs ?? 500
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const data = (await this.requestJson(this.sessionUrl('ice'))) as Record<string, unknown> | null
      if (data && typeof data.exchangeResponse === 'string' && data.exchangeResponse) {
        const parsed = parseExchangeResponse(data.exchangeResponse)
        if (Array.isArray(parsed)) return parsed as IceCandidate[]
        if (parsed && typeof parsed === 'object') {
          const maybe = parsed as Record<string, unknown>
          if (Array.isArray(maybe.candidates)) return maybe.candidates as IceCandidate[]
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new Error('Timed out waiting for Xbox ICE candidates')
  }

  async keepalive(): Promise<void> {
    await this.request(this.sessionUrl('keepalive'), { method: 'POST' })
  }

  async stopSession(): Promise<void> {
    const url = this.sessionUrl()
    await this.request(url, { method: 'DELETE' })
    this.sessionPath = null
    this.sessionIdValue = null
  }

  clear(): void {
    this.sessionPath = null
    this.sessionIdValue = null
  }
}

export function parseExchangeResponse(value: string): unknown {
  try {
    const once = JSON.parse(value) as unknown
    // Some payloads arrive with a doubled JSON encoding.
    if (typeof once === 'string') {
      try {
        return JSON.parse(once) as unknown
      } catch {
        return once
      }
    }
    return once
  } catch {
    return null
  }
}

/**
 * Xbox ICE candidates often come with a literal `a=` prefix, which the W3C
 * API rejects. Teredo IPv6 candidates are also useless on a LAN-only setup;
 * the open-source clients expand/translate them. We keep them for parity but
 * lean on host candidates first.
 */
export function normalizeIceCandidate(candidate: IceCandidate): IceCandidate {
  const value = typeof candidate.candidate === 'string' ? candidate.candidate : ''
  return {
    ...candidate,
    candidate: value.startsWith('a=') ? value.slice(2) : value,
    sdpMLineIndex:
      typeof candidate.sdpMLineIndex === 'string'
        ? Number(candidate.sdpMLineIndex)
        : candidate.sdpMLineIndex,
  }
}
