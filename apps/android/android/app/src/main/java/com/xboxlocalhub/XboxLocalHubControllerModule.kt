package com.xboxlocalhub

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.xboxlocalhub.diagnostics.DiagnosticsLog
import com.xboxlocalhub.input.ControllerHub
import com.xboxlocalhub.network.RelayConfig

/**
 * React Native surface for the native engine. The high-frequency input path
 * never crosses this bridge; it goes directly to XboxLocalHubTransportView.
 */
@ReactModule(name = XboxLocalHubControllerModule.NAME)
class XboxLocalHubControllerModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val snapshotListener: (String) -> Unit = { json -> emitSnapshot(json) }

    init {
        ControllerHub.init(reactContext.applicationContext)
        ControllerHub.addListener(snapshotListener)
    }

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        ControllerHub.start(reactContext)
    }

    override fun invalidate() {
        ControllerHub.removeListener(snapshotListener)
        super.invalidate()
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by NativeEventEmitter; the hub already pushes snapshots.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    fun getSnapshot(promise: Promise) {
        mainHandler.post {
            try {
                promise.resolve(ControllerHub.snapshotJson())
            } catch (error: Exception) {
                promise.reject("snapshot_failed", error.message)
            }
        }
    }

    @ReactMethod
    fun assign(deviceId: Double, slot: Double, promise: Promise) {
        mainHandler.post {
            val ok = ControllerHub.assign(deviceId.toInt(), slot.toInt())
            if (ok) promise.resolve(true)
            else promise.reject("assign_failed", "Não foi possível associar o controle ao slot")
        }
    }

    @ReactMethod
    fun unassign(slot: Double, promise: Promise) {
        mainHandler.post {
            ControllerHub.unassign(slot.toInt())
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun clearAssignments(promise: Promise) {
        mainHandler.post {
            ControllerHub.clearAssignments()
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun getRelayConfig(promise: Promise) {
        try {
            val config = RelayConfig.load(reactContext)
            val map = Arguments.createMap().apply {
                putString("url", config.url)
                putString("token", config.token)
                putString("dashboardUrl", RelayConfig.dashboardUrl(config))
            }
            promise.resolve(map)
        } catch (error: Exception) {
            promise.reject("relay_config_failed", error.message)
        }
    }

    @ReactMethod
    fun setRelayConfig(url: String, token: String, promise: Promise) {
        try {
            val config = RelayConfig.save(reactContext, url, token)
            DiagnosticsLog.add("relay", "Relay configurado: ${config.url}")
            val map = Arguments.createMap().apply {
                putString("url", config.url)
                putString("token", config.token)
                putString("dashboardUrl", RelayConfig.dashboardUrl(config))
            }
            promise.resolve(map)
        } catch (error: Exception) {
            promise.reject("relay_config_failed", error.message)
        }
    }

    @ReactMethod
    fun getLogs(promise: Promise) {
        try {
            promise.resolve(DiagnosticsLog.toJson())
        } catch (error: Exception) {
            promise.reject("logs_failed", error.message)
        }
    }

    @ReactMethod
    fun clearLogs(promise: Promise) {
        DiagnosticsLog.clear()
        promise.resolve(true)
    }

    private fun emitSnapshot(json: String) {
        try {
            if (!reactContext.hasActiveReactInstance()) return
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_SNAPSHOT, json)
        } catch (_: Exception) {
            // JS may be reloading; never break capture.
        }
    }

    companion object {
        const val NAME = "XboxLocalHubController"
        const val EVENT_SNAPSHOT = "XboxLocalHubSnapshot"
    }
}
