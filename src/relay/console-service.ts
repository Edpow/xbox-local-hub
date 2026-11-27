import type { ScopeLogger } from '../core/logger.js'
import type { DiscoveryResponse } from '../core/discovery.js'
import { fetchConsoleList, sendXccsCommand, type XboxConsoleInfo } from '../core/xbox/console-list.js'
import type { AuthService } from './auth-service.js'
import type { DiscoveryService } from './discovery-service.js'

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

export class ConsoleService {
  private lanConsoles: DiscoveryResponse[] = []
  private lastScanAt: string | null = null
  private lastDurationMs: number | null = null
  private lastErrors: string[] = []
  private lastTargets: string[] = []
  private cachedLive: { at: number; consoles: XboxConsoleInfo[] } | null = null

  constructor(
    private readonly auth: AuthService,
    private readonly discovery: DiscoveryService,
    private readonly mock: boolean,
    private readonly log: ScopeLogger,
  ) {}

  async scanLan(timeoutMs = 2_500): Promise<ConsoleListResult> {
    const result = await this.discovery.scan({ timeoutMs })
    this.lanConsoles = result.consoles
    this.lastScanAt = new Date().toISOString()
    this.lastDurationMs = result.durationMs
    this.lastErrors = result.errors
    this.lastTargets = result.targets
    return this.list()
  }

  async list(forceLive = false): Promise<ConsoleListResult> {
    if (this.mock) {
      return {
        consoles: [
          {
            serverId: 'MOCK-CONSOLE',
            name: 'Xbox Mock (simulador)',
            source: 'mock',
            connectable: true,
            powerState: 'On',
            consoleType: 'XboxOneS',
            note: 'Backend simulado: valida o protocolo localmente, não um console real.',
          },
        ],
        lanScan: this.lanInfo(),
        warnings: ['Modo MOCK ativo: nenhum console Xbox real é contatado.'],
      }
    }

    const warnings: string[] = []
    let live: XboxConsoleInfo[] = []
    if (forceLive || !this.cachedLive || Date.now() - this.cachedLive.at > 30_000) {
      try {
        const tokens = await this.auth.getSessionTokens()
        live = await fetchConsoleList(tokens.webToken)
        this.cachedLive = { at: Date.now(), consoles: live }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`Lista Xbox Live indisponível: ${message}`)
        this.log.warn('Falha ao listar consoles no Xbox Live', { error: message })
        if (this.cachedLive) live = this.cachedLive.consoles
      }
    } else {
      live = this.cachedLive.consoles
    }

    const entries: ConsoleEntry[] = []
    const lanByName = new Map<string, DiscoveryResponse>()
    for (const console of this.lanConsoles) {
      lanByName.set(console.name.toLowerCase(), console)
    }

    for (const console of live) {
      const lan = lanByName.get(console.name.toLowerCase())
      entries.push({
        serverId: console.id,
        name: console.name,
        source: 'xbox-live',
        address: lan?.address,
        smartglassUuid: lan?.uuid,
        powerState: console.powerState,
        consoleType: console.consoleType,
        connectable: true,
        note: lan
          ? 'Console na lista Xbox Live e visível na LAN.'
          : 'Console Xbox Live (IP não confirmado pela descoberta LAN).',
      })
      if (lan) lanByName.delete(console.name.toLowerCase())
    }

    for (const lan of lanByName.values()) {
      entries.push({
        serverId: null,
        name: lan.name,
        source: 'lan',
        address: lan.address,
        smartglassUuid: lan.uuid,
        connectable: false,
        note: 'Visível na LAN, mas sem serverId do Xbox Live. Entre com a conta para obter o ID de conexão.',
      })
    }

    if (entries.length === 0) {
      warnings.push(
        'Nenhum console encontrado. Verifique se o Remote Play está habilitado no Xbox e se o celular está na mesma rede.',
      )
    }

    return {
      consoles: entries,
      lanScan: this.lanInfo(),
      warnings,
    }
  }

  async powerOn(serverId: string): Promise<unknown> {
    if (!serverId) throw new Error('serverId obrigatório')
    const tokens = await this.auth.getSessionTokens()
    this.log.info('Enviando WakeUp para o console', { serverId })
    const result = await sendXccsCommand(tokens.webToken, serverId, 'Power', 'WakeUp')
    // Force a fresh Xbox Live listing on the next call.
    this.cachedLive = null
    return result
  }

  getLanConsoles(): DiscoveryResponse[] {
    return this.lanConsoles
  }

  private lanInfo(): ConsoleListResult['lanScan'] {
    return {
      lastScanAt: this.lastScanAt,
      durationMs: this.lastDurationMs,
      errors: this.lastErrors,
      targets: this.lastTargets,
    }
  }
}
