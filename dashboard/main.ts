import {
  api,
  isEmbedMode,
  isTestMode,
  RelaySocket,
  type AppState,
  type ConsoleEntry,
  type ConsoleListResult,
  type AuthStatus,
  type LogEntry,
} from './api.js'
import { XboxPeer, type PeerStats, type VibrationReport } from './peer.js'
import {
  BUTTON,
  BUTTON_NAMES,
  clamp,
  emptyGamepadState,
  PLAYER_SLOTS,
  stateFromWebGamepad,
  type GamepadState,
} from '../src/core/gamepad.js'

declare global {
  interface Window {
    XLH?: {
      version: string
      setNativeGamepad: (slot: number, state: unknown, name?: string) => void
      setNativeFrame: (frame: unknown) => void
      clearNativeGamepad: (slot: number) => void
      clearAllNative: () => void
      claim: () => void
      release: () => void
      getStatus: () => unknown
    }
    __XLH_TEST__?: {
      getStatus: () => unknown
      getPeerStats: () => PeerStats | null
      pulse: (slot: number) => void
      native: unknown
    }
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Elemento ausente: #${id}`)
  return element as T
}

const els = {
  alerts: $('alerts'),
  chips: {
    mode: $('chip-mode'),
    ws: $('chip-ws'),
    auth: $('chip-auth'),
    session: $('chip-session'),
    transport: $('chip-transport'),
  },
  authTitle: $('auth-title'),
  authDetail: $('auth-detail'),
  btnLogin: $<HTMLButtonElement>('btn-login'),
  deviceCode: $('device-code'),
  deviceLink: $<HTMLAnchorElement>('device-link'),
  deviceCodeValue: $('device-code-value'),
  deviceCodeStatus: $('device-code-status'),
  btnCopyCode: $<HTMLButtonElement>('btn-copy-code'),
  btnScan: $<HTMLButtonElement>('btn-scan'),
  scanMeta: $('scan-meta'),
  consoleList: $('console-list'),
  sessionState: $('session-state'),
  sessionId: $('session-id'),
  sessionServer: $('session-server'),
  sessionMedia: $('session-media'),
  btnStop: $<HTMLButtonElement>('btn-stop'),
  btnKeepalive: $<HTMLButtonElement>('btn-keepalive'),
  btnCopyDiag: $<HTMLButtonElement>('btn-copy-diag'),
  optMedia: $<HTMLInputElement>('opt-media'),
  optSlots: $<HTMLInputElement>('opt-slots'),
  optPreview: $<HTMLInputElement>('opt-preview'),
  optCoop: $<HTMLInputElement>('opt-coop'),
  btnTransport: $<HTMLButtonElement>('btn-transport'),
  transportBadge: $('transport-badge'),
  peerState: $('peer-state'),
  iceState: $('ice-state'),
  channelState: $('channel-state'),
  handshakeState: $('handshake-state'),
  preview: $<HTMLVideoElement>('preview'),
  mediaNote: $('media-note'),
  players: $('players'),
  btnClaim: $<HTMLButtonElement>('btn-claim'),
  btnRelease: $<HTMLButtonElement>('btn-release'),
  btnTestAll: $<HTMLButtonElement>('btn-test-all'),
  playersNote: $('players-note'),
  stats: $('stats'),
  logs: $('logs'),
  btnClearLogs: $<HTMLButtonElement>('btn-clear-logs'),
  btnDownloadLogs: $<HTMLButtonElement>('btn-download-logs'),
  logCount: $('log-count'),
  version: $('version'),
  footerMode: $('footer-mode'),
}

const embed = isEmbedMode()
if (embed) document.body.classList.add('embed')

const params = new URLSearchParams(window.location.search)

// ---------------------------------------------------------------------------
// Domain state
// ---------------------------------------------------------------------------

let appState: AppState | null = null
let consoleResult: ConsoleListResult | null = null
let peer: XboxPeer | null = null
let peerStats: PeerStats | null = null
let socketOnline = false

const slotGamepads: Array<number | null> = [null, null, null, null]
const nativeStates = new Map<number, GamepadState>()
const nativeNames = new Map<number, string>()
const nativeLastSeen = new Map<number, number>()
const testPulses = new Map<number, number>()
const ignoredGamepads = new Set<number>()
const knownGamepads = new Set<number>()

let logs: LogEntry[] = []
let logKeys = new Set<string>()
let stateReceivedAt = Date.now()
let busy = false
let sessionStarting = false

interface PlayerCardRefs {
  root: HTMLElement
  select: HTMLSelectElement
  source: HTMLElement
  status: HTMLElement
  buttons: Map<string, HTMLElement>
  axes: Record<'LX' | 'LY' | 'RX' | 'RY' | 'LT' | 'RT', HTMLElement>
  meta: HTMLElement
  test: HTMLButtonElement
}

const playerCards: PlayerCardRefs[] = []

// ---------------------------------------------------------------------------
// Utility/UI primitives
// ---------------------------------------------------------------------------

function chip(element: HTMLElement, text: string, level: 'neutral' | 'ok' | 'warn' | 'err' = 'neutral'): void {
  element.textContent = text
  element.className = `chip ${level === 'neutral' ? '' : level}`.trim()
}

function badge(element: HTMLElement, text: string, level: 'neutral' | 'ok' | 'warn' | 'err' = 'neutral'): void {
  element.textContent = text
  element.className = `badge ${level === 'neutral' ? '' : level}`.trim()
}

function notify(message: string, level: 'info' | 'warn' | 'error' = 'info', timeoutMs = 0): void {
  const alert = document.createElement('div')
  alert.className = `alert${level === 'error' ? ' error' : ''}`
  const text = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = level === 'error' ? 'Erro: ' : level === 'warn' ? 'Atenção: ' : ''
  text.append(strong, document.createTextNode(message))
  const close = document.createElement('button')
  close.textContent = 'fechar'
  close.onclick = () => alert.remove()
  alert.append(text, close)
  els.alerts.append(alert)
  if (timeoutMs > 0) window.setTimeout(() => alert.remove(), timeoutMs)
}

function localLog(scope: string, message: string, level: LogEntry['level'] = 'info'): void {
  const entry: LogEntry = { ts: new Date().toISOString(), scope, message, level }
  appendLog(entry)
  if (level === 'error') notify(message, 'error')
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour12: false })
  } catch {
    return iso
  }
}

