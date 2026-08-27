import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radius } from '../theme';

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({ children, tone = 'forest' }) {
  const bg = tone === 'forest' ? colors.forestPale : colors.goldPale;
  const fg = tone === 'forest' ? colors.forestLight : colors.goldDark;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: disabled ? colors.line : colors.forest, opacity: pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: disabled ? colors.muted : '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function ScreenHeader({ title, subtitle, right }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.segmentItem,
              {
                backgroundColor: active ? colors.forest : colors.card,
                borderColor: active ? colors.forest : colors.line,
              },
            ]}
          >
            <Text style={[styles.segmentText, { color: active ? '#fff' : colors.muted }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontSize: 11, fontWeight: '600', fontFamily: fonts.body },
  button: {
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 14, fontWeight: '600', fontFamily: fonts.body },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  headerTitle: { fontSize: 24, fontWeight: '600', color: colors.ink, fontFamily: fonts.display },
  headerSubtitle: { fontSize: 12, color: colors.muted, marginTop: 3, fontFamily: fonts.body },
  segment: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
  segmentItem: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  segmentText: { fontSize: 12, fontWeight: '600', fontFamily: fonts.body },
});
