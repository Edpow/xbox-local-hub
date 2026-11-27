package com.xboxlocalhub

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.xboxlocalhub.diagnostics.DiagnosticsLog
import com.xboxlocalhub.input.ControllerHub

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "XboxLocalHub"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ControllerHub.init(applicationContext)
        ControllerHub.start(applicationContext)
        requestBluetoothPermission()
        DiagnosticsLog.add("app", "MainActivity criada")
    }

    /**
     * Gamepad keys must be captured by the activity before the focused view
     * (including the WebView) consumes them as navigation/scroll.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (ControllerHub.handleKeyEvent(event)) return true
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (ControllerHub.handleMotionEvent(event)) return true
        return super.dispatchGenericMotionEvent(event)
    }

    override fun onResume() {
        super.onResume()
        ControllerHub.start(applicationContext)
    }

    override fun onPause() {
        ControllerHub.pause()
        super.onPause()
    }

    override fun onDestroy() {
        ControllerHub.shutdown()
        super.onDestroy()
    }

    private fun requestBluetoothPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), REQUEST_BLUETOOTH_CONNECT)
    }

    companion object {
        private const val REQUEST_BLUETOOTH_CONNECT = 42
    }
}
