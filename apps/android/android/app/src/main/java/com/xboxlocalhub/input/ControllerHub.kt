package com.xboxlocalhub.input

import android.content.Context
import android.hardware.input.InputManager
import android.os.Handler
import android.os.Looper
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import com.xboxlocalhub.bluetooth.ControllerDiscovery
import com.xboxlocalhub.diagnostics.DiagnosticsLog
import com.xboxlocalhub.multiplayer.NativePlayerManager
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Owns the controller state and the 60 Hz frame pump that feeds the WebView.
 *
 * Everything runs on the main looper: Android delivers key/motion events on
 * the UI thread and the WebView injection must also happen there. No React
 * Native bridge is involved in the high-frequency path.
 */
object ControllerHub {
    const val SLOT_COUNT = 4
    private const val FRAME_INTERVAL_MS = 16L
    private const val UI_EMIT_EVERY_FRAMES = 6

    data class DeviceEntry(
        val deviceId: Int,
        val name: String,
        val descriptor: String,
        val state: ControllerState = ControllerState(),
        var lastSeen: Long = System.currentTimeMillis(),
    )

    interface FrameSink {
        fun sendFrame(json: String)
    }

    private var appContext: Context? = null
    private var players: NativePlayerManager? = null
    private var inputManager: InputManager? = null
    private val devices = LinkedHashMap<Int, DeviceEntry>()
    private val listeners = LinkedHashSet<(String) -> Unit>()
    private var sink: WeakReference<FrameSink>? = null
    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    private var listenerRegistered = false
    private var frameCounter = 0L

    fun init(context: Context) {
        if (appContext != null) return
        val app = context.applicationContext
        appContext = app
        players = NativePlayerManager(app)
        inputManager = app.getSystemService(Context.INPUT_SERVICE) as? InputManager
        ControllerDiscovery.enumerate(app).forEach { addDevice(it.deviceId, it.name, it.descriptor) }
        registerDeviceListener()
        DiagnosticsLog.add("hub", "Captura inicializada (${devices.size} controle(s) visível(is))")
    }

    fun start(context: Context? = null) {
        if (context != null) init(context)
        if (running) return
        running = true
        handler.post(framePump)
        DiagnosticsLog.add("hub", "Frame pump ativo (${FRAME_INTERVAL_MS}ms)")
    }

    fun pause() {
        running = false
        handler.removeCallbacks(framePump)
    }

    fun shutdown() {
        pause()
        unregisterDeviceListener()
    }

    fun attachSink(newSink: FrameSink) {
        sink = WeakReference(newSink)
        DiagnosticsLog.add("hub", "WebView conectado ao frame pump")
    }

    fun detachSink(oldSink: FrameSink) {
        if (sink?.get() === oldSink) sink = null
    }

    fun addListener(listener: (String) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (String) -> Unit) {
        listeners.remove(listener)
    }

    fun handleKeyEvent(event: KeyEvent): Boolean {
        val manager = inputManager ?: return false
        val device = manager.getInputDevice(event.deviceId) ?: return false
        if (!GamepadMapper.isGamepadDevice(device)) return false
        val entry = ensureDevice(device)
        val consumed = GamepadMapper.applyKey(entry.state, event)
        if (consumed) {
            entry.lastSeen = System.currentTimeMillis()
            maybeEmitUi()
        }
        return consumed
    }

    fun handleMotionEvent(event: MotionEvent): Boolean {
        val manager = inputManager ?: return false
        val device = manager.getInputDevice(event.deviceId) ?: return false
        if (!GamepadMapper.isGamepadDevice(device)) return false
        val entry = ensureDevice(device)
        val consumed = GamepadMapper.applyMotion(entry.state, event)
        if (consumed) {
            entry.lastSeen = System.currentTimeMillis()
            maybeEmitUi()
        }
        return consumed
    }

    private fun ensureDevice(device: InputDevice): DeviceEntry {
        val existing = devices[device.id]
        if (existing != null) return existing
        val entry = addDevice(device.id, device.name ?: "Controle ${device.id}", device.descriptor)
        assignToFreeSlot(device.id)
        return entry
    }

    private fun addDevice(deviceId: Int, name: String, descriptor: String): DeviceEntry {
        val existing = devices[deviceId]
        if (existing != null) return existing
        val entry = DeviceEntry(deviceId, name, descriptor)
        devices[deviceId] = entry
        DiagnosticsLog.add("bluetooth", "Controle conectado: $name (#$deviceId)")
        emitSnapshot()
        return entry
    }

    private fun removeDevice(deviceId: Int) {
        val entry = devices.remove(deviceId) ?: return
        players?.unassignDevice(deviceId)
        DiagnosticsLog.add("bluetooth", "Controle removido: ${entry.name} (#$deviceId)")
        emitSnapshot()
    }

    private fun assignToFreeSlot(deviceId: Int): Int? {
        val manager = players ?: return null
        val slot = manager.assignToFreeSlot(deviceId)
        if (slot != null) {
            DiagnosticsLog.add("players", "Controle #$deviceId associado ao P${slot + 1}")
            emitSnapshot()
        } else {
            DiagnosticsLog.add("players", "Sem slot livre para o controle #$deviceId")
        }
        return slot
    }

