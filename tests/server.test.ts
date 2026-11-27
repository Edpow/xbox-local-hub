import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, type RelayApp } from '../src/relay/server.js'

const dirs: string[] = []
const apps: RelayApp[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xlh-server-'))
  dirs.push(dir)
  return dir
}

async function startApp(options: Parameters<typeof createApp>[0] = {}): Promise<{
  app: RelayApp
  url: string
}> {
  const dir = tempDir()
  const app = await createApp({
    mock: true,
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    ...options,
  })
  apps.push(app)
  const { port } = await app.listen()
  return { app, url: `http://127.0.0.1:${port}` }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('relay HTTP API', () => {
  it('exposes health, state, mock consoles and a mock session', async () => {
    const { url } = await startApp()
    const health = await (await fetch(`${url}/api/health`)).json()
    expect(health).toMatchObject({ ok: true, mode: 'mock' })

    const state = (await (await fetch(`${url}/api/state`)).json()) as Record<string, any>
    expect(state.mode).toBe('mock')
    expect(state.auth.mock).toBe(true)
    expect(state.session.active).toBe(false)

    const consoles = (await (await fetch(`${url}/api/consoles`)).json()) as Record<string, any>
    expect(consoles.consoles[0]).toMatchObject({
      serverId: 'MOCK-CONSOLE',
      connectable: true,
    })
    expect(consoles.warnings[0]).toMatch(/MOCK/)

    const start = await fetch(`${url}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId: 'MOCK-CONSOLE' }),
    })
    expect(start.status).toBe(200)
    const session = (await start.json()) as Record<string, any>
    expect(session.active).toBe(true)
    expect(session.state).toBe('Provisioned')

    const after = (await (await fetch(`${url}/api/state`)).json()) as Record<string, any>
    expect(after.session.sessionId).toBeTruthy()

    const stop = await fetch(`${url}/api/session/stop`, { method: 'POST' })
    expect(stop.status).toBe(200)
    expect(((await stop.json()) as Record<string, any>).active).toBe(false)
  })

  it('persists player assignments and rejects duplicates', async () => {
    const { url } = await startApp()
    const assign = async (slot: number, controllerId: string) =>
      fetch(`${url}/api/players/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, controllerId, controllerName: controllerId }),
      })
    expect((await assign(0, 'web:0')).status).toBe(200)
    expect((await assign(1, 'web:1')).status).toBe(200)
    const duplicate = await assign(2, 'web:0')
    expect(duplicate.status).toBe(500)
    expect(await duplicate.text()).toContain('já associado')

    const players = (await (await fetch(`${url}/api/players`)).json()) as Record<string, any>
    expect(players.slots[0].controllerId).toBe('web:0')
    expect(players.slots[2]).toBeNull()

    await fetch(`${url}/api/players/unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: 0 }),
    })
    const after = (await (await fetch(`${url}/api/players`)).json()) as Record<string, any>
    expect(after.slots[0]).toBeNull()
  })

  it('requires the access token on the API but not on health/static assets', async () => {
    const { url } = await startApp({ mock: false, accessToken: 'secret-token' })
    expect((await fetch(`${url}/api/health`)).status).toBe(200)
    expect((await fetch(`${url}/api/state`)).status).toBe(401)
    expect(
      (
        await fetch(`${url}/api/state`, {
          headers: { Authorization: 'Bearer secret-token' },
        })
      ).status,
    ).toBe(200)
    expect((await fetch(`${url}/api/state?token=secret-token`)).status).toBe(200)
    expect((await fetch(`${url}/`)).status).toBe(200)
  })

  it('rejects malformed session and player payloads', async () => {
    const { url } = await startApp()
    const noServer = await fetch(`${url}/api/session/sdp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: '' }),
    })
    expect(noServer.status).toBe(400)
    const badPlayer = await fetch(`${url}/api/players/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: 'x' }),
    })
    expect(badPlayer.status).toBe(400)
  })

  it('serves the dashboard bundle when built', async () => {
    const { url } = await startApp()
    const index = await fetch(`${url}/`)
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('Xbox Local Hub')
    const bundle = await fetch(`${url}/app.js`)
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('content-type')).toContain('javascript')
  })
})
