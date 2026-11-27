package com.xboxlocalhub.xbox

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.xboxlocalhub.diagnostics.DiagnosticsLog
import com.xboxlocalhub.input.ControllerHub

/**
 * WebView that hosts the dashboard and receives the native controller frames
 * without crossing the React Native bridge.
 *
 * The dashboard must be served over http(s); file/content access is disabled.
 */
@SuppressLint("SetJavaScriptEnabled")
class XboxLocalHubTransportView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : WebView(context, attrs) {

    private var currentUrl: String? = null

    private val frameSink = object : ControllerHub.FrameSink {
        override fun sendFrame(json: String) {
            val safe = json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
            post {
                evaluateJavascript(
                    "(function(){try{window.XLH&&window.XLH.setNativeFrame($safe)}catch(e){}})()",
                    null,
                )
            }
        }
    }

    init {
        setBackgroundColor(Color.parseColor("#08090B"))
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        webViewClient = WebViewClient()
        webChromeClient = WebChromeClient()
    }

    fun setUrl(url: String) {
        if (url == currentUrl) return
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            DiagnosticsLog.add("webview", "URL recusada (apenas http/https): $url")
            return
        }
        currentUrl = url
        DiagnosticsLog.add("webview", "Carregando dashboard: $url")
        loadUrl(url)
    }

    fun reloadDashboard() {
        reload()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        ControllerHub.attachSink(frameSink)
    }

    override fun onDetachedFromWindow() {
        ControllerHub.detachSink(frameSink)
        super.onDetachedFromWindow()
    }

    fun destroyView() {
        ControllerHub.detachSink(frameSink)
        stopLoading()
        loadUrl("about:blank")
        destroy()
    }
}
