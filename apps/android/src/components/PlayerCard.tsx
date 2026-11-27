import React from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {BUTTON_CHIPS} from '../native/buttons'
import type {NativeControllerState, NativeDevice} from '../native/XboxLocalHubController'
import {colors, spacing} from '../theme/theme'

interface PlayerCardProps {
  slot: number
  assignment: number | null
  devices: NativeDevice[]
  onAssign: (deviceId: number | null) => void
}

export function PlayerCard({slot, assignment, devices, onAssign}: PlayerCardProps) {
  const device = devices.find(item => item.deviceId === assignment)
  const state: NativeControllerState = device?.state ?? {
    buttons: 0,
    leftTrigger: 0,
    rightTrigger: 0,
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
  }

  return (
    <View style={[styles.card, !device && styles.cardEmpty]}>
      <View style={styles.head}>
        <Text style={styles.badge}>P{slot + 1}</Text>
        <Text style={styles.deviceName} numberOfLines={1}>
          {device ? device.name : 'sem controle'}
        </Text>
      </View>

      <View style={styles.chips}>
        <Pressable
          onPress={() => onAssign(null)}
          style={[styles.chip, !device && styles.chipSelected]}>
          <Text style={[styles.chipText, !device && styles.chipTextSelected]}>livre</Text>
        </Pressable>
        {devices.map(item => (
          <Pressable
            key={item.deviceId}
            onPress={() => onAssign(item.deviceId)}
            style={[styles.chip, assignment === item.deviceId && styles.chipSelected]}>
            <Text
              style={[styles.chipText, assignment === item.deviceId && styles.chipTextSelected]}
              numberOfLines={1}>
              #{item.deviceId} {item.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.buttons}>
        {BUTTON_CHIPS.map(([label, bit]) => {
          const on = (state.buttons & bit) !== 0
          return (
            <View key={label} style={[styles.buttonChip, on && styles.buttonChipOn]}>
              <Text style={[styles.buttonText, on && styles.buttonTextOn]}>{label}</Text>
            </View>
          )
        })}
      </View>

      <Axis label="LX" value={state.leftStickX} />
      <Axis label="LY" value={state.leftStickY} />
      <Axis label="RX" value={state.rightStickX} />
      <Axis label="RY" value={state.rightStickY} />
      <Axis label="LT" value={state.leftTrigger} bipolar={false} />
      <Axis label="RT" value={state.rightTrigger} bipolar={false} />

      <Text style={styles.meta}>
        {device ? `#${device.deviceId} · botões 0x${state.buttons.toString(16).toUpperCase()}` : 'aguardando evento'}
      </Text>
    </View>
  )
}

function Axis({label, value, bipolar = true}: {label: string; value: number; bipolar?: boolean}) {
  const clamped = Math.max(-1, Math.min(1, value))
  const width = bipolar ? Math.abs(clamped) * 50 : Math.abs(clamped) * 100
  return (
    <View style={styles.axisRow}>
      <Text style={styles.axisLabel}>{label}</Text>
      <View style={styles.axisTrack}>
        <View
          style={[
            styles.axisFill,
            {
              width: `${width}%`,
              marginLeft: bipolar && clamped >= 0 ? '50%' : undefined,
              opacity: bipolar && clamped < 0 ? 0.6 : 1,
            },
          ]}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card2,
    borderColor: 'rgba(255,59,59,0.35)',
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardEmpty: {
    borderColor: colors.line,
    borderStyle: 'dashed',
    opacity: 0.8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  badge: {
    color: colors.red,
    borderColor: 'rgba(255,59,59,0.4)',
    borderWidth: 1,
    backgroundColor: 'rgba(255,59,59,0.08)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '700',
  },
  deviceName: {
    color: colors.muted,
    fontSize: 11.5,
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  chip: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipSelected: {
    borderColor: colors.red,
    backgroundColor: 'rgba(255,59,59,0.1)',
  },
  chipText: {
    color: colors.faint,
    fontSize: 10,
  },
  chipTextSelected: {
    color: colors.text,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: spacing.sm,
  },
  buttonChip: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  buttonChipOn: {
    backgroundColor: colors.red,
    borderColor: colors.red,
  },
  buttonText: {
    color: colors.faint,
    fontSize: 9.5,
    fontWeight: '600',
  },
  buttonTextOn: {
    color: '#fff',
  },
  axisRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  axisLabel: {
    color: colors.faint,
    fontSize: 9.5,
    width: 22,
  },
  axisTrack: {
    flex: 1,
    height: 5,
    backgroundColor: '#0a0c0f',
    borderRadius: 99,
    borderColor: colors.line,
    borderWidth: 1,
    overflow: 'hidden',
  },
  axisFill: {
    height: '100%',
    backgroundColor: colors.red,
  },
  meta: {
    color: colors.faint,
    fontSize: 9.5,
    marginTop: spacing.sm,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingTop: 6,
  },
})
