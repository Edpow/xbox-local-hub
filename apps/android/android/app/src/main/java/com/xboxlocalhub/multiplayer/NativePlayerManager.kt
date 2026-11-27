package com.xboxlocalhub.multiplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * P1..P4 assignment persisted in SharedPreferences. Mirrors the relay's
 * PlayerManager rules: one device per slot and one slot per device.
 */
class NativePlayerManager(context: Context) {
    private val prefs = context.getSharedPreferences("xlh.players", Context.MODE_PRIVATE)
    private val slots = arrayOfNulls<Int>(SLOT_COUNT)

    init {
        load()
    }

    fun assignments(): List<Int?> = slots.toList()

    fun slotOf(deviceId: Int): Int? = slots.indexOfFirst { it == deviceId }.takeIf { it >= 0 }

    fun assign(deviceId: Int, slot: Int): Boolean {
        if (slot !in 0 until SLOT_COUNT) return false
        for (index in slots.indices) {
            if (slots[index] == deviceId) slots[index] = null
        }
        slots[slot] = deviceId
        persist()
        return true
    }

    fun assignToFreeSlot(deviceId: Int): Int? {
        slotOf(deviceId)?.let { return it }
        val free = slots.indexOfFirst { it == null }
        if (free < 0) return null
        slots[free] = deviceId
        persist()
        return free
    }

    fun clearSlot(slot: Int) {
        if (slot !in 0 until SLOT_COUNT) return
        slots[slot] = null
        persist()
    }

    fun unassignDevice(deviceId: Int) {
        var changed = false
        for (index in slots.indices) {
            if (slots[index] == deviceId) {
                slots[index] = null
                changed = true
            }
        }
        if (changed) persist()
    }

    fun clear() {
        slots.fill(null)
        persist()
    }

    private fun load() {
        val raw = prefs.getString(KEY, null) ?: return
        try {
            val array = JSONArray(raw)
            for (index in 0 until minOf(SLOT_COUNT, array.length())) {
                if (array.isNull(index)) continue
                slots[index] = array.optInt(index, -1).takeIf { it >= 0 }
            }
        } catch (_: Exception) {
            slots.fill(null)
        }
    }

    private fun persist() {
        val array = JSONArray()
        slots.forEach { if (it == null) array.put(JSONObject.NULL) else array.put(it) }
        prefs.edit().putString(KEY, array.toString()).apply()
    }

    private companion object {
        const val SLOT_COUNT = 4
        const val KEY = "slots"
    }
}
