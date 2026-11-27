import { describe, expect, it } from 'vitest'
import {
  BUTTON,
  emptyGamepadState,
  stateDistance,
  stateEquals,
  stateFromWebGamepad,
  withButton,
  describeButtons,
  applyDeadzone,
} from '../src/core/gamepad.js'
import {
  GAMEPAD_FRAME_SIZE,
  INPUT_PACKET_HEADER_SIZE,
  ReportType,
  decodeInputPacket,
  encodeClientMetadataPacket,
  encodeInputPacket,
  normalizeAxis,
  normalizeTrigger,
} from '../src/core/input-packet.js'

describe('gamepad normalization', () => {
  it('maps the standard Gamepad API to Xbox bits and axes', () => {
    const state = stateFromWebGamepad({
      index: 0,
      id: 'Xbox Wireless Controller',
      connected: true,
      buttons: [
        { pressed: true, value: 1 }, // A
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: true, value: 1 }, // Y
        { pressed: true, value: 1 }, // LB
        { pressed: false, value: 0 },
        { pressed: false, value: 0.75 }, // LT
        { pressed: false, value: 0.25 }, // RT
        { pressed: true, value: 1 }, // View
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: true, value: 1 }, // DPadUp
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: true, value: 1 }, // Nexus
      ],
      axes: [1, 1, -1, -1],
    })
    expect(state.buttons).toBe(
      BUTTON.A | BUTTON.Y | BUTTON.LeftShoulder | BUTTON.View | BUTTON.DPadUp | BUTTON.Nexus,
    )
    expect(state.leftTrigger).toBeCloseTo(0.75)
    expect(state.rightTrigger).toBeCloseTo(0.25)
    expect(state.leftStickX).toBe(1)
    expect(state.leftStickY).toBe(1)
    expect(state.rightStickX).toBe(-1)
    expect(state.rightStickY).toBe(-1)
  })

  it('applies a radial deadzone and rescales the remaining range', () => {
    expect(applyDeadzone(0.01, 0.01, 0.08)).toEqual([0, 0])
    const [x, y] = applyDeadzone(0.5, 0, 0.08)
    expect(x).toBeGreaterThan(0.45)
    expect(x).toBeLessThan(0.5)
    expect(y).toBe(0)
  })

  it('treats idle drift as neutral', () => {
    const state = stateFromWebGamepad({
      index: 0,
      id: 'pad',
      buttons: [],
      axes: [0.03, -0.02, 0.04, 0.01],
    })
    expect(state.leftStickX).toBe(0)
    expect(state.leftStickY).toBe(0)
    expect(state.rightStickX).toBe(0)
    expect(state.rightStickY).toBe(0)
  })

  it('compares states and computes change distance', () => {
    const base = emptyGamepadState()
    const pressed = withButton(base, 'A', true)
    expect(stateEquals(base, { ...base })).toBe(true)
    expect(stateEquals(base, pressed)).toBe(false)
    expect(stateDistance(base, pressed)).toBe(1)
    expect(stateDistance(base, { ...base, leftStickX: 0.1 })).toBeCloseTo(0.1)
    expect(describeButtons(pressed.buttons | BUTTON.B)).toEqual(['A', 'B'])
  })
})

