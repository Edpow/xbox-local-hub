import React from 'react'
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native'
import {Card} from '../components/Card'
import type {NativeSnapshot} from '../native/XboxLocalHubController'
import {colors, spacing} from '../theme/theme'

interface DiagnosticsScreenProps {
  logs: string[]
  snapshot: NativeSnapshot | null
  onRefresh: () => void
  onClear: () => void
}

export function DiagnosticsScreen({logs, snapshot, onRefresh, onClear}: DiagnosticsScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card title="Diagnóstico nativo" subtitle="InputDevice + frame pump">
        <View style={styles.row}>
          <Pressable style={styles.ghostButton} onPress={onRefresh}>
            <Text style={styles.ghostText}>Atualizar</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={onClear}>
            <Text style={styles.ghostText}>Limpar</Text>
          </Pressable>
          <Text style={styles.count}>{logs.length} evento(s)</Text>
        </View>
        <View style={styles.logBox}>
          {logs.length === 0 ? (
            <Text style={styles.empty}>Nenhum evento ainda.</Text>
          ) : (
            logs.map((line, index) => (
              <Text key={`${index}-${line.slice(0, 12)}`} style={styles.logLine}>
                {line}
              </Text>
            ))
          )}
        </View>
      </Card>

      <Card title="Snapshot" subtitle="estado bruto para suporte">
        <Text style={styles.code}>{JSON.stringify(snapshot, null, 2)}</Text>
      </Card>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  ghostButton: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  ghostText: {
    color: colors.text,
    fontSize: 12,
  },
  count: {
    color: colors.faint,
    fontSize: 10.5,
    marginLeft: 'auto',
  },
  logBox: {
    backgroundColor: '#070809',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    maxHeight: 320,
  },
  logLine: {
    color: '#aab4c2',
    fontSize: 9.5,
    lineHeight: 14,
    fontFamily: 'monospace',
  },
  empty: {
    color: colors.faint,
    fontSize: 11,
  },
  code: {
    color: colors.muted,
    fontSize: 9.5,
    lineHeight: 14,
    fontFamily: 'monospace',
  },
})
