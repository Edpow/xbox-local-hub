import { EventEmitter } from 'node:events'
import type { ScopeLogger } from '../core/logger.js'
import {
  GssvClient,
  normalizeIceCandidate,
  type IceCandidate,
  type SessionConfiguration,
} from '../core/xbox/gssv.js'
import type { AuthService } from './auth-service.js'
import { MockConsole, type MockConsoleStats } from './mock-console.js'

export type SessionMode = 'xbox' | 'mock'

export interface SessionSnapshot {
  active: boolean
  mode: SessionMode
  serverId: string | null
  sessionId: string | null
  state: string
  startedAt: string | null
  lastError: string | null
  keepaliveSeconds: number | null
  sdpExchangedAt: string | null
  iceExchangedAt: string | null
  serverDetails: SessionConfiguration['serverDetails'] | null
  mock?: MockConsoleStats
}

const INACTIVE: SessionSnapshot = {
  active: false,
  mode: 'xbox',
  serverId: null,
  sessionId: null,
  state: 'idle',
  startedAt: null,
  lastError: null,
  keepaliveSeconds: null,
  sdpExchangedAt: null,
  iceExchangedAt: null,
  serverDetails: null,
}

export class SessionService extends EventEmitter {
  private snapshot: SessionSnapshot = { ...INACTIVE }
  private client: GssvClient | null = null
  private mock: MockConsole | null = null
  private keepaliveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly auth: AuthService,
    private readonly mode: SessionMode,
    private readonly log: ScopeLogger,
  ) {
    super()
    if (mode === 'mock') {
      this.snapshot = { ...INACTIVE, mode: 'mock' }
    }
  }

  getSnapshot(): SessionSnapshot {
    return {
      ...this.snapshot,
      mock: this.mock?.getStats(),
    }
  }

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit('update', this.getSnapshot())
  }

  async start(serverId: string): Promise<SessionSnapshot> {
    if (this.snapshot.active) await this.stop()
    this.snapshot = {
      ...INACTIVE,
      mode: this.mode,
      active: true,
      state: 'starting',
      serverId,
      startedAt: new Date().toISOString(),
    }
    this.emit('update', this.getSnapshot())

    try {
      if (this.mode === 'mock') {
        this.mock = new MockConsole(this.log)
        this.mock.on('update', () => this.update({ mock: this.mock?.getStats() }))
        this.update({
          state: 'Provisioned',
          sessionId: `mock-${Date.now()}`,
          serverDetails: { ipAddress: '127.0.0.1', port: 9002 },
          keepaliveSeconds: 300,
        })
        this.log.info('Sessão MOCK iniciada (nenhum console real é contatado)')
        return this.getSnapshot()
      }

      const tokens = await this.auth.getSessionTokens()
      this.client = new GssvClient({
        baseUri: tokens.baseUri,
        gsToken: tokens.gsToken,
      })
      const started = await this.client.startSession(serverId)
      this.update({ state: started.state, sessionId: started.sessionId })
      this.log.info('Sessão xHome criada', {
        sessionId: started.sessionId,
        sessionPath: started.sessionPath,
      })

      const state = await this.client.waitForProvisioned({
        timeoutMs: 90_000,
        onState: (current) => {
          this.update({ state: current.state })
        },
      })
      const configuration = await this.client.getConfiguration()
      this.update({
        state: state.state,
        serverDetails: configuration.serverDetails ?? null,
        keepaliveSeconds: configuration.keepAlivePulseInSeconds ?? 300,
      })
      this.startKeepalive(Math.max(30_000, (configuration.keepAlivePulseInSeconds ?? 300) * 500))
      return this.getSnapshot()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.update({ active: false, state: 'error', lastError: message })
      this.log.error('Falha ao iniciar sessão', { error: message })
      throw error
    }
  }

  private startKeepalive(intervalMs: number): void {
    this.stopKeepalive()
    this.keepaliveTimer = setInterval(() => {
      void this.ping()
    }, intervalMs)
    this.keepaliveTimer.unref?.()
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = null
  }

  async ping(): Promise<void> {
    if (!this.snapshot.active) return
    if (this.mode === 'mock') return
    if (!this.client) return
    try {
      await this.client.keepalive()
      this.log.debug('Keepalive enviado')
    } catch (error) {
      this.log.warn('Keepalive falhou', { error: String(error) })
    }
  }

  async exchangeSdp(offerSdp: string): Promise<{ sdp: string; candidates?: IceCandidate[] }> {
    if (!this.snapshot.active) throw new Error('Nenhuma sessão ativa')
    if (!offerSdp.trim()) throw new Error('SDP offer vazio')

    if (this.mode === 'mock') {
      if (!this.mock) throw new Error('Mock console indisponível')
      const answer = await this.mock.answerOffer(offerSdp)
      this.update({ sdpExchangedAt: new Date().toISOString() })
      return answer
    }

    if (!this.client) throw new Error('Cliente da sessão indisponível')
    await this.client.sendSdpOffer(offerSdp)
    const answer = await this.client.waitForSdpAnswer({ timeoutMs: 25_000 })
    this.update({ sdpExchangedAt: new Date().toISOString() })
    this.log.info('SDP trocado', {
      answerBytes: answer.sdp.length,
      status: answer.status ?? null,
    })
    return {
      sdp: answer.sdp,
      candidates: undefined,
    }
  }

  async exchangeIce(candidates: IceCandidate[]): Promise<IceCandidate[]> {
    if (!this.snapshot.active) throw new Error('Nenhuma sessão ativa')
    if (this.mode === 'mock') {
      if (!this.mock) throw new Error('Mock console indisponível')
      await this.mock.addRemoteCandidates(candidates)
      this.update({ iceExchangedAt: new Date().toISOString() })
      return []
    }
    if (!this.client) throw new Error('Cliente da sessão indisponível')
    const normalized = candidates.map(normalizeIceCandidate)
    await this.client.sendIceCandidates(normalized)
    const remote = await this.client.waitForIceCandidates({ timeoutMs: 20_000 })
    this.update({ iceExchangedAt: new Date().toISOString() })
    this.log.info('ICE trocado', {
      local: normalized.length,
      remote: remote.length,
    })
    return remote.map(normalizeIceCandidate)
  }

  async stop(): Promise<SessionSnapshot> {
    this.stopKeepalive()
    if (this.mode === 'mock') {
      await this.mock?.close()
      this.mock = null
    } else if (this.client) {
      try {
        await this.client.stopSession()
      } catch (error) {
        this.log.warn('Falha ao encerrar sessão no console', { error: String(error) })
      }
      this.client.clear()
      this.client = null
    }
    this.snapshot = { ...INACTIVE, mode: this.mode }
    this.emit('update', this.getSnapshot())
    this.log.info('Sessão encerrada')
    return this.getSnapshot()
  }
}
