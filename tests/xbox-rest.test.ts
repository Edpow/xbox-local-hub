import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GssvClient,
  GssvError,
  normalizeBaseUri,
  normalizeIceCandidate,
  parseExchangeResponse,
} from '../src/core/xbox/gssv.js'
import { extractConsoleList, fetchConsoleList, sendXccsCommand } from '../src/core/xbox/console-list.js'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function stubFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const call = { url, init: init ?? {} }
    calls.push(call)
    return handler(url, call.init)
  })
  return { impl, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status = 200): Response {
  return new Response(null, { status })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('xHome session REST client', () => {
  it('normalizes hosts', () => {
    expect(normalizeBaseUri('weu.core.gssv-play-prod.xboxlive.com/')).toBe(
      'https://weu.core.gssv-play-prod.xboxlive.com',
    )
    expect(normalizeBaseUri('http://localhost:9000')).toBe('http://localhost:9000')
  })

  it('starts a session, waits for provisioning and reads configuration', async () => {
    let stateCalls = 0
    const { impl, calls } = stubFetch((url) => {
      if (url.endsWith('/v5/sessions/home/play')) {
        return jsonResponse({
          sessionId: 'ABC-123',
          sessionPath: 'v5/sessions/home/ABC-123',
          state: 'Provisioning',
        })
      }
      if (url.endsWith('/state')) {
        stateCalls++
        return jsonResponse({ state: stateCalls < 3 ? 'Provisioning' : 'Provisioned' })
      }
      if (url.endsWith('/configuration')) {
        return jsonResponse({
          keepAlivePulseInSeconds: 300,
          serverDetails: { ipAddress: '192.168.1.20', port: 9002 },
        })
      }
      return emptyResponse(404)
    })

    const client = new GssvClient({
      baseUri: 'https://uks.core.gssv-play-prodxhome.xboxlive.com/',
      gsToken: 'stream-token',
      fetchImpl: impl,
    })
    const started = await client.startSession('F4001DF950A8A')
    expect(started.sessionId).toBe('ABC-123')
    expect(started.sessionPath).toBe('v5/sessions/home/ABC-123')

    const states: string[] = []
    const ready = await client.waitForProvisioned({
      intervalMs: 1,
      timeoutMs: 1_000,
      onState: (state) => states.push(state.state),
    })
    expect(ready.state).toBe('Provisioned')
    expect(states).toEqual(['Provisioning', 'Provisioning', 'Provisioned'])

    const config = await client.getConfiguration()
    expect(config.keepAlivePulseInSeconds).toBe(300)
    expect(config.serverDetails?.port).toBe(9002)

    const play = calls.find((call) => call.url.endsWith('/play'))
    expect(play?.init.method).toBe('POST')
    const headers = new Headers(play?.init.headers)
    expect(headers.get('Authorization')).toBe('Bearer stream-token')
    expect(headers.get('X-MS-Device-Info')).toContain('Microsoft.GamingApp')
    const body = JSON.parse(String(play?.init.body)) as Record<string, unknown>
    expect(body.serverId).toBe('F4001DF950A8A')
    expect(body.titleId).toBe('')
    expect((body.settings as Record<string, unknown>).nanoVersion).toBe('V3;WebrtcTransport.dll')
  })

  it('polls the SDP answer and sends the exact ICE envelope', async () => {
    let sdpPolls = 0
    const { impl, calls } = stubFetch((url, init) => {
      if (url.endsWith('/play')) {
        return jsonResponse({ sessionPath: 'v5/sessions/home/XYZ', state: 'Provisioning' })
      }
      if (url.endsWith('/sdp') && init.method === 'POST') return emptyResponse()
      if (url.endsWith('/sdp')) {
        sdpPolls++
        return jsonResponse({
          exchangeResponse:
            sdpPolls === 1
              ? ''
              : JSON.stringify({ sdp: 'v=0\r\nanswer', sdpType: 'answer', status: 'success' }),
          errorDetails: { code: null, message: null },
        })
      }
      if (url.endsWith('/ice') && init.method === 'POST') return emptyResponse()
      if (url.endsWith('/ice')) {
        return jsonResponse({
          exchangeResponse: JSON.stringify([
            { candidate: 'a=candidate:1 1 udp 1 192.168.1.20 9002 typ host', sdpMid: '0', sdpMLineIndex: 0 },
          ]),
        })
      }
      if (url.endsWith('/keepalive')) return emptyResponse()
      if (init.method === 'DELETE') return emptyResponse()
      return emptyResponse(404)
    })
    const client = new GssvClient({
      baseUri: 'https://example.test',
      gsToken: 'token',
      fetchImpl: impl,
    })
    await client.startSession('console-1')
    await client.sendSdpOffer('v=0\r\noffer')
    const answer = await client.waitForSdpAnswer({ intervalMs: 1, timeoutMs: 500 })
    expect(answer.sdp).toBe('v=0\r\nanswer')
    expect(sdpPolls).toBe(2)

    const local = [
      { candidate: 'a=candidate:2 1 udp 1 192.168.1.9 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    ]
    await client.sendIceCandidates(local)
    const remote = await client.waitForIceCandidates({ intervalMs: 1, timeoutMs: 500 })
    expect(remote[0]?.candidate).toContain('192.168.1.20')

    await client.keepalive()
    await client.stopSession()

    const sdpPost = calls.find((call) => call.url.endsWith('/sdp') && call.init.method === 'POST')
    const sdpBody = JSON.parse(String(sdpPost?.init.body)) as Record<string, unknown>
    expect(sdpBody.messageType).toBe('offer')
    expect((sdpBody.configuration as Record<string, unknown>).input).toEqual({
      minVersion: 1,
      maxVersion: 8,
    })

    const icePost = calls.find((call) => call.url.endsWith('/ice') && call.init.method === 'POST')
    const iceBody = JSON.parse(String(icePost?.init.body)) as Record<string, unknown>
    expect(iceBody.messageType).toBe('iceCandidate')
    expect(iceBody.candidate).toEqual(local)
  })

  it('surfaces API failures with status and body', async () => {
    const { impl } = stubFetch(() =>
      new Response(JSON.stringify({ error: 'no console' }), { status: 404 }),
    )
    const client = new GssvClient({ baseUri: 'https://example.test', gsToken: 't', fetchImpl: impl })
    await expect(client.startSession('missing')).rejects.toMatchObject({
      name: 'GssvError',
      status: 404,
    })
    await expect(client.startSession('missing')).rejects.toBeInstanceOf(GssvError)
  })

  it('fails cleanly when the session ends in Failed', async () => {
    const { impl } = stubFetch((url) => {
      if (url.endsWith('/play')) return jsonResponse({ sessionPath: 'v5/sessions/home/X' })
      if (url.endsWith('/state')) {
        return jsonResponse({ state: 'Failed', errorDetails: { message: 'console offline' } })
      }
      return emptyResponse(404)
    })
    const client = new GssvClient({ baseUri: 'https://example.test', gsToken: 't', fetchImpl: impl })
    await client.startSession('X')
    await expect(client.waitForProvisioned({ intervalMs: 1 })).rejects.toThrow(/console offline/)
  })

  it('parses doubled JSON and normalizes ICE candidates', () => {
    expect(parseExchangeResponse(JSON.stringify({ a: 1 }))).toEqual({ a: 1 })
    expect(parseExchangeResponse(JSON.stringify(JSON.stringify({ b: 2 })))).toEqual({ b: 2 })
    expect(
      normalizeIceCandidate({
        candidate: 'a=candidate:1 1 udp 1 1.2.3.4 9002 typ host',
        sdpMLineIndex: '0' as unknown as number,
      }),
    ).toMatchObject({
      candidate: 'candidate:1 1 udp 1 1.2.3.4 9002 typ host',
      sdpMLineIndex: 0,
    })
  })
})

describe('Xbox Live console list', () => {
  it('extracts consoles from the xccs envelope', () => {
    const consoles = extractConsoleList({
      code: 200,
      data: {
        result: [
          { id: 'F4001DF950A8A', name: 'Sala', consoleType: 'XboxOneS', powerState: 'On' },
          { id: 'F4001DF950A8A', name: 'Duplicado' },
          { deviceId: 'B', deviceName: 'Quarto' },
          { name: 'Sem id' },
        ],
      },
    })
    expect(consoles).toHaveLength(2)
    expect(consoles[0]).toMatchObject({
      id: 'F4001DF950A8A',
      name: 'Sala',
      consoleType: 'XboxOneS',
      powerState: 'On',
    })
    expect(consoles[1]?.id).toBe('B')
  })

  it('sends the Xbox Live contract headers', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({ data: { result: [] } }))
    const result = await fetchConsoleList({ token: 'xsts', uhs: 'uhs-1' }, impl)
    expect(result).toEqual([])
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('Authorization')).toBe('XBL3.0 x=uhs-1;xsts')
    expect(headers.get('x-xbl-contract-version')).toBe('4')
    expect(headers.get('skillplatform')).toBe('RemoteManagement')
  })

  it('throws a helpful message on HTTP failure', async () => {
    const { impl } = stubFetch(() => new Response('nope', { status: 401 }))
    await expect(fetchConsoleList({ token: 't', uhs: 'u' }, impl)).rejects.toThrow(
      /console list failed \(401\)/,
    )
  })

  it('sends a WakeUp command through xccs with the contract headers', async () => {
    const { impl, calls } = stubFetch(() =>
      jsonResponse({ status: { errorCode: 'OK' } }),
    )
    await sendXccsCommand({ token: 'xsts', uhs: 'u' }, 'FD004670BEF12927', 'Power', 'WakeUp', [], impl)
    const call = calls[0]
    expect(call?.url).toBe('https://xccs.xboxlive.com/commands')
    const headers = new Headers(call?.init.headers)
    expect(headers.get('Authorization')).toBe('XBL3.0 x=u;xsts')
    expect(headers.get('skillplatform')).toBe('RemoteManagement')
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      destination: 'Xbox',
      type: 'Power',
      command: 'WakeUp',
      linkedXboxId: 'FD004670BEF12927',
    })
    expect(typeof body.sessionId).toBe('string')
  })

  it('surfaces command errors', async () => {
    const { impl } = stubFetch(() => new Response('denied', { status: 403 }))
    await expect(
      sendXccsCommand({ token: 't', uhs: 'u' }, 'X', 'Power', 'WakeUp', [], impl),
    ).rejects.toThrow(/Xbox command Power\/WakeUp failed \(403\)/)
  })
})