    fun assign(deviceId: Int, slot: Int): Boolean {
        val manager = players ?: return false
        val device = devices[deviceId] ?: run {
            val context = appContext ?: return false
            val found = ControllerDiscovery.find(context, deviceId) ?: return false
            addDevice(found.deviceId, found.name, found.descriptor)
        }
        if (!manager.assign(device.deviceId, slot)) return false
        DiagnosticsLog.add("players", "Controle ${device.name} -> P${slot + 1}")
        emitSnapshot()
        return true
    }

    fun unassign(slot: Int) {
        players?.clearSlot(slot)
        DiagnosticsLog.add("players", "P${slot + 1} liberado")
        emitSnapshot()
    }

    fun clearAssignments() {
        players?.clear()
        DiagnosticsLog.add("players", "Associações removidas")
        emitSnapshot()
    }

    fun assignments(): List<Int?> = players?.assignments() ?: List(SLOT_COUNT) { null }

    fun slotOf(deviceId: Int): Int? = players?.slotOf(deviceId)

    fun deviceCount(): Int = devices.size

    fun frameJson(): String {
        val root = JSONObject()
        val slots = JSONArray()
        val assigned = assignments()
        for (slot in 0 until SLOT_COUNT) {
            val deviceId = assigned[slot] ?: continue
            val entry = devices[deviceId] ?: continue
            val state = entry.state
            val frame = JSONObject()
            frame.put("slot", slot)
            frame.put("name", entry.name)
            frame.put("buttons", state.buttons)
            frame.put("leftTrigger", state.leftTrigger.toDouble())
            frame.put("rightTrigger", state.rightTrigger.toDouble())
            frame.put("leftStickX", state.leftStickX.toDouble())
            frame.put("leftStickY", state.leftStickY.toDouble())
            frame.put("rightStickX", state.rightStickX.toDouble())
            frame.put("rightStickY", state.rightStickY.toDouble())
            frame.put("connected", true)
            slots.put(frame)
        }
        root.put("slots", slots)
        root.put("ts", System.currentTimeMillis())
        return root.toString()
    }

    fun snapshotJson(): String {
        val root = JSONObject()
        val array = JSONArray()
        val assigned = assignments()
        for (entry in devices.values) {
            val state = entry.state
            val item = JSONObject()
            item.put("deviceId", entry.deviceId)
            item.put("name", entry.name)
            item.put("descriptor", entry.descriptor)
            item.put("slot", slotOf(entry.deviceId) ?: JSONObject.NULL)
            item.put("connected", true)
            item.put("lastSeen", entry.lastSeen)
            val stateJson = JSONObject()
            stateJson.put("buttons", state.buttons)
            stateJson.put("leftTrigger", state.leftTrigger.toDouble())
            stateJson.put("rightTrigger", state.rightTrigger.toDouble())
            stateJson.put("leftStickX", state.leftStickX.toDouble())
            stateJson.put("leftStickY", state.leftStickY.toDouble())
            stateJson.put("rightStickX", state.rightStickX.toDouble())
            stateJson.put("rightStickY", state.rightStickY.toDouble())
            item.put("state", stateJson)
            array.put(item)
        }
        root.put("devices", array)
        root.put("assignments", JSONArray(assigned.map { it ?: JSONObject.NULL }))
        root.put("count", devices.size)
        root.put("capture", running)
        return root.toString()
    }

    private val framePump = object : Runnable {
        override fun run() {
            if (!running) return
            val target = sink?.get()
            if (target != null && devices.isNotEmpty()) {
                target.sendFrame(frameJson())
            }
            frameCounter++
            if (frameCounter % UI_EMIT_EVERY_FRAMES == 0L) emitSnapshot()
            handler.postDelayed(this, FRAME_INTERVAL_MS)
        }
    }

    private var lastEmit = 0L
    private fun maybeEmitUi() {
        val now = System.currentTimeMillis()
        if (now - lastEmit >= 100) {
            lastEmit = now
            emitSnapshot()
        }
    }

    private fun emitSnapshot() {
        if (listeners.isEmpty()) return
        val json = snapshotJson()
        listeners.forEach { listener ->
            try {
                listener(json)
            } catch (_: Exception) {
                // A listener must never break input capture.
            }
        }
    }

    private fun registerDeviceListener() {
        if (listenerRegistered) return
        try {
            inputManager?.registerInputDeviceListener(deviceListener, handler)
            listenerRegistered = true
        } catch (error: Exception) {
            DiagnosticsLog.add("bluetooth", "Falha ao registrar listener: ${error.message}")
        }
    }

    private fun unregisterDeviceListener() {
        if (!listenerRegistered) return
        try {
            inputManager?.unregisterInputDeviceListener(deviceListener)
        } catch (_: Exception) {
            // ignore
        }
        listenerRegistered = false
    }

    private val deviceListener = object : InputManager.InputDeviceListener {
        override fun onInputDeviceAdded(deviceId: Int) {
            val device = inputManager?.getInputDevice(deviceId) ?: return
            if (GamepadMapper.isGamepadDevice(device)) {
                addDevice(device.id, device.name ?: "Controle ${device.id}", device.descriptor)
            }
        }

        override fun onInputDeviceRemoved(deviceId: Int) {
            removeDevice(deviceId)
        }

        override fun onInputDeviceChanged(deviceId: Int) {
            val device = inputManager?.getInputDevice(deviceId) ?: return
            if (GamepadMapper.isGamepadDevice(device)) {
                addDevice(device.id, device.name ?: "Controle ${device.id}", device.descriptor)
            }
        }
    }
}