function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`
  return `${r}s`
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

function appendLog(entry: LogEntry): void {
  const key = `${entry.ts}|${entry.scope}|${entry.message}`
  if (logKeys.has(key)) return
  logKeys.add(key)
  logs.push(entry)
  if (logs.length > 400) {
    const removed = logs.shift()
    if (removed) logKeys.delete(`${removed.ts}|${removed.scope}|${removed.message}`)
  }
  if (logKeys.size > 1000) logKeys = new Set(logs.map((item) => `${item.ts}|${item.scope}|${item.message}`))

  const atBottom = els.logs.scrollTop + els.logs.clientHeight >= els.logs.scrollHeight - 24
  const line = document.createElement('div')
  line.className = entry.level
  const time = document.createElement('span')
  time.className = 'scope'
  time.textContent = `${entry.ts.slice(11, 19)} `
  const scope = document.createElement('span')
  scope.className = 'scope'
  scope.textContent = `[${entry.scope}] `
  line.append(time, scope, document.createTextNode(entry.message))
  els.logs.append(line)
  while (els.logs.childElementCount > 400) els.logs.firstElementChild?.remove()
  els.logCount.textContent = `${logs.length} eventos`
  if (atBottom) els.logs.scrollTop = els.logs.scrollHeight
}

function renderAllLogs(): void {
  els.logs.textContent = ''
  for (const entry of logs) {
    const line = document.createElement('div')
    line.className = entry.level
    const time = document.createElement('span')
    time.className = 'scope'
    time.textContent = `${entry.ts.slice(11, 19)} `
    const scope = document.createElement('span')
    scope.className = 'scope'
    scope.textContent = `[${entry.scope}] `
    line.append(time, scope, document.createTextNode(entry.message))
    els.logs.append(line)
  }
  els.logCount.textContent = `${logs.length} eventos`
  els.logs.scrollTop = els.logs.scrollHeight
}

// ---------------------------------------------------------------------------
// Chips / header
// ---------------------------------------------------------------------------

function updateChips(): void {
  const mode = appState?.mode ?? 'xbox'
  chip(els.chips.mode, mode === 'mock' ? 'modo mock' : 'modo xbox', mode === 'mock' ? 'warn' : 'ok')
  chip(els.chips.ws, socketOnline ? 'rede online' : 'rede offline', socketOnline ? 'ok' : 'err')

  const auth = appState?.auth
  if (!auth) chip(els.chips.auth, 'conta —')
  else if (auth.mock) chip(els.chips.auth, 'conta mock', 'warn')
  else if (auth.pending) chip(els.chips.auth, 'conta aguardando', 'warn')
  else if (auth.authenticated) chip(els.chips.auth, 'conta ok', 'ok')
  else chip(els.chips.auth, 'conta ausente', 'err')

  const session = appState?.session
  if (!session?.active) chip(els.chips.session, 'sessão inativa')
  else if (session.state === 'error') chip(els.chips.session, 'sessão erro', 'err')
  else if (session.state === 'Provisioned' || session.state === 'ReadyToConnect' || session.mode === 'mock')
    chip(els.chips.session, 'sessão pronta', 'ok')
  else chip(els.chips.session, `sessão ${session.state.toLowerCase()}`, 'warn')

  const status = peerStats?.status ?? 'idle'
  if (status === 'connected' && peerStats?.handshake) chip(els.chips.transport, 'transporte ok', 'ok')
  else if (status === 'connecting') chip(els.chips.transport, 'transporte…', 'warn')
  else if (status === 'failed') chip(els.chips.transport, 'transporte erro', 'err')
  else chip(els.chips.transport, 'transporte off')

  const uptime = appState ? appState.uptimeSeconds + Math.floor((Date.now() - stateReceivedAt) / 1000) : 0
  els.footerMode.textContent = `${mode === 'mock' ? 'simulador' : 'xbox one s'} · uptime ${duration(uptime)}`
  els.version.textContent = appState?.version ?? '0.1.0'
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function renderAuth(): void {
  const auth = appState?.auth
  if (!auth) {
    els.authTitle.textContent = 'Verificando conta…'
    els.authDetail.textContent = '—'
    els.btnLogin.textContent = 'Entrar com Microsoft'
    els.btnLogin.disabled = true
    els.deviceCode.classList.add('hidden')
    return
  }

  if (auth.mock) {
    els.authTitle.textContent = 'Modo simulado'
    els.authDetail.textContent = 'Sem conta Microsoft; o console simulado aceita a sessão localmente.'
    els.btnLogin.textContent = 'Simulador ativo'
    els.btnLogin.disabled = true
    els.deviceCode.classList.add('hidden')
    return
  }

  if (auth.authenticated) {
    els.authTitle.textContent = 'Conta Microsoft conectada'
    els.authDetail.textContent = `Tokens em ${auth.tokenFile}`
    els.btnLogin.textContent = 'Sair da conta'
    els.btnLogin.disabled = busy
    els.deviceCode.classList.add('hidden')
    return
  }

  if (auth.pending && auth.challenge) {
    els.authTitle.textContent = 'Aguardando login no navegador'
    els.authDetail.textContent = 'Use o código abaixo em microsoft.com/link.'
    els.btnLogin.textContent = 'Aguardando…'
    els.btnLogin.disabled = true
    els.deviceCode.classList.remove('hidden')
    els.deviceLink.href = auth.challenge.verificationUri
    els.deviceLink.textContent = auth.challenge.verificationUri.replace(/^https?:\/\//, '')
    els.deviceCodeValue.textContent = auth.challenge.userCode
    els.deviceCodeStatus.textContent = `O código expira em ${Math.round(auth.challenge.expiresInSeconds / 60)} min.`
    return
  }

  els.authTitle.textContent = 'Entre com sua conta Microsoft'
  els.authDetail.textContent = 'Necessário para listar o console e abrir a sessão Remote Play.'
  els.btnLogin.textContent = 'Entrar com Microsoft'
  els.btnLogin.disabled = busy
  els.deviceCode.classList.add('hidden')
  if (auth.error) els.deviceCodeStatus.textContent = auth.error
}

// ---------------------------------------------------------------------------
// Consoles
// ---------------------------------------------------------------------------

function renderConsoles(): void {
  els.consoleList.textContent = ''
  if (!consoleResult) {
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = 'Nenhuma busca realizada ainda.'
    els.consoleList.append(p)
    return
  }

  const scan = consoleResult.lanScan
  const pieces = [
    scan.lastScanAt ? `LAN: ${formatTime(scan.lastScanAt)}` : 'LAN: não verificada',
    scan.durationMs !== null ? `${scan.durationMs} ms` : null,
    `${consoleResult.consoles.length} console(s)`,
  ].filter(Boolean)
  els.scanMeta.textContent = pieces.join(' · ')

  for (const warning of consoleResult.warnings) {
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = warning
    els.consoleList.append(p)
  }

  for (const console of consoleResult.consoles) {
    els.consoleList.append(renderConsole(console))
  }

  if (consoleResult.consoles.length === 0 && consoleResult.warnings.length === 0) {
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = 'Nenhum console encontrado.'
    els.consoleList.append(p)
  }
}

function renderConsole(console: ConsoleEntry): HTMLElement {
  const row = document.createElement('div')
  row.className = `console ${console.connectable ? 'online' : ''}`
  const dot = document.createElement('span')
  dot.className = 'dot'
  const main = document.createElement('div')
  main.className = 'console-main'
  const name = document.createElement('strong')
  name.textContent = console.name
  const detail = document.createElement('span')
  const parts = [
    console.serverId ? `serverId ${console.serverId}` : 'sem serverId',
    console.address ? `ip ${console.address}` : null,
    console.powerState ?? null,
    console.consoleType ?? null,
  ].filter(Boolean)
  detail.textContent = parts.join(' · ')
  main.append(name, detail)
  if (console.note) {
    const note = document.createElement('span')
    note.className = 'muted'
    note.style.display = 'block'
    note.style.marginTop = '2px'
    note.textContent = console.note
    main.append(note)
  }

  const actions = document.createElement('div')
  actions.className = 'row'
  actions.style.margin = '0'
  actions.style.gap = '6px'

  const button = document.createElement('button')
  button.className = 'btn primary small'
  button.textContent = sessionStarting ? 'Conectando…' : 'Conectar'
  button.disabled = !console.connectable || busy || sessionStarting
  button.onclick = () => {
    if (!console.serverId) return
    void startSession(console.serverId, console.name)
  }
  actions.append(button)

  if (console.serverId && ['ConnectedStandby', 'Off', 'On'].includes(console.powerState ?? '')) {
    const wake = document.createElement('button')
    wake.className = 'btn ghost small'
    wake.textContent = 'Ligar'
    wake.disabled = busy
    wake.onclick = async () => {
      if (!console.serverId) return
      wake.disabled = true
      wake.textContent = 'Acordando…'
      try {
        await api('/api/consoles/power-on', {
          method: 'POST',
          body: JSON.stringify({ serverId: console.serverId }),
        })
        localLog('consoles', `WakeUp enviado para ${console.name}`)
        notify('Comando de ligar enviado. Aguarde o console acordar e tente conectar.', 'info', 8000)
        window.setTimeout(() => void refreshConsoles(true), 6000)
      } catch (error) {
        notify(`Falha ao ligar: ${String(error)}`, 'error')
        wake.disabled = false
        wake.textContent = 'Ligar'
      }
    }
    actions.append(wake)
  }

  row.append(dot, main, actions)
  return row
}

// ---------------------------------------------------------------------------
// Session / transport UI
// ---------------------------------------------------------------------------

function renderSession(): void {
  const session = appState?.session
  els.sessionState.textContent = session
    ? `${session.state}${session.active ? '' : ' (inativa)'}`
    : 'inativo'
  els.sessionId.textContent = session?.sessionId ?? '—'
  els.sessionServer.textContent = session?.serverId ?? '—'
  const details = session?.serverDetails
  els.sessionMedia.textContent = details
    ? `${details.ipV4Address ?? details.ipAddress ?? '—'}:${details.ipV4Port ?? details.port ?? '—'}`
    : '—'

  const canStop = Boolean(session?.active) && !busy
  els.btnStop.disabled = !canStop
  els.btnKeepalive.disabled = !canStop
  els.btnTransport.disabled = !session?.active || busy || session.state === 'error'
  els.btnScan.disabled = busy || !appState || (!appState.auth.authenticated && !appState.auth.mock)
  if (session?.lastError) {
    els.sessionState.textContent = `erro: ${session.lastError}`
  }
}

function authMissing(): boolean {
  return Boolean(appState && !appState.auth.authenticated && !appState.auth.mock && !appState.auth.pending)
}

function renderTransport(): void {
  const stats = peerStats
  els.peerState.textContent = stats?.peerState ?? '—'
  els.iceState.textContent = stats?.iceState ?? '—'
  els.channelState.textContent = stats
    ? `m:${stats.channels.message} c:${stats.channels.control} i:${stats.channels.input}`
    : '—'
  els.handshakeState.textContent = stats?.handshake ? 'ok' : 'pendente'

  if (!stats || stats.status === 'idle') badge(els.transportBadge, 'offline')
  else if (stats.status === 'connecting') badge(els.transportBadge, 'conectando', 'warn')
  else if (stats.status === 'connected' && !stats.handshake) badge(els.transportBadge, 'handshake', 'warn')
  else if (stats.status === 'connected') badge(els.transportBadge, 'online', 'ok')
  else if (stats.status === 'failed') badge(els.transportBadge, 'falhou', 'err')
  else badge(els.transportBadge, stats.status)

  els.btnTransport.textContent =
    stats?.status === 'connected' ? 'Reconectar transporte' : 'Conectar transporte WebRTC'
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

function buildPlayers(): void {
  els.players.textContent = ''
  for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
    const card = document.createElement('div')
    card.className = 'player unassigned'
    card.dataset.slot = String(slot)

    const head = document.createElement('div')
    head.className = 'p-head'
    const badgeEl = document.createElement('span')
    badgeEl.className = 'p-badge'
    badgeEl.textContent = `P${slot + 1}`
    const source = document.createElement('span')
    source.className = 'p-source'
    source.textContent = 'livre'
    head.append(badgeEl, source)

    const select = document.createElement('select')
    select.className = 'p-select'
    select.onchange = () => onSelectGamepad(slot, select.value)

    const status = document.createElement('div')
    status.className = 'muted'
    status.textContent = 'sem controle'

    const buttonRow = document.createElement('div')
    buttonRow.className = 'p-buttons'
    const buttons = new Map<string, HTMLElement>()
    for (const [name] of BUTTON_NAMES) {
      const chipEl = document.createElement('span')
      chipEl.className = 'p-btn'
      chipEl.textContent = shortName(name)
      buttonRow.append(chipEl)
      buttons.set(name, chipEl)
    }

    const axisWrap = document.createElement('div')
    axisWrap.style.display = 'grid'
    axisWrap.style.gap = '4px'
    const axes = {} as PlayerCardRefs['axes']
    for (const axis of ['LX', 'LY', 'RX', 'RY', 'LT', 'RT'] as const) {
      const row = document.createElement('div')
      row.className = 'axis'
      const label = document.createElement('span')
      label.textContent = axis
      const bar = document.createElement('div')
      bar.className = 'bar'
      const fill = document.createElement('i')
      bar.append(fill)
      row.append(label, bar)
      axisWrap.append(row)
      axes[axis] = fill
    }

    const meta = document.createElement('div')
    meta.className = 'p-meta'
    const sent = document.createElement('span')
    sent.textContent = '0 pacotes'
    const last = document.createElement('span')
    last.textContent = '—'
    meta.append(sent, last)

    const actions = document.createElement('div')
    actions.className = 'p-actions'
    const test = document.createElement('button')
    test.className = 'btn ghost'
    test.textContent = 'Pulso A'
    test.onclick = () => pulseSlot(slot)
    const clear = document.createElement('button')
    clear.className = 'btn ghost'
    clear.textContent = 'Liberar'
    clear.onclick = () => {
      onSelectGamepad(slot, '')
      peer?.releaseSlots()
    }
    actions.append(test, clear)

    card.append(head, select, status, buttonRow, axisWrap, meta, actions)
    els.players.append(card)
    playerCards.push({ root: card, select, source, status, buttons, axes, meta, test })
  }
}

function shortName(name: string): string {
  const map: Record<string, string> = {
    Nexus: 'NX',
    Menu: 'MN',
    View: 'VW',
    LeftShoulder: 'LB',
    RightShoulder: 'RB',
    LeftThumb: 'L3',
    RightThumb: 'R3',
    DPadUp: '↑',
    DPadDown: '↓',
    DPadLeft: '←',
    DPadRight: '→',
  }
  return map[name] ?? name
}

function connectedGamepads(): Gamepad[] {
  if (!navigator.getGamepads) return []
  return Array.from(navigator.getGamepads()).filter((gamepad): gamepad is Gamepad => Boolean(gamepad?.connected))
}

let gamepadOptionsSignature = ''

function updateGamepadOptions(force = false): void {
  const gamepads = connectedGamepads()
  const nativeSignature = [...nativeStates.keys()].sort().join(',')
  const signature = `${gamepads.map((gamepad) => `${gamepad.index}:${gamepad.id}`).join('|')}#${nativeSignature}`
  if (!force && signature === gamepadOptionsSignature) return
  gamepadOptionsSignature = signature
  for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
    const card = playerCards[slot]
    if (!card) continue
    const previous = String(slotGamepads[slot] ?? '')
    const options: HTMLOptionElement[] = []
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = '— sem controle —'
    options.push(empty)

    for (const gamepad of gamepads) {
      const option = document.createElement('option')
      option.value = String(gamepad.index)
      option.textContent = `#${gamepad.index} ${shortId(gamepad.id)}`
      options.push(option)
    }

    if (nativeStates.has(slot)) {
      const native = document.createElement('option')
      native.value = 'native'
      native.textContent = `Android nativo · ${nativeNames.get(slot) ?? `P${slot + 1}`}`
      options.push(native)
    }

    card.select.replaceChildren(...options)
    if (slotGamepads[slot] !== null && gamepads.some((gamepad) => gamepad.index === slotGamepads[slot])) {
      card.select.value = String(slotGamepads[slot])
    } else if (nativeStates.has(slot)) {
      card.select.value = 'native'
    } else {
      card.select.value = ''
      if (previous !== '') slotGamepads[slot] = null
    }
  }
  els.playersNote.textContent = `${gamepads.length} controle(s) visível(is) via Gamepad API`
}

