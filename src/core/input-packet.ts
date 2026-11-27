/**
 * Xbox Remote Play binary input-packet encoder.
 *
 * Reverse-engineered format shared by the open-source clients
 * (unknownskl/xbox-xcloud-player, Greenlight, XStreaming). Layout:
 *
 *   offset  size  field
 *   0       2     report type bitmask (little endian)
 *   2       4     sequence number (little endian, wrapping u32)
 *   6       8     client timestamp in ms (little endian f64)
 *   14      ...   payload blocks, in this order:
 *                   metadata, gamepad, pointer, mouse, keyboard
 *
 * Gamepad block:
 *   1 byte count, then for each frame (23 bytes):
 *     0  1  gamepad index (0..3)
 *     1  2  button bitmask (LE)
 *     3  2  left stick X  (i16 LE)
 *     5  2  left stick Y  (i16 LE, NEGATED: see note below)
 *     7  2  right stick X (i16 LE)
 *     9  2  right stick Y (i16 LE, NEGATED)
 *    11  2  left trigger  (u16 LE, 0..65535)
 *    13  2  right trigger (u16 LE, 0..65535)
 *    15  4  "physical physicality"  (u32 LE, reference sends 1)
 *    19  4  "virtual physicality"   (u32 BE, reference sends 1)
 *   = 23 bytes
 *
 * The Y negation and the mixed-endian physicality fields are quirks copied
 * verbatim from the reference implementation, not choices of this project.
 */

import type { GamepadState } from './gamepad.js'

export enum ReportType {
  None = 0,
  Metadata = 1,
  Gamepad = 2,
  Pointer = 4,
  ClientMetadata = 8,
  ServerMetadata = 16,
  Mouse = 32,
  Keyboard = 64,
  Vibration = 128,
  Sensor = 256,
  UnreliableInputReport = 512,
  UnreliableInputAck = 1024,
}

export const INPUT_PACKET_HEADER_SIZE = 14
export const GAMEPAD_FRAME_SIZE = 23
export const METADATA_FRAME_SIZE = 28

export interface GamepadFrame {
  /** Player/controller slot, 0..3. */
  gamepadIndex: number
  state: GamepadState
}

export interface MetadataFrame {
  serverDataKey: number
  firstFramePacketArrivalTimeMs: number
  frameSubmittedTimeMs: number
  frameDecodedTimeMs: number
  frameRenderedTimeMs: number
  framePacketTimeMs?: number
  frameDateNowMs?: number
}

export interface EncodeOptions {
  sequence: number
  timestampMs?: number
  metadata?: MetadataFrame[]
  gamepads?: GamepadFrame[]
  /** Reference client sends 1. Kept configurable for experiments. */
  physicalPhysicality?: number
  virtualPhysicality?: number
}

export function normalizeAxis(value: number): number {
  if (!Number.isFinite(value)) return 0
  const scaled = Math.round(value * 32767)
  return scaled > 32767 ? 32767 : scaled < -32767 ? -32767 : scaled
}

export function normalizeTrigger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 65535
  return Math.round(value * 65535)
}

function payloadSize(options: EncodeOptions): number {
  const metadataCount = options.metadata?.length ?? 0
  const gamepadCount = options.gamepads?.length ?? 0
  let size = INPUT_PACKET_HEADER_SIZE
  if (metadataCount > 0) size += 1 + metadataCount * METADATA_FRAME_SIZE
  if (gamepadCount > 0) size += 1 + gamepadCount * GAMEPAD_FRAME_SIZE
  return size
}

export function encodeInputPacket(options: EncodeOptions): Uint8Array {
  const metadata = options.metadata ?? []
  const gamepads = options.gamepads ?? []
  if (metadata.length > 255) throw new Error('Too many metadata frames')
  if (gamepads.length > 255) throw new Error('Too many gamepad frames')

  let reportType = ReportType.None
  if (metadata.length > 0) reportType |= ReportType.Metadata
  if (gamepads.length > 0) reportType |= ReportType.Gamepad
  if (reportType === ReportType.None) {
    throw new Error('Input packet must contain at least one frame')
  }

  const buffer = new Uint8Array(payloadSize(options))
  const view = new DataView(buffer.buffer)

  view.setUint16(0, reportType, true)
  view.setUint32(2, options.sequence >>> 0, true)
  view.setFloat64(6, options.timestampMs ?? performance.now(), true)

  let offset = INPUT_PACKET_HEADER_SIZE

  if (metadata.length > 0) {
    view.setUint8(offset++, metadata.length)
    for (const frame of metadata) {
      view.setUint32(offset, frame.serverDataKey >>> 0, true)
      view.setUint32(offset + 4, frame.firstFramePacketArrivalTimeMs >>> 0, true)
      view.setUint32(offset + 8, frame.frameSubmittedTimeMs >>> 0, true)
      view.setUint32(offset + 12, frame.frameDecodedTimeMs >>> 0, true)
      view.setUint32(offset + 16, frame.frameRenderedTimeMs >>> 0, true)
      view.setUint32(offset + 20, (frame.framePacketTimeMs ?? 0) >>> 0, true)
      view.setUint32(offset + 24, (frame.frameDateNowMs ?? 0) >>> 0, true)
      offset += METADATA_FRAME_SIZE
    }
  }

  if (gamepads.length > 0) {
    view.setUint8(offset++, gamepads.length)
    const physical = (options.physicalPhysicality ?? 1) >>> 0
    const virtual = (options.virtualPhysicality ?? 1) >>> 0
    for (const frame of gamepads) {
      if (!Number.isInteger(frame.gamepadIndex) || frame.gamepadIndex < 0 || frame.gamepadIndex > 255) {
        throw new Error(`Invalid gamepad index: ${frame.gamepadIndex}`)
      }
      const { state } = frame
      view.setUint8(offset, frame.gamepadIndex)
      view.setUint16(offset + 1, state.buttons & 0xffff, true)
      view.setInt16(offset + 3, normalizeAxis(state.leftStickX), true)
      view.setInt16(offset + 5, normalizeAxis(-state.leftStickY), true)
      view.setInt16(offset + 7, normalizeAxis(state.rightStickX), true)
      view.setInt16(offset + 9, normalizeAxis(-state.rightStickY), true)
      view.setUint16(offset + 11, normalizeTrigger(state.leftTrigger), true)
      view.setUint16(offset + 13, normalizeTrigger(state.rightTrigger), true)
      view.setUint32(offset + 15, physical, true)
      view.setUint32(offset + 19, virtual, false)
      offset += GAMEPAD_FRAME_SIZE
    }
  }

  if (offset !== buffer.length) {
    throw new Error(`Input packet length mismatch: wrote ${offset}, expected ${buffer.length}`)
  }
  return buffer
}

