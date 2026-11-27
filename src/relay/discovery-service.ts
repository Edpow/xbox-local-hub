import dgram from 'node:dgram'
import type { ScopeLogger } from '../core/logger.js'
import {
  SMARTGLASS_BROADCAST,
  SMARTGLASS_MULTICAST,
  SMARTGLASS_PORT,
  decodeDiscoveryResponse,
  encodeDiscoveryRequest,
  type DiscoveryResponse,
} from '../core/discovery.js'

export interface DiscoveryScanOptions {
  timeoutMs?: number
  tries?: number
  targets?: string[]
}

export interface DiscoveryScanResult {
  consoles: DiscoveryResponse[]
  durationMs: number
  errors: string[]
  targets: string[]
}

/**
 * Sends SmartGlass discovery datagrams over UDP 5050 and collects responses.
 * Broadcast/multicast can be blocked by a container or firewall; individual
 * IPs can be supplied as fallback (`targets`).
 */
export class DiscoveryService {
  constructor(private readonly log: ScopeLogger) {}

  async scan(options: DiscoveryScanOptions = {}): Promise<DiscoveryScanResult> {
    const timeoutMs = Math.max(300, options.timeoutMs ?? 2_500)
    const tries = Math.max(1, options.tries ?? 2)
    const targets = [...new Set([SMARTGLASS_BROADCAST, SMARTGLASS_MULTICAST, ...(options.targets ?? [])])]
    const started = Date.now()
    const consoles = new Map<string, DiscoveryResponse>()
    const errors: string[] = []

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const request = encodeDiscoveryRequest()

    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))

    socket.on('error', (error) => {
      errors.push(error.message)
      this.log.warn('Erro no socket de descoberta', { error: error.message })
      try {
        socket.close()
      } catch {
        // ignore
      }
    })

    socket.on('message', (message, remote) => {
      try {
        const parsed = decodeDiscoveryResponse(message, remote.address)
        const key = parsed.uuid || `${parsed.address}:${parsed.name}`
        if (!consoles.has(key)) {
          consoles.set(key, parsed)
          this.log.info('Console descoberto na LAN', {
            address: parsed.address,
            name: parsed.name,
            uuid: parsed.uuid,
          })
        }
      } catch (error) {
        this.log.debug('Datagrama de descoberta ignorado', {
          address: remote.address,
          error: String(error),
          bytes: message.length,
        })
      }
    })

    try {
      await new Promise<void>((resolve) => socket.bind(0, '0.0.0.0', () => resolve()))
      try {
        socket.setBroadcast(true)
      } catch (error) {
        errors.push(`setBroadcast: ${String(error)}`)
      }

      for (let attempt = 0; attempt < tries; attempt++) {
        for (const target of targets) {
          socket.send(request, SMARTGLASS_PORT, target, (error) => {
            if (error) errors.push(`${target}: ${error.message}`)
          })
        }
        await new Promise((resolve) => setTimeout(resolve, Math.max(120, timeoutMs / tries)))
      }
    } finally {
      try {
        socket.close()
      } catch {
        // ignore
      }
      await closed
    }

    const result = [...consoles.values()]
    this.log.info('Varredura concluída', {
      consoles: result.length,
      durationMs: Date.now() - started,
      errors: errors.length,
    })
    return { consoles: result, durationMs: Date.now() - started, errors, targets }
  }
}
