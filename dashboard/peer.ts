import {
  encodeClientMetadataPacket,
  encodeInputPacket,
  ReportType,
  type GamepadFrame,
} from '../src/core/input-packet.js'
import {
  authorizationRequestMessage,
  gamepadChangedMessage,
  handshakeMessage,
  streamingConfigMessages,
  transactionCompleteMessage,
} from '../src/core/channels.js'
import { emptyGamepadState, stateDistance, type GamepadState } from '../src/core/gamepad.js'
import { api, type IceCandidatePayload } from './api.js'

export type PeerStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed'

export interface PeerSlotStats {
  sent: number
  lastAt: number | null
  registered: boolean
}

export interface PeerStats {
  status: PeerStatus
  peerState: string
  iceState: string
  signalingState: string
  channels: { message: string; control: string; input: string }
  handshake: boolean
  packets: number
  bytes: number
  slots: Record<number, PeerSlotStats>
  lastError: string | null
  connectedAt: string | null
}

export interface PeerOptions {
  /** Negotiate audio/video m-lines. Data-only is experimental. */
  media: boolean
  /** Official web client sends 0/0; Greenlight sends 1/1. */
  coopMode?: boolean
  maxSlots: number
  onLog: (message: string, level?: 'debug' | 'info' | 'warn' | 'error') => void
  onStats: (stats: PeerStats) => void
  onVideoStream?: (stream: MediaStream | null) => void
  onVibration?: (slot: number, rumble: VibrationReport) => void
}

export interface VibrationReport {
  slot: number
  leftMotor: number
  rightMotor: number
  leftTrigger: number
  rightTrigger: number
  durationMs: number
  delayMs: number
  repeat: number
}

interface ChannelSet {
  message: RTCDataChannel | null
  control: RTCDataChannel | null
  input: RTCDataChannel | null
}

const TICK_MS = 16
const HEARTBEAT_MS = 100
const AXIS_EPSILON = 0.004

export class XboxPeer {
  private pc: RTCPeerConnection | null = null
  private channels: ChannelSet = { message: null, control: null, input: null }
  private desired = new Map<number, GamepadState>()
  private lastSent = new Map<number, { state: GamepadState; at: number }>()
  private registered = new Set<number>()
  private sequence = 0
  private localCandidates: IceCandidatePayload[] = []
  private loop: number | null = null
  private statsTimer: number | null = null
  private connectStartedAt = 0
  private lastEmitAt = 0
  private stats: PeerStats = {
    status: 'idle',
    peerState: 'new',
    iceState: 'new',
    signalingState: 'stable',
    channels: { message: 'closed', control: 'closed', input: 'closed' },
    handshake: false,
    packets: 0,
    bytes: 0,
    slots: {},
    lastError: null,
    connectedAt: null,
  }

  constructor(private readonly options: PeerOptions) {}

  getStats(): PeerStats {
    return {
      ...this.stats,
      slots: Object.fromEntries(
        Object.entries(this.stats.slots).map(([key, value]) => [key, { ...value }]),
      ),
    }
  }

