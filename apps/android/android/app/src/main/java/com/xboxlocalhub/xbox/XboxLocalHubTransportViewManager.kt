package com.xboxlocalhub.xbox

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

@ReactModule(name = XboxLocalHubTransportViewManager.NAME)
class XboxLocalHubTransportViewManager : SimpleViewManager<XboxLocalHubTransportView>() {
    override fun getName(): String = NAME

    override fun createViewInstance(reactContext: ThemedReactContext): XboxLocalHubTransportView =
        XboxLocalHubTransportView(reactContext)

    @ReactProp(name = "url")
    fun setUrl(view: XboxLocalHubTransportView, url: String?) {
        if (!url.isNullOrBlank()) view.setUrl(url)
    }

    override fun onDropViewInstance(view: XboxLocalHubTransportView) {
        view.destroyView()
        super.onDropViewInstance(view)
    }

    companion object {
        const val NAME = "XboxLocalHubTransportView"
    }
}