/** First packet sent on the input channel: client capabilities. */
export function encodeClientMetadataPacket(
  sequence = 0,
  maxTouchPoints = 1,
  timestampMs?: number,
): Uint8Array {
  const buffer = new Uint8Array(INPUT_PACKET_HEADER_SIZE + 1)
  const view = new DataView(buffer.buffer)
  view.setUint16(0, ReportType.ClientMetadata, true)
  view.setUint32(2, sequence >>> 0, true)
  view.setFloat64(6, timestampMs ?? performance.now(), true)
  view.setUint8(INPUT_PACKET_HEADER_SIZE, Math.max(0, Math.min(255, maxTouchPoints)))
  return buffer
}

export interface DecodedGamepadFrame extends GamepadFrame {
  rawButtons: number
  rawLeftStickX: number
  rawLeftStickY: number
  rawRightStickX: number
  rawRightStickY: number
  rawLeftTrigger: number
  rawRightTrigger: number
  physicalPhysicality: number
  virtualPhysicality: number
}

export interface DecodedInputPacket {
  reportType: number
  sequence: number
  timestampMs: number
  gamepads: DecodedGamepadFrame[]
  metadataCount: number
}

/**
 * Decoder used by the mock console and diagnostics. It intentionally mirrors
 * `encodeInputPacket` so that round-trip tests can catch layout mistakes.
 */
export function decodeInputPacket(buffer: Uint8Array): DecodedInputPacket {
  if (buffer.length < INPUT_PACKET_HEADER_SIZE) throw new Error('Packet too short')
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const reportType = view.getUint16(0, true)
  const sequence = view.getUint32(2, true)
  const timestampMs = view.getFloat64(6, true)
  let offset = INPUT_PACKET_HEADER_SIZE
  let metadataCount = 0
  const gamepads: DecodedGamepadFrame[] = []

  if (reportType & ReportType.Metadata) {
    metadataCount = view.getUint8(offset++)
    offset += metadataCount * METADATA_FRAME_SIZE
  }

  if (reportType & ReportType.Gamepad) {
    const count = view.getUint8(offset++)
    for (let i = 0; i < count; i++) {
      if (offset + GAMEPAD_FRAME_SIZE > buffer.length) throw new Error('Truncated gamepad frame')
      const gamepadIndex = view.getUint8(offset)
      const rawButtons = view.getUint16(offset + 1, true)
      const rawLeftStickX = view.getInt16(offset + 3, true)
      const rawLeftStickY = view.getInt16(offset + 5, true)
      const rawRightStickX = view.getInt16(offset + 7, true)
      const rawRightStickY = view.getInt16(offset + 9, true)
      const rawLeftTrigger = view.getUint16(offset + 11, true)
      const rawRightTrigger = view.getUint16(offset + 13, true)
      const physicalPhysicality = view.getUint32(offset + 15, true)
      const virtualPhysicality = view.getUint32(offset + 19, false)
      gamepads.push({
        gamepadIndex,
        rawButtons,
        rawLeftStickX,
        rawLeftStickY,
        rawRightStickX,
        rawRightStickY,
        rawLeftTrigger,
        rawRightTrigger,
        physicalPhysicality,
        virtualPhysicality,
        state: {
          buttons: rawButtons,
          leftStickX: rawLeftStickX / 32767,
          leftStickY: -rawLeftStickY / 32767,
          rightStickX: rawRightStickX / 32767,
          rightStickY: -rawRightStickY / 32767,
          leftTrigger: rawLeftTrigger / 65535,
          rightTrigger: rawRightTrigger / 65535,
        },
      })
      offset += GAMEPAD_FRAME_SIZE
    }
  }

  return { reportType, sequence, timestampMs, gamepads, metadataCount }
}
