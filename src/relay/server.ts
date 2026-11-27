import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { Logger } from '../core/logger.js'
import { PlayerManager } from '../core/player-manager.js'
import type { DiscoveryResponse } from '../core/discovery.js'
import { AuthService, type AuthStatus } from './auth-service.js'
import { ConsoleService, type ConsoleListResult } from './console-service.js'
import { loadConfig, type ConfigOverrides, type RelayConfig } from './config.js'
import { DiscoveryService } from './discovery-service.js'
import { SessionService, type SessionSnapshot } from './session-service.js'

export interface AppState {
  version: string
  mode: 'xbox' | 'mock'
  now: string
  uptimeSeconds: number
  auth: AuthStatus & { mock?: boolean }
  session: SessionSnapshot
  players: ReturnType<PlayerManager['snapshot']>
  diagnostics: {
    wsClients: number
    rttMs: number | null
    lastLanScanAt: string | null
    lanErrors: string[]
  }
}

export interface RelayApp {
  config: RelayConfig
  logger: Logger
  auth: AuthService
  consoles: ConsoleService
  session: SessionService
  players: PlayerManager
  state: () => AppState
  listen: () => Promise<{ port: number; url: string }>
  close: () => Promise<void>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

export async function createApp(overrides: ConfigOverrides = {}): Promise<RelayApp> {
  const config = loadConfig(overrides)
  const logger = new Logger({ filePath: config.logFile })
  if (config.dev) logger.setMinLevel('debug')
  const log = logger.child('relay')

  const auth = new AuthService(config.authFile, logger.child('auth'))
  const discovery = new DiscoveryService(logger.child('discovery'))
  const consoles = new ConsoleService(auth, discovery, config.mock, logger.child('consoles'))
  const session = new SessionService(auth, config.mock ? 'mock' : 'xbox', logger.child('session'))
  const players = new PlayerManager(join(config.dataDir, 'players.json'))
  const startedAt = Date.now()

  const state = (): AppState => {
    const lan = consoles.getLanConsoles()
    return {
      version: config.version,
      mode: config.mock ? 'mock' : 'xbox',
      now: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      auth: config.mock
        ? {
            authenticated: true,
            pending: false,
            tokenFile: '(mock)',
            updatedAt: new Date().toISOString(),
            mock: true,
          }
        : auth.getStatus(),
      session: session.getSnapshot(),
      players: players.snapshot(),
      diagnostics: {
        wsClients: hub?.clientCount() ?? 0,
        rttMs: hub?.lastRtt() ?? null,
        lastLanScanAt: lastLanScanAt,
        lanErrors: lan.length === 0 ? [] : [],
      },
    }
  }

  let lastLanScanAt: string | null = null
  let hub: WsHub | null = null

  const httpServer = createHttpServer((req, res) => {
    void handleRequest(req, res)
  })

  const wss = new WebSocketServer({ noServer: true })

  class WsHub {
    private clients = new Map<WebSocket, { id: string; rttMs: number | null }>()
    private pingTimer: NodeJS.Timeout

    constructor() {
      this.pingTimer = setInterval(() => this.ping(), 10_000)
      this.pingTimer.unref?.()
    }

    add(ws: WebSocket): void {
      const id = Math.random().toString(36).slice(2, 10)
      this.clients.set(ws, { id, rttMs: null })
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as { type?: string; t?: number }
          if (message.type === 'pong' && typeof message.t === 'number') {
            const entry = this.clients.get(ws)
            if (entry) entry.rttMs = Math.max(0, Date.now() - message.t)
          }
        } catch {
          // ignore malformed client messages
        }
      })
      ws.on('close', () => this.clients.delete(ws))
      this.send(ws, { type: 'state', data: state() })
      this.send(ws, { type: 'logs', data: logger.tail(120) })
    }

    send(ws: WebSocket, payload: unknown): void {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
    }

    broadcast(payload: unknown): void {
      const text = JSON.stringify(payload)
      for (const ws of this.clients.keys()) {
        if (ws.readyState === ws.OPEN) ws.send(text)
      }
    }

    private ping(): void {
      const t = Date.now()
      for (const ws of this.clients.keys()) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping', t }))
      }
    }

    clientCount(): number {
      return this.clients.size
    }

    lastRtt(): number | null {
      let best: number | null = null
      for (const entry of this.clients.values()) {
        if (entry.rttMs !== null && (best === null || entry.rttMs < best)) best = entry.rttMs
      }
      return best
    }

    close(): void {
      clearInterval(this.pingTimer)
      for (const ws of this.clients.keys()) ws.terminate()
      this.clients.clear()
    }
  }

  hub = new WsHub()

  let broadcastScheduled = false
  const scheduleBroadcast = (): void => {
    if (broadcastScheduled) return
    broadcastScheduled = true
    setTimeout(() => {
      broadcastScheduled = false
      hub?.broadcast({ type: 'state', data: state() })
    }, 150).unref?.()
  }

  auth.on('status', scheduleBroadcast)
  session.on('update', scheduleBroadcast)
  logger.on('entry', (entry) => hub?.broadcast({ type: 'log', data: entry }))

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    if (!isAuthorized(request, url, config)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      hub?.add(ws)
    })
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return await serveStatic(res, config, 'index.html')
      }
      if (req.method === 'GET' && /^\/(app\.js|app\.js\.map|styles\.css|favicon\.ico)$/.test(url.pathname)) {
        return await serveStatic(res, config, url.pathname.slice(1))
      }
      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true, version: config.version, mode: state().mode })
      }
      if (!url.pathname.startsWith('/api/')) {
        return json(res, 404, { error: 'not_found' })
      }
      if (!isAuthorized(req, url, config)) {
        return json(res, 401, { error: 'unauthorized', message: 'Token de acesso inválido' })
      }

      const method = req.method ?? 'GET'
      const path = url.pathname.replace(/\/+$/, '') || '/'

      if (method === 'GET' && path === '/api/state') {
        return json(res, 200, state())
      }

      if (method === 'GET' && path === '/api/logs') {
        const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') ?? 200)))
        return json(res, 200, { logs: logger.tail(limit) })
      }

      if (method === 'GET' && path === '/api/diagnostics') {
        return json(res, 200, {
          state: state(),
          logs: logger.tail(250),
          mock: config.mock ? session.getSnapshot().mock ?? null : null,
        })
      }

      if (method === 'GET' && path === '/api/consoles') {
        const scan = url.searchParams.get('scan') === '1'
        const result: ConsoleListResult = scan
          ? await consoles.scanLan(Number(url.searchParams.get('timeout') ?? 2500))
          : await consoles.list()
        if (scan) lastLanScanAt = new Date().toISOString()
        scheduleBroadcast()
        return json(res, 200, result)
      }

      if (method === 'POST' && path === '/api/discovery/scan') {
        const result = await consoles.scanLan(2500)
        lastLanScanAt = new Date().toISOString()
        scheduleBroadcast()
        return json(res, 200, result)
      }

      if (method === 'POST' && path === '/api/consoles/power-on') {
        const body = await readJson(req)
        if (typeof body.serverId !== 'string' || !body.serverId.trim()) {
          return json(res, 400, { error: 'serverId_required' })
        }
        const result = await consoles.powerOn(body.serverId.trim())
        scheduleBroadcast()
        return json(res, 200, { ok: true, result })
      }

      if (method === 'GET' && path === '/api/lan-consoles') {
        const result: DiscoveryResponse[] = consoles.getLanConsoles()
        return json(res, 200, { consoles: result })
      }

      if (method === 'POST' && path === '/api/auth/device-code') {
        if (config.mock) return json(res, 200, state().auth)
        const status = await auth.beginDeviceCode()
        return json(res, 200, status)
      }

      if (method === 'POST' && path === '/api/auth/logout') {
        await auth.logout()
        return json(res, 200, { ok: true })
      }

      if (method === 'GET' && path === '/api/auth/status') {
        return json(res, 200, state().auth)
      }

      if (method === 'POST' && path === '/api/session/start') {
        const body = await readJson(req)
        const serverId =
          typeof body.serverId === 'string' && body.serverId.trim()
            ? body.serverId.trim()
            : config.mock
              ? 'MOCK-CONSOLE'
              : ''
        if (!serverId) return json(res, 400, { error: 'serverId_required' })
        const snapshot = await session.start(serverId)
        return json(res, 200, snapshot)
      }

      if (method === 'POST' && path === '/api/session/stop') {
        return json(res, 200, await session.stop())
      }

      if (method === 'POST' && path === '/api/session/keepalive') {
        await session.ping()
        return json(res, 200, { ok: true })
      }

      if (method === 'POST' && path === '/api/session/sdp') {
        const body = await readJson(req)
        if (typeof body.sdp !== 'string' || !body.sdp.trim()) {
          return json(res, 400, { error: 'sdp_required' })
        }
        const result = await session.exchangeSdp(body.sdp)
        return json(res, 200, result)
      }

      if (method === 'POST' && path === '/api/session/ice') {
        const body = await readJson(req)
        const candidates = Array.isArray(body.candidates) ? body.candidates : []
        const remote = await session.exchangeIce(candidates)
        return json(res, 200, { candidates: remote })
      }

      if (method === 'GET' && path === '/api/players') {
        return json(res, 200, players.snapshot())
      }

      if (method === 'POST' && path === '/api/players/assign') {
        const body = await readJson(req)
        if (typeof body.slot !== 'number' || typeof body.controllerId !== 'string') {
          return json(res, 400, { error: 'slot_and_controller_required' })
        }
        const snapshot = players.assign({
          slot: body.slot,
          controllerId: body.controllerId,
          controllerName:
            typeof body.controllerName === 'string' ? body.controllerName : undefined,
          source:
            body.source === 'web' || body.source === 'native' ? body.source : 'manual',
        })
        scheduleBroadcast()
        return json(res, 200, snapshot)
      }

      if (method === 'POST' && path === '/api/players/unassign') {
        const body = await readJson(req)
        if (typeof body.slot !== 'number') return json(res, 400, { error: 'slot_required' })
        const snapshot = players.unassign(body.slot)
        scheduleBroadcast()
        return json(res, 200, snapshot)
      }

      if (method === 'POST' && path === '/api/players/reset') {
        const snapshot = players.reset()
        scheduleBroadcast()
        return json(res, 200, snapshot)
      }

      return json(res, 404, { error: 'not_found', path })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('Erro na API', { path: url.pathname, error: message })
      return json(res, 500, { error: 'internal_error', message })
    }
  }

  async function serveStatic(res: ServerResponse, cfg: RelayConfig, relative: string): Promise<void> {
    const root = resolve(cfg.publicDir)
    const target = resolve(join(root, normalize(relative)))
    if (!target.startsWith(root)) return json(res, 403, { error: 'forbidden' })
    try {
      const info = await stat(target)
      if (!info.isFile()) return json(res, 404, { error: 'not_found' })
      const body = await readFile(target)
      res.writeHead(200, {
        'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': cfg.dev ? 'no-store' : 'public, max-age=60',
      })
      res.end(body)
    } catch {
      if (relative === 'favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }
      json(res, 404, {
        error: 'dashboard_not_built',
        message: 'Execute `npm run build:dashboard` para gerar o dashboard.',
      })
    }
  }

  return {
    config,
    logger,
    auth,
    consoles,
    session,
    players,
    state,
    async listen() {
      await new Promise<void>((resolveListen, rejectListen) => {
        httpServer.once('error', rejectListen)
        httpServer.listen(config.port, config.host, () => {
          httpServer.off('error', rejectListen)
          resolveListen()
        })
      })
      const address = httpServer.address()
      const port = typeof address === 'object' && address ? address.port : config.port
      log.info('Relay iniciado', {
        host: config.host,
        port,
        mock: config.mock,
        authRequired: Boolean(config.accessToken),
      })
      return { port, url: `http://${config.host}:${port}` }
    },
    async close() {
      hub?.close()
      await session.stop()
      await new Promise<void>((resolveClose) => wss.close(() => resolveClose()))
      await new Promise<void>((resolveClose) => httpServer.close(() => resolveClose()))
      await logger.flush()
    },
  }
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > 2 * 1024 * 1024) throw new Error('Request body too large')
    chunks.push(buffer)
  }
  if (total === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw new Error('Invalid JSON body')
  }
}

function isAuthorized(req: IncomingMessage, url: URL, config: RelayConfig): boolean {
  if (!config.accessToken) return true
  const header = req.headers.authorization
  if (header === `Bearer ${config.accessToken}`) return true
  return url.searchParams.get('token') === config.accessToken
}

