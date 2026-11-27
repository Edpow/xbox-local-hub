/**
 * Xbox Live console list (xccs.xboxlive.com).
 *
 * This is the only way to obtain the `serverId` required by the xHome
 * Remote Play API. SmartGlass LAN discovery returns a different UUID.
 */

import { randomUUID } from 'node:crypto'
import type { FetchLike } from './gssv.js'

export interface WebToken {
  /** XSTS token for http://xboxlive.com */
  token: string
  /** user hash (uhs) */
  uhs: string
}

export interface XboxConsoleInfo {
  /** The value to use as `serverId` in /v5/sessions/home/play. */
  id: string
  name: string
  consoleType?: string
  powerState?: string
  raw: Record<string, unknown>
}

const CONSOLE_LIST_URL =
  'https://xccs.xboxlive.com/lists/devices?queryCurrentDevice=false&includeStorageDevices=true'

export async function fetchConsoleList(
  webToken: WebToken,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20_000,
): Promise<XboxConsoleInfo[]> {
  if (!webToken.token || !webToken.uhs) throw new Error('Missing Xbox Live web token or user hash')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(CONSOLE_LIST_URL, {
      headers: {
        Authorization: `XBL3.0 x=${webToken.uhs};${webToken.token}`,
        'x-xbl-contract-version': '4',
        skillplatform: 'RemoteManagement',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': 'en-US',
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Xbox console list failed (${response.status}): ${body.slice(0, 300)}`)
    }
    return extractConsoleList(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

export function extractConsoleList(payload: unknown): XboxConsoleInfo[] {
  const records = findRecordArray(payload)
  const output: XboxConsoleInfo[] = []
  const seen = new Set<string>()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const raw = record as Record<string, unknown>
    const id = firstString(raw.id, raw.deviceId, raw.consoleId, raw.serverId)
    if (!id || seen.has(id)) continue
    seen.add(id)
    output.push({
      id,
      name: firstString(raw.name, raw.deviceName, raw.consoleName) ?? id,
      consoleType: firstString(raw.consoleType, raw.type),
      powerState: firstString(raw.powerState, raw.power),
      raw,
    })
  }
  return output
}

function findRecordArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const object = payload as Record<string, unknown>
  for (const key of ['result', 'devices', 'consoles']) {
    if (Array.isArray(object[key])) return object[key] as unknown[]
  }
  if (object.data) {
    const nested = findRecordArray(object.data)
    if (nested.length > 0) return nested
  }
  return []
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export type XccsCommandType = 'Power' | 'Shell' | 'Audio' | 'TV'

/**
 * Sends a remote-management command through Xbox Live (xccs). `WakeUp` works
 * for consoles that are registered with WNS (ConnectedStandby / Instant-On).
 */
export async function sendXccsCommand(
  webToken: WebToken,
  consoleId: string,
  type: XccsCommandType,
  command: string,
  parameters: unknown[] = [],
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20_000,
): Promise<unknown> {
  if (!consoleId) throw new Error('consoleId is required')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl('https://xccs.xboxlive.com/commands', {
      method: 'POST',
      headers: {
        Authorization: `XBL3.0 x=${webToken.uhs};${webToken.token}`,
        'x-xbl-contract-version': '4',
        skillplatform: 'RemoteManagement',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        destination: 'Xbox',
        type,
        command,
        sessionId: randomUUID(),
        sourceId: 'com.microsoft.smartglass',
        parameters,
        linkedXboxId: consoleId,
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    let data: unknown = text
    try {
      data = JSON.parse(text) as unknown
    } catch {
      // keep text
    }
    if (!response.ok) {
      throw new Error(
        `Xbox command ${type}/${command} failed (${response.status}): ${text.slice(0, 300)}`,
      )
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}
