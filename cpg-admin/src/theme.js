/**
 * Même identité visuelle que l'application mobile : vert forêt + or ferroviaire.
 * Si vous modifiez une couleur ici, répercutez-la dans cpg-mobile/src/theme.js.
 */
export const colors = {
  forest: '#0B3D2E',
  forestLight: '#145C3F',
  forestPale: '#E4ECE6',
  gold: '#E8B93B',
  goldDark: '#B9860F',
  goldPale: '#FBF0D2',
  bg: '#F5F7F3',
  card: '#FFFFFF',
  ink: '#14231C',
  muted: '#5B6B62',
  line: '#E1E7E1',
  danger: '#B23A2E',
  dangerPale: '#FBEAE7',
  onForest: '#9FC3AE',
};

export const fonts = {
  display: "'Space Grotesk', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

export const formatFCFA = (n) =>
  Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