function shortId(id: string): string {
  return id
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/vendor:\s*[0-9a-f]+/gi, '')
    .trim()
    .slice(0, 34)
}

function onSelectGamepad(slot: number, value: string): void {
  if (value === 'native') return
  const index = value === '' ? null : Number(value)
  if (index !== null) {
    for (let other = 0; other < PLAYER_SLOTS; other++) {
      if (other !== slot && slotGamepads[other] === index) {
        slotGamepads[other] = null
        ignoredGamepads.add(index)
      }
    }
    slotGamepads[slot] = index
    ignoredGamepads.delete(index)
    nativeStates.delete(slot)
    nativeNames.delete(slot)
    void persistPlayer(slot, `web:${index}`, connectedGamepads().find((g) => g.index === index)?.id ?? `Gamepad ${index}`)
  } else {
    const previous = slotGamepads[slot]
    if (previous !== null && previous !== undefined) ignoredGamepads.add(previous)
    slotGamepads[slot] = null
    void api('/api/players/unassign', {
      method: 'POST',
      body: JSON.stringify({ slot }),
    }).catch(() => undefined)
  }
  saveSlotMap()
  updateGamepadOptions(true)
  syncPeerSlots()
}

function saveSlotMap(): void {
  try {
    localStorage.setItem('xlh.slotGamepads', JSON.stringify(slotGamepads))
  } catch {
    // ignore
  }
}

