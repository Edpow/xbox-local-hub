import { EventEmitter } from 'node:events'
import { RTCPeerConnection, type RTCDataChannel } from 'werift'
import type { ScopeLogger } from '../core/logger.js'
import { decodeInputPacket, type DecodedGamepadFrame } from '../core/input-packet.js'
import type { IceCandidate } from '../core/xbox/gssv.js'

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

export interface MockConsoleStats {
  connectionState: string
  iceConnectionState: string
  channels: string[]
  controlMessages: Array<{ at: string; message: unknown }>
  registeredSlots: number[]
  packets: number
  bytes: number
  lastPacketAt: string | null
  slots: Record<number, MockSlotStats>
  startedAt: string
}

/**
 * A software stand-in for an Xbox console. It accepts a browser WebRTC offer,
 * answers it, and decodes the real input packets. This lets the whole
 * pipeline (UI -> control/input channels -> binary frames) be validated
 * without hardware, while never being presented as proof of console
 * compatibility.
 */
export class MockConsole extends EventEmitter {
  private pc: RTCPeerConnection | null = null
  private localCandidates: IceCandidate[] = []
  private channels = new Map<string, RTCDataChannel>()
  private controlMessages: Array<{ at: string; message: unknown }> = []
  private registeredSlots = new Set<number>()
  private packets = 0
  private bytes = 0
  private lastPacketAt: string | null = null
  private slots: Record<number, MockSlotStats> = {}
  private startedAt = new Date().toISOString()
  private lastEmitAt = 0

  constructor(private readonly log: ScopeLogger) {
    super()
  }

  async answerOffer(offerSdp: string): Promise<{ sdp: string; candidates: IceCandidate[] }> {
    await this.close()
    this.localCandidates = []
    this.pc = new RTCPeerConnection({ iceServers: [] })
    const pc = this.pc

    pc.onDataChannel.subscribe((channel) => {
      this.attachChannel(channel)
    })
    pc.onIceCandidate.subscribe((candidate) => {
      if (!candidate?.candidate) return
      this.localCandidates.push({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      })
    })
    pc.connectionStateChange.subscribe((state) => {
      this.log.info('Mock console: estado WebRTC', { state })
      this.emit('update')
    })
    pc.iceConnectionStateChange.subscribe((state) => {
      this.log.debug('Mock console: estado ICE', { state })
    })

    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await this.waitForGathering(pc)

    const sdp = pc.localDescription?.sdp ?? answer.sdp
    this.log.info('Mock console: SDP answer criado', {
      candidates: this.localCandidates.length,
      sdpBytes: sdp.length,
    })
    this.emit('update')
    return { sdp, candidates: this.localCandidates }
  }

  private async waitForGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, 2_000)
      pc.iceGatheringStateChange.subscribe((state) => {
        if (state === 'complete') finish()
      })
    })
  }

  async addRemoteCandidates(candidates: IceCandidate[]): Promise<void> {
    if (!this.pc) return
    for (const candidate of candidates) {
      if (!candidate.candidate || candidate.candidate === 'a=end-of-candidates') continue
      try {
        await this.pc.addIceCandidate({
          candidate: candidate.candidate.replace(/^a=/, ''),
          sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : undefined,
          sdpMLineIndex:
            typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : undefined,
        })
      } catch (error) {
        this.log.warn('Mock console: candidato ICE rejeitado', { error: String(error) })
      }
    }
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channels.set(channel.label, channel)
    this.log.info('Mock console: canal recebido', {
      label: channel.label,
      protocol: channel.protocol,
    })

    channel.stateChanged.subscribe((state) => {
      if (state === 'open') {
        this.log.info('Mock console: canal aberto', { label: channel.label })
        this.emit('update')
      }
    })

    channel.onMessage.subscribe((data) => {
      const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      if (channel.label === 'input') {
        this.handleInput(buffer)
      } else if (channel.label === 'control') {
        this.handleControl(buffer)
      } else if (channel.label === 'message') {
        this.handleMessage(channel, buffer)
      }
    })
    this.emit('update')
  }

  private handleControl(buffer: Uint8Array): void {
    try {
      const message = JSON.parse(new TextDecoder().decode(buffer)) as Record<string, unknown>
      this.controlMessages.push({ at: new Date().toISOString(), message })
      if (this.controlMessages.length > 100) this.controlMessages.shift()
      if (message.message === 'gamepadChanged' && typeof message.gamepadIndex === 'number') {
        if (message.wasAdded === true) this.registeredSlots.add(message.gamepadIndex)
        else this.registeredSlots.delete(message.gamepadIndex)
      }
      this.emit('update')
    } catch {
      // ignore malformed control messages
    }
  }

  private handleMessage(channel: RTCDataChannel, buffer: Uint8Array): void {
    try {
      const message = JSON.parse(new TextDecoder().decode(buffer)) as Record<string, unknown>
      if (message.type === 'Handshake') {
        channel.send(
          JSON.stringify({
            type: 'HandshakeAck',
            id: typeof message.id === 'string' ? message.id : 'mock',
            cv: '',
          }),
        )
        this.log.info('Mock console: handshake concluído')
      }
      this.emit('update')
    } catch {
      // ignore
    }
  }

  private handleInput(buffer: Uint8Array): void {
    this.packets++
    this.bytes += buffer.length
    this.lastPacketAt = new Date().toISOString()
    try {
      const decoded = decodeInputPacket(buffer)
      for (const frame of decoded.gamepads) {
        this.recordFrame(decoded.sequence, frame)
      }
    } catch (error) {
      this.log.warn('Mock console: pacote de entrada inválido', {
        error: String(error),
        bytes: buffer.length,
      })
    }
    const now = Date.now()
    if (now - this.lastEmitAt >= 250) {
      this.lastEmitAt = now
      this.emit('update')
    }
  }

  private recordFrame(sequence: number, frame: DecodedGamepadFrame): void {
    const current = this.slots[frame.gamepadIndex]
    this.slots[frame.gamepadIndex] = {
      frames: (current?.frames ?? 0) + 1,
      lastSequence: sequence,
      lastAt: new Date().toISOString(),
      buttons: frame.rawButtons,
      leftTrigger: frame.rawLeftTrigger,
      rightTrigger: frame.rawRightTrigger,
      leftStickX: frame.rawLeftStickX,
      leftStickY: frame.rawLeftStickY,
      rightStickX: frame.rawRightStickX,
      rightStickY: frame.rawRightStickY,
    }
  }

  getStats(): MockConsoleStats {
    return {
      connectionState: this.pc?.connectionState ?? 'closed',
      iceConnectionState: this.pc?.iceConnectionState ?? 'closed',
      channels: [...this.channels.keys()],
      controlMessages: this.controlMessages.slice(-20),
      registeredSlots: [...this.registeredSlots].sort(),
      packets: this.packets,
      bytes: this.bytes,
      lastPacketAt: this.lastPacketAt,
      slots: { ...this.slots },
      startedAt: this.startedAt,
    }
  }

  async close(): Promise<void> {
    if (!this.pc) return
    try {
      this.pc.close()
    } catch {
      // ignore
    }
    this.pc = null
    this.channels.clear()
    this.emit('update')
  }
}
