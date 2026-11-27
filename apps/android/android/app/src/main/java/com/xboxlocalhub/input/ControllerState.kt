package com.xboxlocalhub.input

/**
 * Button bits must match `src/core/gamepad.ts` and the Xbox input frame.
 * Never reorder or renumber without updating the shared tests.
 */
object GamepadButtons {
    const val NEXUS = 0x0002
    const val MENU = 0x0004
    const val VIEW = 0x0008
    const val A = 0x0010
    const val B = 0x0020
    const val X = 0x0040
    const val Y = 0x0080
    const val DPAD_UP = 0x0100
    const val DPAD_DOWN = 0x0200
    const val DPAD_LEFT = 0x0400
    const val DPAD_RIGHT = 0x0800
    const val LEFT_SHOULDER = 0x1000
    const val RIGHT_SHOULDER = 0x2000
    const val LEFT_THUMB = 0x4000
    const val RIGHT_THUMB = 0x8000
}

data class ControllerState(
    var buttons: Int = 0,
    var leftTrigger: Float = 0f,
    var rightTrigger: Float = 0f,
    var leftStickX: Float = 0f,
    var leftStickY: Float = 0f,
    var rightStickX: Float = 0f,
    var rightStickY: Float = 0f,
)