  private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    this.options.onLog(message, level)
  }

  private emitStats(): void {
    this.options.onStats(this.getStats())
  }

  async connect(): Promise<void> {
    if (this.pc) this.close()
    this.stats = {
      ...this.stats,
      status: 'connecting',
      lastError: null,
      handshake: false,
    }
    this.emitStats()
    this.connectStartedAt = Date.now()

    try {
      const pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      })
      this.pc = pc
      this.localCandidates = []
      pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate?.candidate) return
        this.localCandidates.push({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        })
      })

      pc.addEventListener('connectionstatechange', () => {
        this.stats.peerState = pc.connectionState
        this.stats.iceState = pc.iceConnectionState
        this.stats.signalingState = pc.signalingState
        if (pc.connectionState === 'connected') {
          this.stats.status = 'connected'
          this.stats.connectedAt = new Date().toISOString()
          this.log('Peer WebRTC conectado', 'info')
        } else if (pc.connectionState === 'failed') {
          this.stats.status = 'failed'
          this.stats.lastError = 'Conexão WebRTC falhou (ICE/DTLS)'
          this.log(this.stats.lastError, 'error')
        } else if (pc.connectionState === 'disconnected') {
          this.log('Peer WebRTC desconectado; aguardando recuperação', 'warn')
        }
        this.emitStats()
      })

      pc.addEventListener('iceconnectionstatechange', () => {
        this.stats.iceState = pc.iceConnectionState
        this.emitStats()
      })

      if (this.options.media) {
        pc.addTransceiver('audio', { direction: 'recvonly' })
        const video = pc.addTransceiver('video', { direction: 'recvonly' })
        prioritizeH264(video)
      }

      pc.addEventListener('track', (event) => {
        if (event.track.kind === 'video') {
          const stream = event.streams[0] ?? new MediaStream([event.track])
          this.options.onVideoStream?.(stream)
          this.log('Faixa de vídeo recebida (não exibida por padrão)', 'info')
        } else if (event.track.kind === 'audio') {
          this.log('Faixa de áudio recebida (ignorada)', 'debug')
        }
      })

      this.channels.message = pc.createDataChannel('message', {
        ordered: true,
        protocol: 'messageV1',
      })
      this.channels.control = pc.createDataChannel('control', {
        ordered: true,
        protocol: 'controlV1',
      })
      this.channels.input = pc.createDataChannel('input', {
        ordered: true,
        protocol: '1.0',
      })

      this.wireChannels()

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.log(`SDP offer criado (${offer.sdp?.length ?? 0} bytes)`, 'debug')

      const answer = await api<{ sdp: string; candidates?: IceCandidatePayload[] }>(
        '/api/session/sdp',
        {
          method: 'POST',
          body: JSON.stringify({ sdp: offer.sdp }),
        },
      )
      if (!answer.sdp) throw new Error('O relay não retornou SDP de resposta')
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
      this.log(`SDP answer aplicado (${answer.sdp.length} bytes)`, 'info')

      const localCandidates = await this.collectLocalCandidates()
      this.log(`Candidatos ICE locais: ${localCandidates.length}`, 'debug')
      const remote = await api<{ candidates: IceCandidatePayload[] }>('/api/session/ice', {
        method: 'POST',
        body: JSON.stringify({
          candidates: localCandidates.length > 0 ? localCandidates : answer.candidates ?? [],
        }),
      })

      const allRemote = [...(answer.candidates ?? []), ...(remote.candidates ?? [])]
      for (const candidate of dedupeCandidates(allRemote)) {
        if (!candidate.candidate || candidate.candidate === 'a=end-of-candidates') continue
        try {
          await pc.addIceCandidate({
            candidate: candidate.candidate.replace(/^a=/, ''),
            sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : undefined,
            sdpMLineIndex:
              typeof candidate.sdpMLineIndex === 'number'
                ? candidate.sdpMLineIndex
                : Number(candidate.sdpMLineIndex ?? 0),
          })
        } catch (error) {
          this.log(`Candidato ICE remoto rejeitado: ${String(error)}`, 'warn')
        }
      }
      this.log(`Candidatos ICE remotos aplicados: ${allRemote.length}`, 'info')

      this.statsTimer = window.setInterval(() => {
        this.stats.peerState = pc.connectionState
        this.stats.iceState = pc.iceConnectionState
        this.emitStats()
      }, 1_000)

      window.setTimeout(() => {
        if (this.stats.status !== 'connected') {
          this.stats.lastError =
            'Sem conexão WebRTC após 20s. Verifique se o console está na mesma rede e o Remote Play habilitado.'
          this.stats.status = 'failed'
          this.log(this.stats.lastError, 'error')
          this.emitStats()
        }
      }, 20_000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.stats.status = 'failed'
      this.stats.lastError = message
      this.emitStats()
      this.log(`Falha ao conectar transporte: ${message}`, 'error')
      throw error
    }
  }

  private wireChannels(): void {
    const message = this.channels.message
    const control = this.channels.control
    const input = this.channels.input

    message?.addEventListener('open', () => {
      this.stats.channels.message = 'open'
      this.log('Canal message aberto; enviando handshake', 'info')
      message.send(handshakeMessage(crypto.randomUUID()))
      this.emitStats()
    })
    message?.addEventListener('message', (event) => {
      this.handleMessageChannel(event.data)
    })
    message?.addEventListener('close', () => {
      this.stats.channels.message = 'closed'
      this.emitStats()
    })

    control?.addEventListener('open', () => {
      this.stats.channels.control = 'open'
      this.log('Canal control aberto', 'info')
      this.emitStats()
    })
    control?.addEventListener('message', (event) => {
      try {
        this.log(`Control <- ${String(event.data).slice(0, 200)}`, 'debug')
      } catch {
        // ignore
      }
    })

    input?.addEventListener('open', () => {
      this.stats.channels.input = 'open'
      this.log('Canal input aberto', 'info')
      this.emitStats()
    })
    if (input) input.binaryType = 'arraybuffer'
    input?.addEventListener('message', (event) => {
      this.handleInputChannel(event.data)
    })
  }

  private handleMessageChannel(data: unknown): void {
    let parsed: { type?: string; id?: string; target?: string; content?: string }
    try {
      const value = JSON.parse(String(data)) as unknown
      if (!value || typeof value !== 'object') return
      parsed = value as { type?: string; id?: string; target?: string; content?: string }
    } catch {
      return
    }

    if (parsed.type === 'HandshakeAck') {
      this.stats.handshake = true
      this.log('Handshake concluído pelo console', 'info')
      this.channels.control?.send(authorizationRequestMessage())
      for (let slot = 0; slot < this.options.maxSlots; slot++) {
        this.channels.control?.send(gamepadChangedMessage(slot, false))
      }
      this.channels.input?.send(toArrayBuffer(encodeClientMetadataPacket(0, 1)))
      for (const message of streamingConfigMessages(() => crypto.randomUUID())) {
        this.channels.message?.send(message)
      }
      window.setTimeout(() => this.claimActiveSlots(), 400)
      this.emitStats()
      return
    }

    if (parsed.type === 'TransactionStart' || parsed.type === 'Message') {
      if (parsed.id) {
        this.log(`Mensagem do console em ${parsed.target ?? '?'}`, 'debug')
        this.channels.message?.send(transactionCompleteMessage(parsed.id, { Result: 1 }))
      }
    }
  }

  private handleInputChannel(data: unknown): void {
    if (!(data instanceof ArrayBuffer)) return
    try {
      const view = new DataView(data)
      if (view.byteLength < 4) return
      const reportType = view.getUint16(0, true)
      if ((reportType & ReportType.Vibration) === 0) return
      let offset = 2
      offset++ // rumble type
      const slot = view.getUint8(offset++)
      const rumble: VibrationReport = {
        slot,
        leftMotor: view.getUint8(offset++) / 100,
        rightMotor: view.getUint8(offset++) / 100,
        leftTrigger: view.getUint8(offset++) / 100,
        rightTrigger: view.getUint8(offset++) / 100,
        durationMs: view.getUint16(offset, true),
        delayMs: view.getUint16(offset + 2, true),
        repeat: view.getUint8(offset + 4),
      }
      this.options.onVibration?.(slot, rumble)
    } catch {
      // ignore malformed vibration report
    }
  }

  /** Latest desired state for a slot. Pass null to stop sending that slot. */
  setSlotState(slot: number, state: GamepadState | null): void {
    if (state === null) {
      this.desired.delete(slot)
      if (this.registered.has(slot)) {
        this.channels.control?.send(gamepadChangedMessage(slot, false))
        this.registered.delete(slot)
      }
      return
    }
    this.desired.set(slot, state)
  }

  /** Registers every slot that currently has a state. */
  claimActiveSlots(): void {
    if (!this.stats.handshake) return
    const slots = [...this.desired.keys()].sort((a, b) => a - b)
    this.claimSlots(slots)
  }

  claimSlots(slots: number[]): void {
    if (!this.stats.handshake) return
    const pending = slots.filter((slot) => !this.registered.has(slot))
    if (pending.length === 0) {
      this.startLoop()
      return
    }
    for (const slot of pending) {
      this.channels.control?.send(gamepadChangedMessage(slot, true))
      this.registered.add(slot)
      const slotStats = (this.stats.slots[slot] = this.stats.slots[slot] ?? {
        sent: 0,
        lastAt: null,
        registered: true,
      })
      slotStats.registered = true
      this.log(`Slot P${slot + 1} reivindicado no console`, 'info')
    }
    this.startLoop()
    this.emitStats()
  }

  releaseSlots(): void {
    for (const slot of [...this.registered]) {
      this.channels.control?.send(gamepadChangedMessage(slot, false))
      if (this.stats.slots[slot]) this.stats.slots[slot].registered = false
      this.registered.delete(slot)
    }
    this.log('Slots liberados', 'info')
    this.emitStats()
  }

  getRegisteredSlots(): number[] {
    return [...this.registered].sort((a, b) => a - b)
  }

  setCoopMode(enabled: boolean): void {
    this.options.coopMode = enabled
    this.log(`Modo co-op (physicality ${enabled ? '0/0' : '1/1'}) ${enabled ? 'ativado' : 'desativado'}`, 'info')
    this.emitStats()
  }

  private startLoop(): void {
    if (this.loop !== null) return
    this.loop = window.setInterval(() => this.tick(), TICK_MS)
  }

  stopLoop(): void {
    if (this.loop !== null) window.clearInterval(this.loop)
    this.loop = null
  }

  private tick(): void {
    if (!this.stats.handshake || this.channels.input?.readyState !== 'open') return
    const now = performance.now()
    const frames: GamepadFrame[] = []

    for (const slot of this.registered) {
      const state = this.desired.get(slot)
      if (!state) continue
      const last = this.lastSent.get(slot)
      const changed = !last || stateDistance(state, last.state) > AXIS_EPSILON
      const heartbeatDue = !last || now - last.at >= HEARTBEAT_MS
      if (!changed && !heartbeatDue) continue
      frames.push({ gamepadIndex: slot, state })
      this.lastSent.set(slot, { state, at: now })
      const slotStats = (this.stats.slots[slot] = this.stats.slots[slot] ?? {
        sent: 0,
        lastAt: null,
        registered: true,
      })
      slotStats.sent++
      slotStats.lastAt = Date.now()
    }

    if (frames.length === 0) return
    try {
      const packet = encodeInputPacket({
        sequence: ++this.sequence,
        gamepads: frames,
        physicalPhysicality: this.options.coopMode ? 0 : 1,
        virtualPhysicality: this.options.coopMode ? 0 : 1,
      })
      this.channels.input?.send(toArrayBuffer(packet))
      this.stats.packets++
      this.stats.bytes += packet.length
      const nowMs = Date.now()
      if (nowMs - this.lastEmitAt >= 250) {
        this.lastEmitAt = nowMs
        this.emitStats()
      }
    } catch (error) {
      this.log(`Falha ao codificar pacote de entrada: ${String(error)}`, 'error')
    }
  }

  private async collectLocalCandidates(): Promise<IceCandidatePayload[]> {
    const pc = this.pc
    if (!pc) return []
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        let finished = false
        const done = (): void => {
          if (finished) return
          finished = true
          window.clearTimeout(timer)
          resolve()
        }
        const timer = window.setTimeout(done, 2_500)
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') done()
        })
      })
    }
    return this.localCandidates
  }

  close(): void {
    this.stopLoop()
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer)
    this.statsTimer = null
    this.releaseSlots()
    for (const channel of Object.values(this.channels)) {
      try {
        channel?.close()
      } catch {
        // ignore
      }
    }
    this.channels = { message: null, control: null, input: null }
    try {
      this.pc?.close()
    } catch {
      // ignore
    }
    this.pc = null
    this.registered.clear()
    this.lastSent.clear()
    this.stats = {
      ...this.stats,
      status: 'closed',
      peerState: 'closed',
      iceState: 'closed',
      handshake: false,
      slots: {},
    }
    this.options.onVideoStream?.(null)
    this.emitStats()
  }

  /** Test hook: returns a plain state object usable by native injection. */
  static emptyState(): GamepadState {
    return emptyGamepadState()
  }
}

function prioritizeH264(transceiver: RTCRtpTransceiver): void {
  try {
    const capabilities = RTCRtpReceiver.getCapabilities('video')
    if (!capabilities) return
    const h264 = capabilities.codecs
      .filter((codec) => codec.mimeType.toLowerCase() === 'video/h264')
      .sort((a, b) => profileScore(b) - profileScore(a))
    if (h264.length === 0) return
    const others = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'video/h264')
    transceiver.setCodecPreferences([...h264, ...others])
  } catch {
    // Codec preference is an optimization; ignore on unsupported browsers.
  }
}

function profileScore(codec: RTCRtpCodec): number {
  const line = codec.sdpFmtpLine ?? ''
  if (line.includes('profile-level-id=4d')) return 3
  if (line.includes('profile-level-id=42e')) return 2
  if (line.includes('profile-level-id=420')) return 1
  return 0
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

function dedupeCandidates(candidates: IceCandidatePayload[]): IceCandidatePayload[] {
  const seen = new Set<string>()
  const output: IceCandidatePayload[] = []
  for (const candidate of candidates) {
    const key = `${candidate.candidate}|${candidate.sdpMid}|${candidate.sdpMLineIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(candidate)
  }
  return output
}
