import React from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {XboxLocalHubTransportView, isNativeAvailable} from '../native/XboxLocalHubController'
import {colors, spacing} from '../theme/theme'

interface TransportScreenProps {
  url: string
  onBack: () => void
  onReload: () => void
}

export function TransportScreen({url, onBack, onReload}: TransportScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={onBack}>
          <Text style={styles.headerText}>Voltar</Text>
        </Pressable>
        <Text style={styles.title}>Transporte</Text>
        <Pressable style={styles.headerButton} onPress={onReload}>
          <Text style={styles.headerText}>Recarregar</Text>
        </Pressable>
      </View>
      {isNativeAvailable() && url ? (
        <XboxLocalHubTransportView url={url} style={styles.webview} />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Transporte indisponível</Text>
          <Text style={styles.emptyText}>
            Configure e salve a URL do relay na aba Status. O WebView precisa do módulo nativo Android.
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    backgroundColor: colors.bgSoft,
  },
  headerButton: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 7,
  },
  headerText: {
    color: colors.text,
    fontSize: 12,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
})
