import React, {useEffect, useState} from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {Badge, Card} from '../components/Card'
import type {NativeSnapshot, RelayConfigInfo} from '../native/XboxLocalHubController'
import {colors, spacing} from '../theme/theme'

interface StatusScreenProps {
  snapshot: NativeSnapshot | null
  relay: RelayConfigInfo | null
  health: 'idle' | 'checking' | 'ok' | 'error'
  healthError: string | null
  nativeAvailable: boolean
  onSave: (url: string, token: string) => Promise<void>
  onCheck: () => void
  onOpenTransport: () => void
  onOpenBrowser: () => void
}

export function StatusScreen({
  snapshot,
  relay,
  health,
  healthError,
  nativeAvailable,
  onSave,
  onCheck,
  onOpenTransport,
  onOpenBrowser,
}: StatusScreenProps) {
  const [url, setUrl] = useState(relay?.url ?? 'http://192.168.0.10:8787')
  const [token, setToken] = useState(relay?.token ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!relay) return
    setUrl(relay.url)
    setToken(relay.token)
  }, [relay])

  const save = async () => {
    setSaving(true)
    try {
      await onSave(url, token)
    } finally {
      setSaving(false)
    }
  }

  const assigned = snapshot?.assignments ?? [null, null, null, null]
  const healthTone = health === 'ok' ? 'ok' : health === 'error' ? 'err' : health === 'checking' ? 'warn' : 'neutral'
  const healthText =
    health === 'ok' ? 'relay ok' : health === 'error' ? 'relay offline' : health === 'checking' ? 'verificando' : 'não verificado'

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title="Relay na rede" subtitle="auth + sessão xHome">
        <Text style={styles.label}>URL do relay</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.0.10:8787"
          placeholderTextColor={colors.faint}
          style={styles.input}
        />
        <Text style={styles.label}>Token de acesso (opcional em localhost)</Text>
        <TextInput
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="token gerado por --host=0.0.0.0"
          placeholderTextColor={colors.faint}
          style={styles.input}
        />
        <View style={styles.row}>
          <Pressable style={styles.primaryButton} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Salvar</Text>}
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={onCheck}>
            <Text style={styles.ghostText}>Testar conexão</Text>
          </Pressable>
          <Badge text={healthText} tone={healthTone} />
        </View>
        {healthError ? <Text style={styles.error}>{healthError}</Text> : null}
      </Card>

      <Card title="Estado da captura" subtitle="InputDevice nativo">
        <View style={styles.metrics}>
          <Metric label="Controles" value={String(snapshot?.count ?? 0)} />
          <Metric label="P1" value={assigned[0] != null ? `#${assigned[0]}` : '—'} />
          <Metric label="P2" value={assigned[1] != null ? `#${assigned[1]}` : '—'} />
          <Metric label="P3" value={assigned[2] != null ? `#${assigned[2]}` : '—'} />
          <Metric label="P4" value={assigned[3] != null ? `#${assigned[3]}` : '—'} />
          <Metric label="Frame pump" value={snapshot?.capture ? 'ativo' : 'parado'} />
        </View>
        {!nativeAvailable ? (
          <Text style={styles.warn}>
            Módulo nativo indisponível. Rode o app em um dispositivo Android com o build nativo.
          </Text>
        ) : null}
        <View style={styles.row}>
          <Pressable style={styles.primaryButton} onPress={onOpenTransport}>
            <Text style={styles.primaryText}>Abrir transporte</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={onOpenBrowser}>
            <Text style={styles.ghostText}>Abrir no navegador</Text>
          </Pressable>
        </View>
      </Card>

      <Card title="Como validar" subtitle="roteiro rápido">
        <Step n="1" text="Habilite o Remote Play no Xbox e mantenha o console na mesma rede Wi-Fi." />
        <Step n="2" text="No transporte, entre com a conta Microsoft e procure o console." />
        <Step n="3" text="Conecte e confirme sessão Provisioned + handshake ok." />
        <Step n="4" text="Pareie os controles Bluetooth no Android; o app associa P1–P4 automaticamente." />
        <Step n="5" text="Use o pulso de teste para validar o protocolo antes de culpar o controle." />
        <Text style={styles.note}>
          O diagnóstico distingue “software validado” (mock) de “console real”. Não trate o modo mock como prova de
          compatibilidade.
        </Text>
      </Card>
    </ScrollView>
  )
}

function Metric({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  )
}

function Step({n, text}: {n: string; text: string}) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepNumber}>{n}</Text>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
  },
  label: {
    color: colors.faint,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.red,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  ghostButton: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  ghostText: {
    color: colors.text,
    fontSize: 13,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metric: {
    minWidth: '30%',
    flexGrow: 1,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    backgroundColor: colors.bgSoft,
  },
  metricLabel: {
    color: colors.faint,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  warn: {
    color: colors.amber,
    fontSize: 11.5,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  error: {
    color: colors.red,
    fontSize: 11.5,
    marginTop: spacing.sm,
  },
  step: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
  },
  stepNumber: {
    color: colors.red,
    borderColor: 'rgba(255,59,59,0.35)',
    borderWidth: 1,
    borderRadius: 6,
    width: 20,
    height: 20,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
  },
  stepText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  note: {
    color: colors.faint,
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
})
