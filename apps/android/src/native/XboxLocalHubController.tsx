import React from 'react'
import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  View,
  requireNativeComponent,
  type ViewStyle,
} from 'react-native'

export interface NativeControllerState {
  buttons: number
  leftTrigger: number
  rightTrigger: number
  leftStickX: number
  leftStickY: number
  rightStickX: number
  rightStickY: number
}

export interface NativeDevice {
  deviceId: number
  name: string
  descriptor: string
  slot: number | null
  connected: boolean
  lastSeen: number
  state: NativeControllerState
}

export interface NativeSnapshot {
  devices: NativeDevice[]
  assignments: Array<number | null>
  count: number
  capture: boolean
}

export interface RelayConfigInfo {
  url: string
  token: string
  dashboardUrl: string
}

interface XboxLocalHubControllerNative {
  getSnapshot(): Promise<string>
  assign(deviceId: number, slot: number): Promise<boolean>
  unassign(slot: number): Promise<boolean>
  clearAssignments(): Promise<boolean>
  getRelayConfig(): Promise<RelayConfigInfo>
  setRelayConfig(url: string, token: string): Promise<RelayConfigInfo>
  getLogs(): Promise<string>
  clearLogs(): Promise<boolean>
  addListener(eventName: string): void
  removeListeners(count: number): void
}

const nativeModule = NativeModules.XboxLocalHubController as XboxLocalHubControllerNative | undefined

export function isNativeAvailable(): boolean {
  return Platform.OS === 'android' && nativeModule != null
}

export const XboxLocalHubController = {
  getSnapshot: async (): Promise<NativeSnapshot | null> => {
    if (!nativeModule) return null
    const json = await nativeModule.getSnapshot()
    return JSON.parse(json) as NativeSnapshot
  },
  assign: async (deviceId: number, slot: number): Promise<void> => {
    if (!nativeModule) return
    await nativeModule.assign(deviceId, slot)
  },
  unassign: async (slot: number): Promise<void> => {
    if (!nativeModule) return
    await nativeModule.unassign(slot)
  },
  clearAssignments: async (): Promise<void> => {
    if (!nativeModule) return
    await nativeModule.clearAssignments()
  },
  getRelayConfig: async (): Promise<RelayConfigInfo | null> => {
    if (!nativeModule) return null
    return nativeModule.getRelayConfig()
  },
  setRelayConfig: async (url: string, token: string): Promise<RelayConfigInfo | null> => {
    if (!nativeModule) return null
    return nativeModule.setRelayConfig(url, token)
  },
  getLogs: async (): Promise<string[]> => {
    if (!nativeModule) return []
    const json = await nativeModule.getLogs()
    try {
      return JSON.parse(json) as string[]
    } catch {
      return []
    }
  },
  clearLogs: async (): Promise<void> => {
    if (!nativeModule) return
    await nativeModule.clearLogs()
  },
  subscribe: (listener: (snapshot: NativeSnapshot) => void): (() => void) => {
    if (!nativeModule) return () => undefined
    const emitter = new NativeEventEmitter(nativeModule as never)
    const subscription = emitter.addListener('XboxLocalHubSnapshot', (json: string) => {
      try {
        listener(JSON.parse(json) as NativeSnapshot)
      } catch {
        // ignore malformed snapshots
      }
    })
    return () => subscription.remove()
  },
}

interface TransportProps {
  url: string
  style?: ViewStyle
}

export const XboxLocalHubTransportView: React.ComponentType<TransportProps> =
  Platform.OS === 'android' && nativeModule
    ? requireNativeComponent<TransportProps>('XboxLocalHubTransportView')
    : ({style}: TransportProps) => <View style={style} />
