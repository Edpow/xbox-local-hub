import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

export interface RelayConfig {
  host: string
  port: number
  mock: boolean
  dev: boolean
  dataDir: string
  authFile: string
  logFile: string
  accessToken: string | null
  publicDir: string
  version: string
}

export interface ConfigOverrides {
  host?: string
  port?: number
  mock?: boolean
  dev?: boolean
  dataDir?: string
  accessToken?: string | null
}

export function defaultDataDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'xbox-local-hub')
}

export function loadConfig(overrides: ConfigOverrides = {}): RelayConfig {
  const mock = overrides.mock ?? process.env.XLH_MOCK === '1'
  const dev = overrides.dev ?? process.env.NODE_ENV === 'development'
  const dataDir = overrides.dataDir ?? process.env.XLH_DATA_DIR ?? defaultDataDir()
  const host = overrides.host ?? process.env.XLH_HOST ?? '127.0.0.1'
  const port = overrides.port ?? Number(process.env.XLH_PORT ?? 8787)

  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dataDir, 0o700)
  } catch {
    // ignore
  }

  const explicitToken = overrides.accessToken ?? process.env.XLH_ACCESS_TOKEN ?? null
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'
  let accessToken = explicitToken
  if (!accessToken && !loopback && !mock) {
    accessToken = loadOrCreateAccessToken(dataDir)
  }

  return {
    host,
    port: Number.isFinite(port) ? port : 8787,
    mock,
    dev,
    dataDir,
    authFile: join(dataDir, 'auth.json'),
    logFile: join(dataDir, 'logs', 'relay.jsonl'),
    accessToken: accessToken || null,
    publicDir: join(process.cwd(), 'public'),
    version: '0.1.0',
  }
}

export function loadOrCreateAccessToken(dataDir: string): string {
  const file = join(dataDir, 'access-token')
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim()
    if (token) return token
  }
  const token = randomBytes(24).toString('base64url')
  writeFileSync(file, token, { mode: 0o600 })
  return token
}

export function dashboardUrl(config: RelayConfig): string {
  const displayHost = config.host === '0.0.0.0' ? '127.0.0.1' : config.host
  const suffix = config.accessToken ? `/?token=${encodeURIComponent(config.accessToken)}` : '/'
  return `http://${displayHost}:${config.port}${suffix}`
}
