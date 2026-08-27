import React from 'react';
import { View } from 'react-native';
import { colors } from '../theme';

/**
 * Élément signature de l'app : l'échéancier de remboursement dessiné
 * comme une portion de voie ferrée — une traverse par mensualité.
 * Clin d'œil à la clientèle CPG des agents de la voie.
 *
 * @param {{ total: number, paid: number, compact?: boolean }} props
 */
export default function RailProgress({ total, paid, compact = false }) {
  const tieHeight = compact ? 14 : 22;
  const railTop = compact ? 4 : 6;
  const railBottom = compact ? 12 : 18;
  const ratio = total > 0 ? Math.min(paid / total, 1) : 0;

  return (
    <View
      style={{ height: compact ? 18 : 28, marginVertical: compact ? 6 : 12 }}
      accessible
      accessibilityLabel={`${paid} mensualités payées sur ${total}`}
    >
      {/* rails, gris puis or sur la portion parcourue */}
      {[railTop, railBottom].map((top) => (
        <View key={top}>
          <View
            style={{
              position: 'absolute',
              top,
              left: 0,
              right: 0,
              height: 2,
              backgroundColor: colors.line,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top,
              left: 0,
              width: `${ratio * 100}%`,
              height: 2,
              backgroundColor: colors.gold,
            }}
          />
        </View>
      ))}

      {/* traverses */}
      <View
        style={{
          position: 'absolute',
          top: compact ? 2 : 4,
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={{
              width: 3,
              height: tieHeight,
              borderRadius: 1,
              backgroundColor:
                i < paid ? colors.gold : i === paid ? colors.forestLight : colors.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}
