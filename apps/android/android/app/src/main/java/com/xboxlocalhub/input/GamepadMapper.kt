package com.xboxlocalhub.input

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Maps Android KeyEvent/MotionEvent into the shared normalized controller
 * state. Y axes are kept in the Android/Gamepad-API convention (positive =
 * down); the TS encoder applies the protocol's Y negation.
 */
object GamepadMapper {
    private const val DEADZONE = 0.08f

    fun isGamepadDevice(device: InputDevice): Boolean {
        if (device.isVirtual) return false
        val sources = device.sources
        val gamepad = (sources and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
        val joystick = (sources and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
        return gamepad || joystick
    }

    fun keyToButton(keyCode: Int): Int? = when (keyCode) {
        KeyEvent.KEYCODE_BUTTON_A -> GamepadButtons.A
        KeyEvent.KEYCODE_BUTTON_B -> GamepadButtons.B
        KeyEvent.KEYCODE_BUTTON_X -> GamepadButtons.X
        KeyEvent.KEYCODE_BUTTON_Y -> GamepadButtons.Y
        KeyEvent.KEYCODE_BUTTON_L1 -> GamepadButtons.LEFT_SHOULDER
        KeyEvent.KEYCODE_BUTTON_R1 -> GamepadButtons.RIGHT_SHOULDER
        KeyEvent.KEYCODE_BUTTON_THUMBL -> GamepadButtons.LEFT_THUMB
        KeyEvent.KEYCODE_BUTTON_THUMBR -> GamepadButtons.RIGHT_THUMB
        KeyEvent.KEYCODE_BUTTON_START -> GamepadButtons.MENU
        KeyEvent.KEYCODE_BUTTON_SELECT -> GamepadButtons.VIEW
        KeyEvent.KEYCODE_BUTTON_MODE -> GamepadButtons.NEXUS
        KeyEvent.KEYCODE_DPAD_UP -> GamepadButtons.DPAD_UP
        KeyEvent.KEYCODE_DPAD_DOWN -> GamepadButtons.DPAD_DOWN
        KeyEvent.KEYCODE_DPAD_LEFT -> GamepadButtons.DPAD_LEFT
        KeyEvent.KEYCODE_DPAD_RIGHT -> GamepadButtons.DPAD_RIGHT
        else -> null
    }

    /**
     * Applies a key event. Returns true when the event belongs to a gamepad
     * and was consumed (so Android does not also navigate the UI).
     */
    fun applyKey(state: ControllerState, event: KeyEvent): Boolean {
        val button = keyToButton(event.keyCode)
        val trigger = when (event.keyCode) {
            KeyEvent.KEYCODE_BUTTON_L2 -> true
            KeyEvent.KEYCODE_BUTTON_R2 -> true
            else -> false
        }
        if (button == null && !trigger) return false
        if (event.repeatCount > 0) return true

        val pressed = event.action == KeyEvent.ACTION_DOWN
        if (button != null) {
            state.buttons = if (pressed) state.buttons or button else state.buttons and button.inv()
        }
        if (event.keyCode == KeyEvent.KEYCODE_BUTTON_L2) {
            state.leftTrigger = if (pressed) 1f else 0f
        }
        if (event.keyCode == KeyEvent.KEYCODE_BUTTON_R2) {
            state.rightTrigger = if (pressed) 1f else 0f
        }
        return true
    }

    fun applyMotion(state: ControllerState, event: MotionEvent): Boolean {
        if (event.action != MotionEvent.ACTION_MOVE) return false
        var handled = false

        val leftX = event.getAxisValue(MotionEvent.AXIS_X)
        val leftY = event.getAxisValue(MotionEvent.AXIS_Y)
        if (leftX != 0f || leftY != 0f) handled = true
        state.leftStickX = deadzone(leftX)
        state.leftStickY = deadzone(leftY)

        // Modern Android gamepads report the right stick on RX/RY; some older
        // ones use Z/RZ. Prefer RX/RY but fall back when they are centred.
        var rightX = event.getAxisValue(MotionEvent.AXIS_RX)
        var rightY = event.getAxisValue(MotionEvent.AXIS_RY)
        if (abs(rightX) < 0.01f) rightX = event.getAxisValue(MotionEvent.AXIS_Z)
        if (abs(rightY) < 0.01f) rightY = event.getAxisValue(MotionEvent.AXIS_RZ)
        if (rightX != 0f || rightY != 0f) handled = true
        state.rightStickX = deadzone(rightX)
        state.rightStickY = deadzone(rightY)

        val lt = event.getAxisValue(MotionEvent.AXIS_LTRIGGER)
            .takeIf { abs(it) > 0.001f }
            ?: event.getAxisValue(MotionEvent.AXIS_BRAKE)
        val rt = event.getAxisValue(MotionEvent.AXIS_RTRIGGER)
            .takeIf { abs(it) > 0.001f }
            ?: event.getAxisValue(MotionEvent.AXIS_GAS)
        state.leftTrigger = clamp01(lt)
        state.rightTrigger = clamp01(rt)
        if (lt != 0f || rt != 0f) handled = true

        // Some pads expose the D-pad as a hat axis instead of key events.
        val hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X)
        val hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y)
        if (hatX != 0f || hatY != 0f) {
            val clear = GamepadButtons.DPAD_UP or GamepadButtons.DPAD_DOWN or
                GamepadButtons.DPAD_LEFT or GamepadButtons.DPAD_RIGHT
            state.buttons = state.buttons and clear.inv()
            if (hatX <= -0.5f) state.buttons = state.buttons or GamepadButtons.DPAD_LEFT
            if (hatX >= 0.5f) state.buttons = state.buttons or GamepadButtons.DPAD_RIGHT
            if (hatY <= -0.5f) state.buttons = state.buttons or GamepadButtons.DPAD_UP
            if (hatY >= 0.5f) state.buttons = state.buttons or GamepadButtons.DPAD_DOWN
            handled = true
        }

        return handled
    }

    private fun deadzone(value: Float): Float {
        val magnitude = abs(value)
        if (magnitude <= DEADZONE) return 0f
        val rescaled = min(1f, (magnitude - DEADZONE) / (1f - DEADZONE))
        return if (value < 0f) -rescaled else rescaled
    }

    private fun clamp01(value: Float): Float = max(0f, min(1f, value))
}
