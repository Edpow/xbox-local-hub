import React from 'react'
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native'
import {PlayerCard} from '../components/PlayerCard'
import {Card} from '../components/Card'
import type {NativeSnapshot} from '../native/XboxLocalHubController'
import {colors, spacing} from '../theme/theme'

interface PlayersScreenProps {
  snapshot: NativeSnapshot | null
  onAssign: (deviceId: number, slot: number) => void
  onUnassign: (slot: number) => void
  onClear: () => void
}

export function PlayersScreen({snapshot, onAssign, onUnassign, onClear}: PlayersScreenProps) {
  const devices = snapshot?.devices ?? []
  const assignments = snapshot?.assignments ?? [null, null, null, null]

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card title="Jogadores P1–P4" subtitle="controles Bluetooth">
        <Text style={styles.hint}>
          Cada controle só pode ocupar um slot. O primeiro evento de um controle novo o associa a um slot livre.
          Use os chips para remapear manualmente.
        </Text>
        <View style={styles.row}>
          <Pressable style={styles.ghostButton} onPress={onClear}>
            <Text style={styles.ghostText}>Limpar associações</Text>
          </Pressable>
          <Text style={styles.count}>{devices.length} controle(s)</Text>
        </View>
        {devices.length === 0 ? (
          <Text style={styles.empty}>
            Nenhum controle visível. Pareie o controle nas configurações de Bluetooth do Android e pressione um
            botão; ele deve aparecer aqui.
          </Text>
        ) : null}
      </Card>

      {[0, 1, 2, 3].map(slot => (
        <PlayerCard
          key={slot}
          slot={slot}
          assignment={assignments[slot] ?? null}
          devices={devices}
          onAssign={deviceId => {
            if (deviceId == null) onUnassign(slot)
            else onAssign(deviceId, slot)
          }}
        />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
  },
  hint: {
    color: colors.muted,
    fontSize: 11.5,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  ghostButton: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  ghostText: {
    color: colors.text,
    fontSize: 12,
  },
  count: {
    color: colors.faint,
    fontSize: 11,
  },
  empty: {
    color: colors.amber,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: spacing.md,
  },
})
