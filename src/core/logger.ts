import { EventEmitter } from 'node:events'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: string
  level: LogLevel
  scope: string
  message: string
  data?: unknown
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SECRET_KEY = /token|authorization|secret|password|device_code|refresh/i

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]'
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)
    }
    return output
  }
  if (typeof value === 'string' && value.length > 2_000) return `${value.slice(0, 2_000)}...[truncated]`
  return value
}

export class Logger extends EventEmitter {
  private readonly ring: LogEntry[] = []
  private readonly maxRing: number
  private readonly filePath?: string
  private writeChain: Promise<void> = Promise.resolve()
  private minLevel: LogLevel

  constructor(options: { filePath?: string; maxRing?: number; minLevel?: LogLevel } = {}) {
    super()
    this.filePath = options.filePath
    this.maxRing = options.maxRing ?? 500
    this.minLevel = options.minLevel ?? 'debug'
    if (this.filePath) {
      this.writeChain = mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 }).then(
        () => undefined,
      )
    }
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level
  }

  private log(level: LogLevel, scope: string, message: string, data?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(data === undefined ? {} : { data: redact(data) }),
    }
    this.ring.push(entry)
    if (this.ring.length > this.maxRing) this.ring.shift()
    this.emit('entry', entry)
    if (process.env.NODE_ENV !== 'test') {
      const prefix = `[${entry.ts.slice(11, 23)}] ${level.toUpperCase().padEnd(5)} ${scope}`
      const suffix = data === undefined ? '' : ` ${safeJson(entry.data)}`
      const line = `${prefix} ${message}${suffix}`
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.log(line)
    }
    if (this.filePath) {
      const line = `${JSON.stringify(entry)}\n`
      this.writeChain = this.writeChain
        .then(() => appendFile(this.filePath as string, line, { mode: 0o600 }))
        .catch(() => undefined)
    }
  }

  debug(scope: string, message: string, data?: unknown): void {
    this.log('debug', scope, message, data)
  }

  info(scope: string, message: string, data?: unknown): void {
    this.log('info', scope, message, data)
  }

  warn(scope: string, message: string, data?: unknown): void {
    this.log('warn', scope, message, data)
  }

  error(scope: string, message: string, data?: unknown): void {
    this.log('error', scope, message, data)
  }

  child(scope: string): ScopeLogger {
    return new ScopeLogger(this, scope)
  }

  tail(limit = 200): LogEntry[] {
    return this.ring.slice(-limit)
  }

  async flush(): Promise<void> {
    await this.writeChain
  }
}

export class ScopeLogger {
  constructor(
    private readonly logger: Logger,
    private readonly scope: string,
  ) {}

  debug(message: string, data?: unknown): void {
    this.logger.debug(this.scope, message, data)
  }

  info(message: string, data?: unknown): void {
    this.logger.info(this.scope, message, data)
  }

  warn(message: string, data?: unknown): void {
    this.logger.warn(this.scope, message, data)
  }

  error(message: string, data?: unknown): void {
    this.logger.error(this.scope, message, data)
  }
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text.length > 500 ? `${text.slice(0, 500)}...` : text
  } catch {
    return '[unserializable]'
  }
}
