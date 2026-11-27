import React, {type ReactNode} from 'react'
import {StyleSheet, Text, View, type ViewStyle} from 'react-native'
import {colors, spacing} from '../theme/theme'

interface CardProps {
  title?: string
  subtitle?: string
  children: ReactNode
  style?: ViewStyle
}

export function Card({title, subtitle, children, style}: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  )
}

export function Badge({
  text,
  tone = 'neutral',
}: {
  text: string
  tone?: 'neutral' | 'ok' | 'warn' | 'err'
}) {
  const toneStyle =
    tone === 'ok'
      ? styles.badgeOk
      : tone === 'warn'
        ? styles.badgeWarn
        : tone === 'err'
          ? styles.badgeErr
          : undefined
  const toneText =
    tone === 'ok'
      ? styles.badgeTextOk
      : tone === 'warn'
        ? styles.badgeTextWarn
        : tone === 'err'
          ? styles.badgeTextErr
          : undefined
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={[styles.badgeText, toneText]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  head: {
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.faint,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  badge: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeOk: {
    borderColor: 'rgba(53,208,127,0.4)',
    backgroundColor: 'rgba(53,208,127,0.08)',
  },
  badgeWarn: {
    borderColor: 'rgba(255,176,32,0.4)',
    backgroundColor: 'rgba(255,176,32,0.08)',
  },
  badgeErr: {
    borderColor: 'rgba(255,59,59,0.4)',
    backgroundColor: 'rgba(255,59,59,0.08)',
  },
  badgeText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  badgeTextOk: {color: colors.green},
  badgeTextWarn: {color: colors.amber},
  badgeTextErr: {color: colors.red},
})
