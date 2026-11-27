import { EventEmitter } from 'node:events'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Msal, TokenStore } from 'xal-node'
import type { ScopeLogger } from '../core/logger.js'
import type { WebToken } from '../core/xbox/console-list.js'

export interface DeviceCodeChallenge {
  userCode: string
  verificationUri: string
  expiresInSeconds: number
  intervalSeconds: number
  message: string
  startedAt: string
}

export interface AuthStatus {
  authenticated: boolean
  pending: boolean
  challenge?: DeviceCodeChallenge
  error?: string
  tokenFile: string
  updatedAt: string
}

export interface SessionTokens {
  gsToken: string
  baseUri: string
  webToken: WebToken
  expiresAt: number
}

const TOKEN_CACHE_MS = 4 * 60 * 1000

/**
 * Wraps xal-node's Microsoft device-code flow.
 *
 * Interoperability note: xal-node (the library used by Greenlight) ships a
 * public Azure client id. The MVP reuses that proven flow. It only ever sees
 * the Microsoft refresh token, which is stored locally with 0600 permissions.
 */
export class AuthService extends EventEmitter {
  private readonly tokenFile: string
  private readonly store: TokenStore
  private status: AuthStatus
  private challenge: DeviceCodeChallenge | null = null
  private pollInFlight = false
  private sessionTokens: SessionTokens | null = null

  constructor(
    tokenFile: string,
    private readonly log: ScopeLogger,
  ) {
    super()
    this.tokenFile = tokenFile
    this.store = new TokenStore()
    this.status = {
      authenticated: false,
      pending: false,
      tokenFile,
      updatedAt: new Date().toISOString(),
    }
    this.loadFromDisk()
  }

  private loadFromDisk(): void {
    try {
      this.store.load(this.tokenFile, true)
      const userToken = this.store.getUserToken()
      if (userToken) {
        this.status.authenticated = true
        this.log.info('Refresh token carregado', {
          expiresOn: userToken.data.expires_on ?? null,
        })
      }
    } catch (error) {
      this.log.warn('Não foi possível ler o arquivo de tokens', { error: String(error) })
    }
    this.emitStatus()
  }

  getStatus(): AuthStatus {
    return {
      ...this.status,
      challenge: this.challenge ?? undefined,
    }
  }

  private emitStatus(): void {
    this.status.updatedAt = new Date().toISOString()
    this.emit('status', this.getStatus())
  }

  async ensureTokenFile(): Promise<void> {
    await mkdir(dirname(this.tokenFile), { recursive: true, mode: 0o700 })
    try {
      await chmod(this.tokenFile, 0o600)
    } catch {
      // File does not exist yet.
    }
  }

  async beginDeviceCode(): Promise<AuthStatus> {
    if (this.pollInFlight) return this.getStatus()
    await this.ensureTokenFile()
    this.status = { ...this.status, pending: true, error: undefined }
    this.emitStatus()

    const msal = new Msal(this.store)
    try {
      const challenge = await msal.doDeviceCodeAuth()
      const startedAt = new Date().toISOString()
      this.challenge = {
        userCode: challenge.user_code,
        verificationUri: challenge.verification_uri,
        expiresInSeconds: challenge.expires_in,
        intervalSeconds: challenge.interval,
        message: challenge.message,
        startedAt,
      }
      this.status = { ...this.status, pending: true, challenge: this.challenge }
      this.emitStatus()
      this.log.info('Device code gerado', { userCode: challenge.user_code })
      void this.pollDeviceCode(msal, challenge.device_code, challenge.expires_in)
      return this.getStatus()
    } catch (error) {
      this.status = {
        ...this.status,
        pending: false,
        error: `Falha ao gerar device code: ${String(error)}`,
      }
      this.emitStatus()
      throw error
    }
  }

  private async pollDeviceCode(msal: Msal, deviceCode: string, expiresInSeconds: number): Promise<void> {
    if (this.pollInFlight) return
    this.pollInFlight = true
    try {
      const timeoutMs = Math.max(60, expiresInSeconds) * 1000
      await msal.doPollForDeviceCodeAuth(deviceCode, timeoutMs)
      await this.ensureTokenFile()
      this.status = {
        ...this.status,
        authenticated: true,
        pending: false,
        challenge: undefined,
        error: undefined,
      }
      this.challenge = null
      this.sessionTokens = null
      this.log.info('Autenticação Microsoft concluída')
      this.emitStatus()
    } catch (error) {
      this.status = {
        ...this.status,
        pending: false,
        error: String(error),
      }
      this.challenge = null
      this.log.error('Falha na autenticação por device code', { error: String(error) })
      this.emitStatus()
    } finally {
      this.pollInFlight = false
    }
  }

  private assertAuthenticated(): void {
    if (!this.store.getUserToken()) {
      throw new Error('Autenticação necessária: entre com uma conta Microsoft')
    }
  }

  /**
   * Returns the xHome streaming token plus the Xbox Live web token (console
   * list). Tokens are cached for a few minutes to avoid hammering Microsoft.
   */
  async getSessionTokens(): Promise<SessionTokens> {
    this.assertAuthenticated()
    if (this.sessionTokens && this.sessionTokens.expiresAt > Date.now()) {
      return this.sessionTokens
    }

    const msal = new Msal(this.store)
    this.log.info('Renovando tokens Xbox Live')
    await msal.getOrRefreshUserToken()
    await this.ensureTokenFile()

    const gssvToken = await msal.getGssvToken()
    const xhomeToken = await msal.getStreamToken(gssvToken.data.Token, 'xhome')
    const webToken = await msal.getWebToken()

    const region = pickDefaultRegion(xhomeToken)
    if (!region) throw new Error('O token xHome não retornou nenhuma região utilizável')

    const uhs = webToken.data.DisplayClaims?.xui?.[0]?.uhs
    if (!uhs) throw new Error('O token do Xbox Live não inclui user hash (uhs)')

    this.sessionTokens = {
      gsToken: xhomeToken.data.gsToken,
      baseUri: region,
      webToken: { token: webToken.data.Token, uhs },
      expiresAt: Date.now() + TOKEN_CACHE_MS,
    }
    this.status = { ...this.status, authenticated: true, error: undefined }
    this.emitStatus()
    this.log.info('Tokens xHome obtidos', { baseUri: region })
    return this.sessionTokens
  }

  getWebTokenCached(): WebToken | null {
    return this.sessionTokens?.webToken ?? null
  }

  async logout(): Promise<void> {
    try {
      this.store.removeAll()
    } catch {
      // ignore
    }
    this.sessionTokens = null
    this.challenge = null
    this.status = {
      ...this.status,
      authenticated: false,
      pending: false,
      challenge: undefined,
      error: undefined,
    }
    this.emitStatus()
    this.log.info('Sessão Microsoft removida')
  }

  /** Used by the CLI to read the token file without exposing secrets. */
  async hasTokenFile(): Promise<boolean> {
    try {
      const text = await readFile(this.tokenFile, 'utf8')
      return text.trim().length > 2
    } catch {
      return false
    }
  }
}

interface StreamingTokenLike {
  data?: {
    offeringSettings?: {
      regions?: Array<{ isDefault?: boolean; baseUri?: string }>
    }
  }
}

function pickDefaultRegion(token: StreamingTokenLike): string | null {
  const regions = token.data?.offeringSettings?.regions ?? []
  const preferred = regions.find((region) => region.isDefault) ?? regions[0]
  if (!preferred?.baseUri) return null
  return preferred.baseUri
}
