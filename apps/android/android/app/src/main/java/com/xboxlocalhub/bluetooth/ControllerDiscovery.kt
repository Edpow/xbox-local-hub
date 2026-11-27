package com.xboxlocalhub.bluetooth

import android.content.Context
import android.view.InputDevice
import com.xboxlocalhub.input.GamepadMapper

data class ControllerDevice(
    val deviceId: Int,
    val name: String,
    val descriptor: String,
    val vendorId: Int,
    val productId: Int,
    val sources: Int,
)

/**
 * Enumerates physical InputDevices that expose a gamepad/joystick source.
 * Android pairs Bluetooth HID controllers at the OS level; the app never
 * speaks Bluetooth directly, so no root/driver is required.
 */
object ControllerDiscovery {
    fun enumerate(context: Context): List<ControllerDevice> {
        val manager = context.getSystemService(Context.INPUT_SERVICE) as? android.hardware.input.InputManager
            ?: return emptyList()
        val result = mutableListOf<ControllerDevice>()
        for (id in manager.inputDeviceIds) {
            val device = manager.getInputDevice(id) ?: continue
            if (!GamepadMapper.isGamepadDevice(device)) continue
            result.add(
                ControllerDevice(
                    deviceId = device.id,
                    name = device.name ?: "Controle ${device.id}",
                    descriptor = device.descriptor,
                    vendorId = device.vendorId,
                    productId = device.productId,
                    sources = device.sources,
                ),
            )
        }
        return result.sortedBy { it.deviceId }
    }

    fun find(context: Context, deviceId: Int): ControllerDevice? =
        enumerate(context).firstOrNull { it.deviceId == deviceId }

    fun isGamepad(device: InputDevice): Boolean = GamepadMapper.isGamepadDevice(device)
}