describe('input packet encoder', () => {
  it('clamps axes and triggers exactly like the reference client', () => {
    expect(normalizeAxis(2)).toBe(32767)
    expect(normalizeAxis(-2)).toBe(-32767)
    expect(normalizeAxis(Number.NaN)).toBe(0)
    expect(normalizeTrigger(-1)).toBe(0)
    expect(normalizeTrigger(2)).toBe(65535)
    expect(normalizeTrigger(0.5)).toBe(32768)
  })

  it('encodes a single gamepad frame with the reference byte layout', () => {
    const packet = encodeInputPacket({
      sequence: 7,
      timestampMs: 1000,
      physicalPhysicality: 1,
      virtualPhysicality: 1,
      gamepads: [
        {
          gamepadIndex: 0,
          state: {
            buttons: BUTTON.A,
            leftTrigger: 1,
            rightTrigger: 0,
            leftStickX: 1,
            leftStickY: 1,
            rightStickX: 0,
            rightStickY: 0,
          },
        },
      ],
    })
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
    expect(packet.length).toBe(INPUT_PACKET_HEADER_SIZE + 1 + GAMEPAD_FRAME_SIZE)
    expect(view.getUint16(0, true)).toBe(ReportType.Gamepad)
    expect(view.getUint32(2, true)).toBe(7)
    expect(view.getFloat64(6, true)).toBe(1000)
    expect(view.getUint8(14)).toBe(1) // frame count
    expect(view.getUint8(15)).toBe(0) // gamepad index
    expect(view.getUint16(16, true)).toBe(BUTTON.A)
    expect(view.getInt16(18, true)).toBe(32767) // LX
    expect(view.getInt16(20, true)).toBe(-32767) // LY is negated
    expect(view.getUint16(26, true)).toBe(65535) // LT
    expect(view.getUint16(28, true)).toBe(0) // RT
    expect(view.getUint32(30, true)).toBe(1) // physical, LE
    expect(view.getUint32(34, false)).toBe(1) // virtual, BE quirk
  })

  it('encodes four independent player frames and round-trips them', () => {
    const states = [BUTTON.A, BUTTON.B, BUTTON.X, BUTTON.Y]
    const packet = encodeInputPacket({
      sequence: 42,
      timestampMs: 2000,
      gamepads: states.map((buttons, index) => ({
        gamepadIndex: index,
        state: { ...emptyGamepadState(), buttons, leftStickX: index / 4 },
      })),
    })
    expect(packet.length).toBe(INPUT_PACKET_HEADER_SIZE + 1 + 4 * GAMEPAD_FRAME_SIZE)
    const decoded = decodeInputPacket(packet)
    expect(decoded.sequence).toBe(42)
    expect(decoded.gamepads.map((frame) => frame.gamepadIndex)).toEqual([0, 1, 2, 3])
    expect(decoded.gamepads.map((frame) => frame.rawButtons)).toEqual(states)
    expect(decoded.gamepads[2]?.rawLeftStickX).toBe(16384)
    expect(decoded.gamepads.every((frame) => frame.virtualPhysicality === 1)).toBe(true)
  })

  it('supports the Better xCloud physicality 0/0 mode', () => {
    const packet = encodeInputPacket({
      sequence: 9,
      physicalPhysicality: 0,
      virtualPhysicality: 0,
      gamepads: [{ gamepadIndex: 1, state: emptyGamepadState() }],
    })
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
    expect(view.getUint32(30, true)).toBe(0)
    expect(view.getUint32(34, false)).toBe(0)
    expect(view.getUint8(15)).toBe(1)
  })

  it('encodes the client metadata packet as 15 bytes', () => {
    const packet = encodeClientMetadataPacket(0, 4, 500)
    expect(packet.length).toBe(15)
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
    expect(view.getUint16(0, true)).toBe(ReportType.ClientMetadata)
    expect(view.getFloat64(6, true)).toBe(500)
    expect(view.getUint8(14)).toBe(4)
  })

  it('rejects empty packets and invalid indices', () => {
    expect(() => encodeInputPacket({ sequence: 1 })).toThrow(/at least one frame/)
    expect(() =>
      encodeInputPacket({
        sequence: 1,
        gamepads: [{ gamepadIndex: -1, state: emptyGamepadState() }],
      }),
    ).toThrow(/Invalid gamepad index/)
  })

  it('decodes truncated packets safely', () => {
    const packet = encodeInputPacket({
      sequence: 1,
      gamepads: [{ gamepadIndex: 0, state: emptyGamepadState() }],
    })
    expect(() => decodeInputPacket(packet.slice(0, 20))).toThrow(/Truncated/)
  })
})