function loadSlotMap(): void {
  try {
    const raw = localStorage.getItem('xlh.slotGamepads')
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return
    for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
      const value = parsed[slot]
      if (typeof value === 'number' && Number.isInteger(value)) slotGamepads[slot] = value
    }
  } catch {
    // ignore
  }
}

async function persistPlayer(slot: number, controllerId: string, controllerName: string): Promise<void> {
  try {
    await api('/api/players/assign', {
      method: 'POST',
      body: JSON.stringify({
        slot,
        controllerId,
        controllerName,
        source: embed ? 'native' : 'web',
      }),
    })
  } catch {
    // Player persistence is advisory; never block input on it.
  }
}

function autoAssignGamepads(): void {
  const gamepads = connectedGamepads()
  let changed = false
  for (const gamepad of gamepads) {
    const isNew = !knownGamepads.has(gamepad.index)
    knownGamepads.add(gamepad.index)
    if (!isNew) continue
    if (ignoredGamepads.has(gamepad.index)) continue
    if (slotGamepads.includes(gamepad.index)) continue
    const free = slotGamepads.findIndex((value, slot) => value === null && !nativeStates.has(slot))
    if (free >= 0) {
      slotGamepads[free] = gamepad.index
      changed = true
      void persistPlayer(free, `web:${gamepad.index}`, gamepad.id)
      localLog('players', `Gamepad #${gamepad.index} associado automaticamente ao P${free + 1}`)
    }
  }
  for (const index of [...knownGamepads]) {
    if (!gamepads.some((gamepad) => gamepad.index === index)) {
      knownGamepads.delete(index)
      ignoredGamepads.delete(index)
      changed = true
    }
  }
  if (changed) saveSlotMap()
}

