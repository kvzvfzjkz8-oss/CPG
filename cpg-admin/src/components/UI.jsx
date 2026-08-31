import React from 'react';
import { colors, fonts } from '../theme';

export function Card({ children, style, ...rest }) {
  return (
    <div
      style={{
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: 18,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  const palette = {
    neutral: [colors.forestPale, colors.forestLight],
    gold: [colors.goldPale, colors.goldDark],
    danger: [colors.dangerPale, colors.danger],
  };
  const [bg, fg] = palette[tone] ?? palette.neutral;
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: fonts.body,
        padding: '4px 9px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Tabs({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = o.key === value;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              borderRadius: 12,
              border: `1px solid ${active ? colors.forest : colors.line}`,
              background: active ? colors.forest : colors.card,
              color: active ? '#fff' : colors.muted,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: fonts.body,
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            {Icon && <Icon size={14} />}
            {o.label}
            {!!o.badge && (
              <span
                style={{
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: active ? '#fff' : colors.danger,
                  color: active ? colors.forest : '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {o.badge > 99 ? '99+' : o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function KpiCard({ label, value, delta, up }) {
  return (
    <Card style={{ padding: 18 }}>
      <p style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body, margin: 0 }}>{label}</p>
      <p
        style={{
          fontSize: 24,
          color: colors.ink,
          fontFamily: fonts.mono,
          fontWeight: 600,
          margin: '6px 0 4px',
        }}
      >
        {value}
      </p>
      <span
        style={{
          fontSize: 11,
          color: up ? colors.forestLight : colors.danger,
          fontFamily: fonts.body,
        }}
      >
        {delta}
      </span>
    </Card>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: `1px solid ${colors.line}`,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        {children}
      </span>
      {right}
    </div>
  );
}

export function DataTable({ columns, rows, renderCell }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: colors.bg }}>
          {columns.map((c) => (
            <th
              key={c}
              style={{
                textAlign: 'left',
                padding: '10px 20px',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: colors.muted,
                fontFamily: fonts.body,
                fontWeight: 600,
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id ?? i} style={{ borderTop: `1px solid ${colors.line}` }}>
            {renderCell(row)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const td = {
  padding: '12px 20px',
  fontSize: 12,
  color: colors.ink,
  fontFamily: fonts.body,
};
