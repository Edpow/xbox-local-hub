import { existsSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, type RelayApp } from '../../src/relay/server.js'

const chromeCandidates = [
  process.env.CHROME_PATH,
  join(homedir(), '.local/bin/google-chrome'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((value): value is string => Boolean(value))

const chromePath = chromeCandidates.find((candidate) => existsSync(candidate))

let app: RelayApp
let url: string
let browser: Browser | null = null
let context: BrowserContext | null = null

async function waitFor<T>(
  read: () => Promise<T | null | undefined>,
  predicate: (value: T) => boolean,
  timeoutMs = 20_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | null = null
  while (Date.now() < deadline) {
    const value = await read()
    if (value) {
      last = value
      if (predicate(value)) return value
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timeout waiting for condition (last: ${JSON.stringify(last)?.slice(0, 800)})`)
}

beforeAll(async () => {
  if (!chromePath) return
  app = await createApp({
    mock: true,
    host: '127.0.0.1',
    port: 0,
    dataDir: join(tmpdir(), `xlh-e2e-${Date.now()}`),
  })
  const listen = await app.listen()
  url = `http://127.0.0.1:${listen.port}`
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  context = await browser.newContext({ viewport: { width: 1440, height: 1800 } })
})

afterAll(async () => {
  await context?.close()
  await browser?.close()
  await app?.close()
})

describe.skipIf(!chromePath)('browser dashboard end-to-end against the mock console', () => {
  it('connects WebRTC, registers four slots and delivers independent frames', async () => {
    const page = await context!.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })

    await page.goto(`${url}/?test=1`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#console-list button')
    await page.locator('#console-list button', { hasText: 'Conectar' }).first().click()

    await page.waitForFunction(
      () => window.__XLH_TEST__?.getPeerStats()?.handshake === true,
      undefined,
      { timeout: 30_000 },
    )

    await page.evaluate(() => {
      const target = window as unknown as { __hb?: number }
      target.__hb = window.setInterval(() => {
        window.XLH?.setNativeGamepad(0, { buttons: 16, leftStickX: 0.5, leftTrigger: 1 }, 'P1-A')
        window.XLH?.setNativeGamepad(1, { buttons: 32, rightStickY: -0.75, rightTrigger: 0.5 }, 'P2-B')
        window.XLH?.setNativeGamepad(2, { buttons: 64 | 256, leftStickY: 0.25 }, 'P3-X')
        window.XLH?.setNativeGamepad(3, { buttons: 128 | 512, rightStickX: -0.25 }, 'P4-Y')
      }, 50)
    })

    const snapshot = await waitFor(
      async () => {
        const response = await fetch(`${url}/api/state`)
        const state = (await response.json()) as Record<string, any>
        return state.session.mock as Record<string, any> | undefined
      },
      (mock) =>
        Array.isArray(mock.registeredSlots) &&
        mock.registeredSlots.length === 4 &&
        Boolean(mock.slots?.['0']) &&
        Boolean(mock.slots?.['1']) &&
        Boolean(mock.slots?.['2']) &&
        Boolean(mock.slots?.['3']) &&
        Object.values(mock.slots as Record<string, { frames: number }>).every((slot) => slot.frames >= 5),
      20_000,
      300,
    )

    expect(snapshot.connectionState).toBe('connected')
    expect(snapshot.registeredSlots).toEqual([0, 1, 2, 3])
    expect(snapshot.packets).toBeGreaterThan(4)
    expect(snapshot.slots['0'].buttons).toBe(16)
    expect(snapshot.slots['0'].leftStickX).toBe(16384)
    expect(snapshot.slots['0'].leftTrigger).toBe(65535)
    expect(snapshot.slots['1'].buttons).toBe(32)
    expect(snapshot.slots['1'].rightStickY).toBe(24575)
    expect(snapshot.slots['2'].buttons).toBe(320)
    expect(snapshot.slots['3'].buttons).toBe(640)

    const added = snapshot.controlMessages
      .filter((entry: any) => entry.message?.message === 'gamepadChanged' && entry.message?.wasAdded)
      .map((entry: any) => entry.message.gamepadIndex)
    expect(added).toEqual(expect.arrayContaining([0, 1, 2, 3]))

    const peerStats = await page.evaluate(() => window.__XLH_TEST__?.getPeerStats())
    expect(peerStats).toMatchObject({ status: 'connected', handshake: true })
    expect(peerStats?.packets).toBeGreaterThan(0)
    expect(Object.keys(peerStats?.slots ?? {})).toEqual(expect.arrayContaining(['0', '1', '2', '3']))

    expect(pageErrors).toEqual([])

    const evidenceDir = join(process.cwd(), 'docs', 'evidence')
    mkdirSync(evidenceDir, { recursive: true })
    await page.screenshot({ path: join(evidenceDir, 'dashboard-mock-4-slots.png'), fullPage: true })

    await page.evaluate(() => {
      const target = window as unknown as { __hb?: number }
      if (target.__hb) clearInterval(target.__hb)
    })
    await page.close()
  })
})