function pulseSlot(slot: number): void {
  testPulses.set(slot, performance.now() + 350)
  localLog('players', `Pulso sintético no P${slot + 1} (teste de protocolo)`)
  syncPeerSlots()
  peer?.claimActiveSlots()
}

function currentState(slot: number): { state: GamepadState; source: 'native' | 'web' | 'test' } | null {
  if (nativeStates.has(slot)) return { state: nativeStates.get(slot) ?? emptyGamepadState(), source: 'native' }
  const pulseUntil = testPulses.get(slot) ?? 0
  const index = slotGamepads[slot]
  let base: GamepadState | null = null
  let source: 'web' | 'test' = 'web'
  if (index !== null) {
    const gamepad = connectedGamepads().find((entry) => entry.index === index)
    if (gamepad) base = stateFromWebGamepad(gamepad)
  }
  if (pulseUntil > performance.now()) {
    source = 'test'
    base = base ?? emptyGamepadState()
    base = { ...base, buttons: base.buttons | BUTTON.A }
  }
  return base ? { state: base, source } : null
}

function syncPeerSlots(): void {
  if (!peer) return
  for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
    const current = currentState(slot)
    peer.setSlotState(slot, current?.state ?? null)
  }
}

function renderPlayers(): void {
  for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
    const card = playerCards[slot]
    if (!card) continue
    const current = currentState(slot)
    const native = nativeStates.has(slot)
    const assigned = current !== null
    card.root.classList.toggle('unassigned', !assigned)
    card.root.classList.toggle('active', assigned && Boolean(appState?.session.active))
    card.source.textContent = native
      ? 'android'
      : current?.source === 'test'
        ? 'teste'
        : assigned
          ? 'web'
          : 'livre'
    card.status.textContent = native
      ? nativeNames.get(slot) ?? 'entrada nativa'
      : assigned
        ? `controle #${slotGamepads[slot]}`
        : 'sem controle'

    const state = current?.state ?? emptyGamepadState()
    for (const [name, bit] of BUTTON_NAMES) {
      const element = card.buttons.get(name)
      if (element) element.classList.toggle('on', (state.buttons & bit) !== 0)
    }
    setAxis(card.axes.LX, state.leftStickX)
    setAxis(card.axes.LY, state.leftStickY)
    setAxis(card.axes.RX, state.rightStickX)
    setAxis(card.axes.RY, state.rightStickY)
    setAxis(card.axes.LT, state.leftTrigger, false)
    setAxis(card.axes.RT, state.rightTrigger, false)

    const stats = peerStats?.slots[slot]
    const sent = card.meta.firstElementChild
    const last = card.meta.lastElementChild
    if (sent) sent.textContent = `${stats?.sent ?? 0} pacotes`
    if (last) last.textContent = stats?.lastAt ? formatTime(new Date(stats.lastAt).toISOString()) : '—'
  }
}

