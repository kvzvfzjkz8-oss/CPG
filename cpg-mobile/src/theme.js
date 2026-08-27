import { Platform } from 'react-native';

/**
 * Identité visuelle CPG : vert forêt + or ferroviaire.
 * Un seul point d'entrée pour toutes les couleurs et polices de l'app.
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
  line: '#DCE3DD',
  danger: '#B23A2E',
  dangerPale: '#FBEAE7',
  onForest: '#9FC3AE',
};

/**
 * Polices système, pour éviter une dépendance à expo-font au démarrage.
 * Pour passer aux polices de marque (Space Grotesk / Inter / JetBrains Mono),
 * voir la section « Polices » du README.
 */
export const fonts = {
  display: Platform.select({ ios: 'Avenir Next', android: 'sans-serif-medium' }),
  body: Platform.select({ ios: 'System', android: 'sans-serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace' }),
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };

/** 412500 -> "412 500" */
export const formatFCFA = (n) =>
  Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
