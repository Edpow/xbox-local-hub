import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  AppState,
  Linking,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {Badge} from './components/Card'
import {
  XboxLocalHubController,
  isNativeAvailable,
  type NativeSnapshot,
  type RelayConfigInfo,
} from './native/XboxLocalHubController'
import {DiagnosticsScreen} from './screens/DiagnosticsScreen'
import {PlayersScreen} from './screens/PlayersScreen'
import {StatusScreen} from './screens/StatusScreen'
import {TransportScreen} from './screens/TransportScreen'
import {colors, spacing} from './theme/theme'

type Tab = 'status' | 'players' | 'transport' | 'diagnostics'
type Health = 'idle' | 'checking' | 'ok' | 'error'

const TABS: Array<{key: Tab; label: string; short: string}> = [
  {key: 'status', label: 'Status', short: 'ST'},
  {key: 'players', label: 'Controles', short: 'P1'},
  {key: 'transport', label: 'Transporte', short: 'TX'},
  {key: 'diagnostics', label: 'Diagnóstico', short: 'DG'},
]

export default function App() {
  const [tab, setTab] = useState<Tab>('status')
  const [snapshot, setSnapshot] = useState<NativeSnapshot | null>(null)
  const [relay, setRelay] = useState<RelayConfigInfo | null>(null)
  const [health, setHealth] = useState<Health>('idle')
  const [healthError, setHealthError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [transportStamp, setTransportStamp] = useState(Date.now())
  const relayRef = useRef<RelayConfigInfo | null>(null)

  const refreshSnapshot = useCallback(async () => {
    const next = await XboxLocalHubController.getSnapshot()
    if (next) setSnapshot(next)
  }, [])

  const refreshLogs = useCallback(async () => {
    const next = await XboxLocalHubController.getLogs()
    setLogs(next)
  }, [])

  const checkRelay = useCallback(async (config: RelayConfigInfo | null) => {
    const target = config ?? relayRef.current
    if (!target) return
    setHealth('checking')
    setHealthError(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const headers: Record<string, string> = {}
      if (target.token) headers.Authorization = `Bearer ${target.token}`
      const response = await fetch(`${target.url.replace(/\/+$/, '')}/api/health`, {
        headers,
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as {ok?: boolean; mode?: string}
      setHealth(data.ok ? 'ok' : 'error')
      setHealthError(data.ok ? null : 'Resposta inesperada do relay')
    } catch (error) {
      setHealth('error')
      setHealthError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Tempo esgotado ao falar com o relay'
          : `Relay inacessível: ${String(error)}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const unsubscribe = XboxLocalHubController.subscribe(next => {
      if (mounted) setSnapshot(next)
    })
    void (async () => {
      await refreshSnapshot()
      const config = await XboxLocalHubController.getRelayConfig()
      if (!mounted) return
      if (config) {
        setRelay(config)
        relayRef.current = config
        void checkRelay(config)
      }
      await refreshLogs()
    })()

    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void refreshSnapshot()
        void refreshLogs()
      }
    })

    return () => {
      mounted = false
      unsubscribe()
      appState.remove()
    }
  }, [checkRelay, refreshLogs, refreshSnapshot])

  useEffect(() => {
    if (tab !== 'diagnostics') return
    const interval = setInterval(() => {
      void refreshLogs()
    }, 1500)
    void refreshLogs()
    return () => clearInterval(interval)
  }, [tab, refreshLogs])

  const saveRelay = useCallback(
    async (url: string, token: string) => {
      const saved = await XboxLocalHubController.setRelayConfig(url, token)
      if (!saved) {
        setHealth('error')
        setHealthError('Módulo nativo indisponível; não foi possível salvar.')
        return
      }
      setRelay(saved)
      relayRef.current = saved
      await checkRelay(saved)
      void refreshLogs()
    },
    [checkRelay, refreshLogs],
  )

  const assign = useCallback(
    async (deviceId: number, slot: number) => {
      await XboxLocalHubController.assign(deviceId, slot)
      await refreshSnapshot()
    },
    [refreshSnapshot],
  )

  const unassign = useCallback(
    async (slot: number) => {
      await XboxLocalHubController.unassign(slot)
      await refreshSnapshot()
    },
    [refreshSnapshot],
  )

  const clearAssignments = useCallback(async () => {
    await XboxLocalHubController.clearAssignments()
    await refreshSnapshot()
  }, [refreshSnapshot])

  const transportUrl = useMemo(() => {
    if (!relay) return ''
    const separator = relay.dashboardUrl.includes('?') ? '&' : '?'
    return `${relay.dashboardUrl}${separator}native=1&_ts=${transportStamp}`
  }, [relay, transportStamp])

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {tab !== 'transport' ? (
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Text style={styles.mark}>XLH</Text>
            <View>
              <Text style={styles.title}>Xbox Local Hub</Text>
              <Text style={styles.subtitle}>central de controles · fase 1</Text>
            </View>
          </View>
          <Badge
            text={isNativeAvailable() ? (snapshot?.capture ? 'captura on' : 'captura off') : 'sem nativo'}
            tone={isNativeAvailable() ? (snapshot?.capture ? 'ok' : 'warn') : 'err'}
          />
        </View>
      ) : null}

      <View style={styles.content}>
        {tab === 'status' ? (
          <StatusScreen
            snapshot={snapshot}
            relay={relay}
            health={health}
            healthError={healthError}
            nativeAvailable={isNativeAvailable()}
            onSave={saveRelay}
            onCheck={() => void checkRelay(null)}
            onOpenTransport={() => setTab('transport')}
            onOpenBrowser={() => {
              if (relay) void Linking.openURL(relay.dashboardUrl)
            }}
          />
        ) : null}

        {tab === 'players' ? (
          <PlayersScreen
            snapshot={snapshot}
            onAssign={(deviceId, slot) => void assign(deviceId, slot)}
            onUnassign={slot => void unassign(slot)}
            onClear={() => void clearAssignments()}
          />
        ) : null}

        {tab === 'transport' ? (
          <TransportScreen
            url={transportUrl}
            onBack={() => setTab('status')}
            onReload={() => setTransportStamp(Date.now())}
          />
        ) : null}

        {tab === 'diagnostics' ? (
          <DiagnosticsScreen
            logs={logs}
            snapshot={snapshot}
            onRefresh={() => void refreshLogs()}
            onClear={() => void XboxLocalHubController.clearLogs().then(refreshLogs)}
          />
        ) : null}
      </View>

      <View style={styles.tabs}>
        {TABS.map(item => {
          const active = tab === item.key
          return (
            <Pressable
              key={item.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(item.key)}>
              <Text style={[styles.tabShort, active && styles.tabShortActive]}>{item.short}</Text>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mark: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
    backgroundColor: colors.red,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.faint,
    fontSize: 9.5,
    marginTop: 1,
  },
  content: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    backgroundColor: colors.bgSoft,
    paddingBottom: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderTopColor: 'transparent',
    borderTopWidth: 2,
  },
  tabActive: {
    borderTopColor: colors.red,
  },
  tabShort: {
    color: colors.faint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tabShortActive: {
    color: colors.red,
  },
  tabLabel: {
    color: colors.faint,
    fontSize: 10,
    marginTop: 1,
  },
  tabLabelActive: {
    color: colors.text,
  },
})