function setAxis(element: HTMLElement, value: number, bipolar = true): void {
  const normalized = Math.max(-1, Math.min(1, value))
  if (bipolar) {
    element.style.width = `${Math.abs(normalized) * 50}%`
    element.style.marginLeft = normalized < 0 ? `${(1 + normalized) * 50}%` : '50%'
    element.style.opacity = normalized < -0.02 ? '0.55' : '1'
  } else {
    element.style.width = `${Math.abs(normalized) * 100}%`
    element.style.marginLeft = '0'
    element.style.opacity = '1'
  }
  if (Math.abs(normalized) < 0.02) element.style.width = '0%'
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const statRefs = new Map<string, HTMLElement>()
function buildStats(): void {
  const definitions: Array<[string, string]> = [
    ['rtt', 'RTT relay'],
    ['packets', 'Pacotes enviados'],
    ['rate', 'Taxa atual'],
    ['slots', 'Slots registrados'],
    ['mock', 'Mock recebido'],
    ['session', 'Sessão'],
    ['uptime', 'Uptime'],
    ['clients', 'Clientes WS'],
  ]
  for (const [key, label] of definitions) {
    const box = document.createElement('div')
    box.className = 'stat'
    const name = document.createElement('span')
    name.textContent = label
    const value = document.createElement('strong')
    value.textContent = '—'
    box.append(name, value)
    els.stats.append(box)
    statRefs.set(key, value)
  }
}

let lastRateSample = { at: Date.now(), packets: 0 }
let lastRate = 0

function renderStats(): void {
  const stats = peerStats
  const session = appState?.session
  const now = Date.now()
  if (stats) {
    if (now - lastRateSample.at >= 1_000) {
      lastRate = ((stats.packets - lastRateSample.packets) * 1000) / (now - lastRateSample.at)
      lastRateSample = { at: now, packets: stats.packets }
    }
  }
  statRefs.get('rtt')!.textContent =
    appState?.diagnostics.rttMs !== null && appState?.diagnostics.rttMs !== undefined
      ? `${appState.diagnostics.rttMs} ms`
      : '—'
  statRefs.get('packets')!.textContent = String(stats?.packets ?? 0)
  statRefs.get('rate')!.textContent = `${lastRate.toFixed(1)}/s`
  statRefs.get('slots')!.textContent = peer?.getRegisteredSlots().map((slot) => `P${slot + 1}`).join(' ') || '—'
  statRefs.get('mock')!.textContent = session?.mock
    ? `${session.mock.packets} pacotes / ${session.mock.slots ? Object.keys(session.mock.slots).length : 0} slots`
    : '—'
  statRefs.get('session')!.textContent = session?.active ? session.state : 'inativa'
  statRefs.get('uptime')!.textContent = appState ? duration(appState.uptimeSeconds) : '—'
  statRefs.get('clients')!.textContent = String(appState?.diagnostics.wsClients ?? 0)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function refreshState(): Promise<void> {
  try {
    appState = await api<AppState>('/api/state')
    stateReceivedAt = Date.now()
    renderAll()
  } catch (error) {
    localLog('api', `Falha ao ler estado: ${String(error)}`, 'error')
  }
}

async function refreshConsoles(scan = false): Promise<void> {
  if (!appState) return
  if (!appState.auth.authenticated && !appState.auth.mock) {
    localLog('consoles', 'Entre com a conta Microsoft antes de listar consoles.', 'warn')
    return
  }
  els.btnScan.disabled = true
  const previous = els.btnScan.textContent
  els.btnScan.textContent = scan ? 'Varrendo…' : 'Atualizando…'
  try {
    consoleResult = await api<ConsoleListResult>(`/api/consoles${scan ? '?scan=1&timeout=3000' : ''}`)
    renderConsoles()
    if (scan) localLog('consoles', `Varredura concluída: ${consoleResult.consoles.length} console(s)`)
  } catch (error) {
    localLog('consoles', `Falha ao listar consoles: ${String(error)}`, 'error')
  } finally {
    els.btnScan.textContent = previous
    els.btnScan.disabled = false
  }
}

async function login(): Promise<void> {
  if (appState?.auth.authenticated) {
    busy = true
    renderAuth()
    try {
      await api('/api/auth/logout', { method: 'POST' })
      consoleResult = null
      renderConsoles()
      await refreshState()
    } catch (error) {
      notify(String(error), 'error')
    } finally {
      busy = false
      renderAuth()
    }
    return
  }
  busy = true
  renderAuth()
  try {
    const status = await api<AuthStatus>('/api/auth/device-code', { method: 'POST' })
    localLog('auth', 'Device code solicitado; aguardando confirmação no navegador.')
    if (status.error) notify(status.error, 'error')
    await refreshState()
  } catch (error) {
    notify(String(error), 'error')
  } finally {
    busy = false
    renderAll()
  }
}

async function startSession(serverId: string, name: string): Promise<void> {
  if (sessionStarting) return
  sessionStarting = true
  busy = true
  renderAll()
  let started = false
  try {
    await api('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({ serverId }),
    })
    localLog('session', `Sessão iniciada com ${name} (${serverId})`)
    await refreshState()
    started = true
  } catch (error) {
    notify(`Falha ao iniciar sessão: ${String(error)}`, 'error')
    await refreshState()
  } finally {
    sessionStarting = false
    busy = false
    renderAll()
  }
  if (started) void startTransport()
}

async function stopSession(): Promise<void> {
  busy = true
  renderAll()
  peer?.close()
  peer = null
  peerStats = null
  try {
    await api('/api/session/stop', { method: 'POST' })
    localLog('session', 'Sessão encerrada')
    await refreshState()
  } catch (error) {
    notify(String(error), 'error')
  } finally {
    busy = false
    renderAll()
  }
}

async function startTransport(): Promise<void> {
  if (!appState?.session.active) {
    notify('Inicie uma sessão antes de conectar o transporte.', 'warn')
    return
  }
  if (peer) peer.close()
  const mockMode = appState?.mode === 'mock'
  if (mockMode && els.optMedia.checked) {
    localLog(
      'peer',
      'Modo mock: mídia desativada automaticamente (o simulador usa apenas data channels).',
      'warn',
    )
  }
  peer = new XboxPeer({
    media: mockMode ? false : els.optMedia.checked,
    coopMode: els.optCoop.checked,
    maxSlots: Number(els.optSlots.value) || 4,
    onLog: (message, level = 'info') => localLog('peer', message, level),
    onStats: (stats) => {
      peerStats = stats
      renderTransport()
      renderPlayers()
      renderStats()
      updateChips()
    },
    onVideoStream: (stream) => {
      if (els.optPreview.checked) {
        els.preview.srcObject = stream
        els.preview.classList.remove('hidden')
      } else {
        els.preview.srcObject = null
        els.preview.classList.add('hidden')
      }
    },
    onVibration: handleVibration,
  })

  try {
    localLog('peer', `Conectando transporte WebRTC (mídia=${mockMode ? 'não (mock)' : els.optMedia.checked ? 'sim' : 'não'})`)
    await peer.connect()
  } catch (error) {
    notify(`Transporte não conectou: ${String(error)}`, 'error')
  } finally {
    syncPeerSlots()
    renderAll()
  }
}

function handleVibration(slot: number, rumble: VibrationReport): void {
  const index = slotGamepads[slot]
  if (index === null) return
  const gamepad = connectedGamepads().find((entry) => entry.index === index)
  const actuator = gamepad?.vibrationActuator as
    | (GamepadHapticActuator & { playEffect?: (type: string, params: object) => Promise<unknown> })
    | undefined
  if (!actuator?.playEffect) return
  void actuator
    .playEffect('dual-rumble', {
      startDelay: rumble.delayMs,
      duration: rumble.durationMs,
      weakMagnitude: rumble.rightMotor,
      strongMagnitude: rumble.leftMotor,
    })
    .catch(() => undefined)
}

async function claimSlots(): Promise<void> {
  if (!peer) {
    notify('Conecte o transporte antes de reivindicar slots.', 'warn')
    return
  }
  syncPeerSlots()
  peer.claimActiveSlots()
  localLog('players', `Solicitado registro de ${peer.getRegisteredSlots().length} slot(s)`)
}

async function copyDiagnostics(): Promise<void> {
  const payload = {
    generatedAt: new Date().toISOString(),
    state: appState,
    transport: peerStats,
    consoles: consoleResult,
    players: appState?.players,
    mock: appState?.session.mock,
    userAgent: navigator.userAgent,
    screen: { width: window.innerWidth, height: window.innerHeight },
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    notify('Diagnóstico copiado para a área de transferência.', 'info', 3000)
  } catch {
    notify('Não foi possível copiar; baixe o log JSONL.', 'warn')
  }
}

function downloadLogs(): void {
  const text = logs.map((entry) => JSON.stringify(entry)).join('\n')
  const blob = new Blob([text], { type: 'application/x-ndjson' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `xlh-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
  link.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Native bridge (Android WebView)
// ---------------------------------------------------------------------------

function normalizeNativeState(raw: unknown): GamepadState | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const num = (key: string, fallback = 0): number => {
    const value = input[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }
  let buttons = num('buttons')
  if (typeof input.buttons === 'string') {
    const names = input.buttons.split(/[,\s|]+/).filter(Boolean)
    buttons = 0
    for (const name of names) {
      const bit = (BUTTON as Record<string, number>)[name]
      if (typeof bit === 'number') buttons |= bit
    }
  }
  return {
    buttons: buttons & 0xffff,
    leftTrigger: clamp(num('leftTrigger'), 0, 1),
    rightTrigger: clamp(num('rightTrigger'), 0, 1),
    leftStickX: clamp(num('leftStickX'), -1, 1),
    leftStickY: clamp(num('leftStickY'), -1, 1),
    rightStickX: clamp(num('rightStickX'), -1, 1),
    rightStickY: clamp(num('rightStickY'), -1, 1),
  }
}

function setNativeGamepad(slot: number, state: unknown, name?: string): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PLAYER_SLOTS) return
  const normalized = normalizeNativeState(state)
  if (!normalized) return
  const isNewNative = !nativeStates.has(slot)
  nativeStates.set(slot, normalized)
  nativeLastSeen.set(slot, performance.now())
  if (name) nativeNames.set(slot, name)
  if (slotGamepads[slot] !== null) {
    slotGamepads[slot] = null
    saveSlotMap()
  }
  updateGamepadOptions(true)
  syncPeerSlots()
  if (isNewNative) peer?.claimActiveSlots()
}

function installNativeBridge(): void {
  window.XLH = {
    version: '0.1.0',
    setNativeGamepad,
    setNativeFrame(frame: unknown) {
      if (!frame || typeof frame !== 'object') return
      const raw = frame as Record<string, unknown>
      const slots = Array.isArray(raw.slots) ? raw.slots : raw.slots && typeof raw.slots === 'object' ? Object.values(raw.slots) : []
      slots.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return
        const slotValue = (entry as Record<string, unknown>).slot
        const slot = typeof slotValue === 'number' ? slotValue : index
        const name = typeof (entry as Record<string, unknown>).name === 'string' ? String((entry as Record<string, unknown>).name) : undefined
        setNativeGamepad(slot, entry, name)
      })
    },
    clearNativeGamepad(slot: number) {
      nativeStates.delete(slot)
      nativeNames.delete(slot)
      nativeLastSeen.delete(slot)
      syncPeerSlots()
      updateGamepadOptions()
    },
    clearAllNative() {
      nativeStates.clear()
      nativeNames.clear()
      nativeLastSeen.clear()
      syncPeerSlots()
      updateGamepadOptions()
    },
    claim: () => void claimSlots(),
    release: () => peer?.releaseSlots(),
    getStatus: () => ({ state: appState, transport: peerStats, nativeSlots: [...nativeStates.keys()] }),
  }

  if (isTestMode()) {
    window.__XLH_TEST__ = {
      getStatus: () => window.XLH?.getStatus(),
      getPeerStats: () => peerStats,
      pulse: (slot: number) => pulseSlot(slot),
      native: window.XLH,
    }
  }
}

// ---------------------------------------------------------------------------
// Main render loop
// ---------------------------------------------------------------------------

function renderAll(): void {
  renderAuth()
  renderSession()
  renderTransport()
  renderConsoles()
  renderPlayers()
  renderStats()
  updateChips()
}

function tick(): void {
  const now = performance.now()
  for (const [slot, until] of [...testPulses]) {
    if (until <= now) testPulses.delete(slot)
  }
  for (const [slot, seen] of [...nativeLastSeen]) {
    if (now - seen > 1_500) {
      nativeStates.delete(slot)
      nativeNames.delete(slot)
      nativeLastSeen.delete(slot)
      localLog('native', `Entrada nativa do P${slot + 1} expirou (sem heartbeat)`, 'warn')
    }
  }
  autoAssignGamepads()
  syncPeerSlots()
  updateGamepadOptions()
  renderPlayers()
  renderStats()
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  buildPlayers()
  buildStats()
  loadSlotMap()

  els.optMedia.checked = localStorage.getItem('xlh.media') !== '0'
  els.optPreview.checked = localStorage.getItem('xlh.preview') === '1'
  els.optCoop.checked = localStorage.getItem('xlh.coop') === '1'
  els.optSlots.value = localStorage.getItem('xlh.slots') ?? '4'

  const socket = new RelaySocket(
    (event) => {
      if (event.type === 'state') {
        appState = event.data as AppState
        stateReceivedAt = Date.now()
        renderAll()
      } else if (event.type === 'logs' && Array.isArray(event.data)) {
        logs = (event.data as LogEntry[]).slice(-400)
        logKeys = new Set(logs.map((entry) => `${entry.ts}|${entry.scope}|${entry.message}`))
        renderAllLogs()
      } else if (event.type === 'log') {
        appendLog(event.data as LogEntry)
      }
    },
    (status) => {
      socketOnline = status === 'online'
      updateChips()
      if (status === 'online') {
        void refreshState()
        if (!consoleResult && !authMissing()) void refreshConsoles(false)
      } else if (status === 'offline') {
        localLog('ws', 'Conexão WebSocket com o relay perdida; reconectando…', 'warn')
      }
    },
  )
  socket.connect()

  installNativeBridge()

  els.btnLogin.onclick = () => void login()
  els.btnScan.onclick = () => void refreshConsoles(true)
  els.btnStop.onclick = () => void stopSession()
  els.btnKeepalive.onclick = async () => {
    try {
      await api('/api/session/keepalive', { method: 'POST' })
      localLog('session', 'Keepalive enviado manualmente')
    } catch (error) {
      notify(String(error), 'error')
    }
  }
  els.btnTransport.onclick = () => void startTransport()
  els.btnCopyDiag.onclick = () => void copyDiagnostics()
  els.btnClaim.onclick = () => void claimSlots()
  els.btnRelease.onclick = () => {
    peer?.releaseSlots()
    localLog('players', 'Slots liberados manualmente')
  }
  els.btnTestAll.onclick = () => {
    for (let slot = 0; slot < PLAYER_SLOTS; slot++) testPulses.set(slot, performance.now() + 400)
    localLog('players', 'Pulso sintético nos 4 slots (não é um controle físico)')
    syncPeerSlots()
    peer?.claimActiveSlots()
  }
  els.btnCopyCode.onclick = async () => {
    try {
      await navigator.clipboard.writeText(els.deviceCodeValue.textContent ?? '')
      notify('Código copiado.', 'info', 2500)
    } catch {
      notify('Não foi possível copiar.', 'warn')
    }
  }
  els.btnClearLogs.onclick = () => {
    logs = []
    logKeys.clear()
    els.logs.textContent = ''
    els.logCount.textContent = '0 eventos'
  }
  els.btnDownloadLogs.onclick = downloadLogs

  els.optMedia.onchange = () => localStorage.setItem('xlh.media', els.optMedia.checked ? '1' : '0')
  els.optPreview.onchange = () => {
    localStorage.setItem('xlh.preview', els.optPreview.checked ? '1' : '0')
    els.preview.classList.toggle('hidden', !els.optPreview.checked)
    if (!els.optPreview.checked) els.preview.srcObject = null
  }
  els.optCoop.onchange = () => {
    localStorage.setItem('xlh.coop', els.optCoop.checked ? '1' : '0')
    peer?.setCoopMode(els.optCoop.checked)
  }
  els.optSlots.onchange = () => {
    const value = Math.max(1, Math.min(4, Number(els.optSlots.value) || 4))
    els.optSlots.value = String(value)
    localStorage.setItem('xlh.slots', String(value))
    localLog('players', `Limite de slots: ${value}`, 'info')
  }

  window.setInterval(tick, 100)
  window.addEventListener('beforeunload', () => {
    peer?.close()
    socket.close()
  })

  await refreshState()
  if (!authMissing()) await refreshConsoles(false)
  renderAll()

  const autoServer = params.get('serverId')
  if (embed && autoServer) {
    localLog('session', `Auto-start solicitado para ${autoServer}`)
    await startSession(autoServer, autoServer)
  }
}

void main().catch((error) => {
  notify(`Falha ao inicializar o dashboard: ${String(error)}`, 'error')
})
