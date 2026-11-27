/**
 * Gamepad model shared by the relay, the browser dashboard and the tests.
 *
 * Axis convention (important):
 *   - X: positive = right
 *   - Y: positive = DOWN  (same convention as the Web Gamepad API and
 *     Android MotionEvent). The wire encoder negates Y, matching the
 *     reference implementation (xbox-xcloud-player / Greenlight).
 */

export const PLAYER_SLOTS = 4
export type PlayerIndex = 0 | 1 | 2 | 3

/** Button bits used by the Xbox Remote Play input frame. */
export const BUTTON = {
  Nexus: 0x0002,
  Menu: 0x0004,
  View: 0x0008,
  A: 0x0010,
  B: 0x0020,
  X: 0x0040,
  Y: 0x0080,
  DPadUp: 0x0100,
  DPadDown: 0x0200,
  DPadLeft: 0x0400,
  DPadRight: 0x0800,
  LeftShoulder: 0x1000,
  RightShoulder: 0x2000,
  LeftThumb: 0x4000,
  RightThumb: 0x8000,
} as const

export type ButtonName = keyof typeof BUTTON

export interface GamepadState {
  /** Bitmask of `BUTTON` values. */
  buttons: number
  leftTrigger: number
  rightTrigger: number
  leftStickX: number
  leftStickY: number
  rightStickX: number
  rightStickY: number
}

export interface WebGamepadButtonLike {
  pressed?: boolean
  value?: number
}

export interface WebGamepadLike {
  index: number
  id: string
  connected?: boolean
  mapping?: string
  buttons: ReadonlyArray<WebGamepadButtonLike | undefined>
  axes: ReadonlyArray<number | undefined>
}

/** Standard Gamepad API button index -> Xbox button bit. */
export const WEB_BUTTON_TO_BIT: readonly number[] = [
  BUTTON.A, // 0
  BUTTON.B, // 1
  BUTTON.X, // 2
  BUTTON.Y, // 3
  BUTTON.LeftShoulder, // 4
  BUTTON.RightShoulder, // 5
  0, // 6 = left trigger (analog)
  0, // 7 = right trigger (analog)
  BUTTON.View, // 8
  BUTTON.Menu, // 9
  BUTTON.LeftThumb, // 10
  BUTTON.RightThumb, // 11
  BUTTON.DPadUp, // 12
  BUTTON.DPadDown, // 13
  BUTTON.DPadLeft, // 14
  BUTTON.DPadRight, // 15
  BUTTON.Nexus, // 16
]

export const BUTTON_NAMES: ReadonlyArray<[ButtonName, number]> = Object.entries(BUTTON) as Array<
  [ButtonName, number]
>

export function emptyGamepadState(): GamepadState {
  return {
    buttons: 0,
    leftTrigger: 0,
    rightTrigger: 0,
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return value < min ? min : value > max ? max : value
}

/**
 * Per-axis deadzone with rescaling. A small deadzone (8%) is also what the
 * reference client uses, and prevents idle stick drift from being forwarded
 * to the console forever. Per-axis (instead of radial) keeps full diagonal
 * range: a controller at (1,1) stays (1,1) instead of being reduced to 0.707.
 */
export function applyDeadzone(x: number, y: number, deadzone: number): [number, number] {
  const dz = clamp(deadzone, 0, 0.95)
  const scale = (value: number): number => {
    const magnitude = Math.abs(value)
    if (magnitude <= dz) return 0
    const rescaled = Math.min(1, (magnitude - dz) / (1 - dz))
    return value < 0 ? -rescaled : rescaled
  }
  return [scale(x), scale(y)]
}

export interface NormalizeOptions {
  deadzone?: number
}

/** Convert a Web Gamepad API snapshot into the shared normalized state. */
export function stateFromWebGamepad(
  gamepad: WebGamepadLike,
  options: NormalizeOptions = {},
): GamepadState {
  const deadzone = options.deadzone ?? 0.08
  let buttons = 0
  const buttonCount = Math.min(gamepad.buttons.length, WEB_BUTTON_TO_BIT.length)
  for (let i = 0; i < buttonCount; i++) {
    const button = gamepad.buttons[i]
    const bit = WEB_BUTTON_TO_BIT[i] ?? 0
    if (!bit) continue
    if (button?.pressed === true || (button?.value ?? 0) > 0.5) {
      buttons |= bit
    }
  }

  const [leftX, leftY] = applyDeadzone(
    gamepad.axes[0] ?? 0,
    gamepad.axes[1] ?? 0,
    deadzone,
  )
  const [rightX, rightY] = applyDeadzone(
    gamepad.axes[2] ?? 0,
    gamepad.axes[3] ?? 0,
    deadzone,
  )

  const leftTrigger = clamp(gamepad.buttons[6]?.value ?? 0, 0, 1)
  const rightTrigger = clamp(gamepad.buttons[7]?.value ?? 0, 0, 1)

  return {
    buttons,
    leftTrigger,
    rightTrigger,
    leftStickX: leftX,
    leftStickY: leftY,
    rightStickX: rightX,
    rightStickY: rightY,
  }
}

export function hasButton(state: GamepadState, name: ButtonName): boolean {
  return (state.buttons & BUTTON[name]) !== 0
}

export function withButton(state: GamepadState, name: ButtonName, pressed: boolean): GamepadState {
  return {
    ...state,
    buttons: pressed ? state.buttons | BUTTON[name] : state.buttons & ~BUTTON[name],
  }
}

export function stateEquals(a: GamepadState, b: GamepadState): boolean {
  return (
    a.buttons === b.buttons &&
    a.leftTrigger === b.leftTrigger &&
    a.rightTrigger === b.rightTrigger &&
    a.leftStickX === b.leftStickX &&
    a.leftStickY === b.leftStickY &&
    a.rightStickX === b.rightStickX &&
    a.rightStickY === b.rightStickY
  )
}

/** Degree of change, used by the input scheduler to avoid flooding the console. */
export function stateDistance(a: GamepadState, b: GamepadState): number {
  let distance = a.buttons === b.buttons ? 0 : 1
  distance = Math.max(
    distance,
    Math.abs(a.leftTrigger - b.leftTrigger),
    Math.abs(a.rightTrigger - b.rightTrigger),
    Math.abs(a.leftStickX - b.leftStickX),
    Math.abs(a.leftStickY - b.leftStickY),
    Math.abs(a.rightStickX - b.rightStickX),
    Math.abs(a.rightStickY - b.rightStickY),
  )
  return distance
}

export function describeButtons(mask: number): string[] {
  return BUTTON_NAMES.filter(([, bit]) => (mask & bit) !== 0).map(([name]) => name)
}

export function isPlayerIndex(value: number): value is PlayerIndex {
  return Number.isInteger(value) && value >= 0 && value < PLAYER_SLOTS
}
