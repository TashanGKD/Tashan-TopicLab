export type HomeCardThemeName =
  | 'mistBlue'
  | 'sageFog'
  | 'paperSand'
  | 'slateMist'
  | 'aquaHaze'
  | 'moonSilver'

export interface HomeCardTheme {
  pageBase: string
  ambientPrimary: string
  ambientSecondary: string
  ambientTertiary: string
  activeGlow: string
  activeEdge: string
  activeShadow: string
  cardGradient: string
  borderColor: string
  shadowColor: string
  orbPrimary: string
  orbSecondary: string
  shimmer: string
  topLine: string
  eyebrowText: string
  eyebrowBackground: string
  eyebrowBorder: string
  titleColor: string
  titleShadow: string
  bodyColor: string
  mutedText: string
  actionBorder: string
  actionBackground: string
  actionText: string
  surfaceBorder: string
  surfaceBackground: string
  surfaceShadow: string
  statLabel: string
  statValue: string
}

const SHARED_THEME_TOKENS = {
  eyebrowText: 'rgba(100, 116, 139, 0.9)',
  eyebrowBackground: 'rgba(255,255,255,0.54)',
  eyebrowBorder: 'rgba(255,255,255,0.6)',
  titleColor: '#243147',
  titleShadow: 'rgba(255,255,255,0.68)',
  bodyColor: '#6b7890',
  mutedText: '#9aa6b7',
  actionBackground: 'rgba(255,255,255,0.62)',
  surfaceBackground: 'rgba(255,255,255,0.72)',
  statValue: '#243147',
} as const

export const HOME_CARD_THEMES: Record<HomeCardThemeName, HomeCardTheme> = {
  mistBlue: {
    ...SHARED_THEME_TOKENS,
    pageBase: '#EDF3F8',
    ambientPrimary: 'rgba(185, 206, 228, 0.38)',
    ambientSecondary: 'rgba(210, 222, 236, 0.22)',
    ambientTertiary: 'rgba(255, 255, 255, 0.62)',
    activeGlow: 'rgba(185, 206, 228, 0.28)',
    activeEdge: 'rgba(255, 255, 255, 0.8)',
    activeShadow: 'rgba(76, 103, 134, 0.18)',
    cardGradient: 'linear-gradient(135deg, rgba(237,243,248,0.98) 0%, rgba(232,238,245,0.97) 46%, rgba(226,233,242,0.98) 100%)',
    borderColor: 'rgba(186,198,214,0.42)',
    shadowColor: 'rgba(171,186,205,0.22)',
    orbPrimary: 'radial-gradient(circle, rgba(185,206,228,0.34) 0%, rgba(185,206,228,0) 70%)',
    orbSecondary: 'radial-gradient(circle, rgba(210,222,236,0.3) 0%, rgba(210,222,236,0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(248,250,252,0.24) 48%, rgba(255,255,255,0) 100%)',
    topLine: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, rgba(255,255,255,0) 100%)',
    actionBorder: 'rgba(183,198,214,0.45)',
    actionText: '#314158',
    surfaceBorder: 'rgba(183,198,214,0.3)',
    surfaceShadow: 'rgba(171,186,205,0.12)',
    statLabel: '#93a2b5',
  },
  sageFog: {
    ...SHARED_THEME_TOKENS,
    pageBase: '#EEF4F0',
    ambientPrimary: 'rgba(188, 206, 195, 0.34)',
    ambientSecondary: 'rgba(209, 221, 214, 0.2)',
    ambientTertiary: 'rgba(255, 255, 255, 0.58)',
    activeGlow: 'rgba(188, 206, 195, 0.26)',
    activeEdge: 'rgba(251, 255, 252, 0.8)',
    activeShadow: 'rgba(83, 110, 91, 0.16)',
    cardGradient: 'linear-gradient(135deg, rgba(238,244,240,0.98) 0%, rgba(232,239,235,0.97) 46%, rgba(226,234,229,0.98) 100%)',
    borderColor: 'rgba(184,203,191,0.42)',
    shadowColor: 'rgba(177,194,183,0.18)',
    orbPrimary: 'radial-gradient(circle, rgba(188,206,195,0.32) 0%, rgba(188,206,195,0) 70%)',
    orbSecondary: 'radial-gradient(circle, rgba(209,221,214,0.28) 0%, rgba(209,221,214,0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(247,250,248,0.24) 48%, rgba(255,255,255,0) 100%)',
    topLine: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(252,255,253,0.78) 50%, rgba(255,255,255,0) 100%)',
    actionBorder: 'rgba(184,203,191,0.42)',
    actionText: '#314139',
    surfaceBorder: 'rgba(184,203,191,0.28)',
    surfaceShadow: 'rgba(177,194,183,0.1)',
    statLabel: '#95a89e',
  },
  paperSand: {
    ...SHARED_THEME_TOKENS,
    pageBase: '#F4F1EB',
    ambientPrimary: 'rgba(214, 200, 182, 0.28)',
    ambientSecondary: 'rgba(231, 221, 205, 0.18)',
    ambientTertiary: 'rgba(255, 251, 245, 0.56)',
    activeGlow: 'rgba(214, 200, 182, 0.22)',
    activeEdge: 'rgba(255, 250, 243, 0.78)',
    activeShadow: 'rgba(122, 101, 72, 0.15)',
    cardGradient: 'linear-gradient(135deg, rgba(244,241,235,0.98) 0%, rgba(240,236,229,0.97) 46%, rgba(235,231,224,0.98) 100%)',
    borderColor: 'rgba(211,198,183,0.44)',
    shadowColor: 'rgba(199,188,173,0.18)',
    orbPrimary: 'radial-gradient(circle, rgba(214,198,178,0.26) 0%, rgba(214,198,178,0) 70%)',
    orbSecondary: 'radial-gradient(circle, rgba(231,221,205,0.24) 0%, rgba(231,221,205,0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(249,246,240,0.24) 48%, rgba(255,255,255,0) 100%)',
    topLine: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,251,246,0.74) 50%, rgba(255,255,255,0) 100%)',
    actionBorder: 'rgba(211,198,183,0.44)',
    actionText: '#433a31',
    surfaceBorder: 'rgba(211,198,183,0.28)',
    surfaceShadow: 'rgba(199,188,173,0.1)',
    statLabel: '#a79785',
  },
  slateMist: {
    ...SHARED_THEME_TOKENS,
    pageBase: '#EEF0F6',
    ambientPrimary: 'rgba(194, 198, 220, 0.3)',
    ambientSecondary: 'rgba(217, 220, 235, 0.18)',
    ambientTertiary: 'rgba(251, 252, 255, 0.58)',
    activeGlow: 'rgba(194, 198, 220, 0.24)',
    activeEdge: 'rgba(251, 252, 255, 0.8)',
    activeShadow: 'rgba(73, 85, 120, 0.18)',
    cardGradient: 'linear-gradient(135deg, rgba(238,240,246,0.98) 0%, rgba(232,235,242,0.97) 46%, rgba(226,230,239,0.98) 100%)',
    borderColor: 'rgba(193,198,221,0.42)',
    shadowColor: 'rgba(182,187,207,0.18)',
    orbPrimary: 'radial-gradient(circle, rgba(194,198,223,0.3) 0%, rgba(194,198,223,0) 70%)',
    orbSecondary: 'radial-gradient(circle, rgba(217,220,235,0.26) 0%, rgba(217,220,235,0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(248,249,252,0.24) 48%, rgba(255,255,255,0) 100%)',
    topLine: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(251,252,255,0.76) 50%, rgba(255,255,255,0) 100%)',
    actionBorder: 'rgba(193,198,221,0.42)',
    actionText: '#31384d',
    surfaceBorder: 'rgba(193,198,221,0.28)',
    surfaceShadow: 'rgba(182,187,207,0.1)',
    statLabel: '#96a0b4',
  },
  aquaHaze: {
    ...SHARED_THEME_TOKENS,
    pageBase: '#EDF5F4',
    ambientPrimary: 'rgba(182, 209, 205, 0.32)',
    ambientSecondary: 'rgba(206, 225, 223, 0.18)',
    ambientTertiary: 'rgba(250, 255, 255, 0.58)',
    activeGlow: 'rgba(182, 209, 205, 0.24)',
    activeEdge: 'rgba(250, 255, 255, 0.82)',
    activeShadow: 'rgba(64, 102, 103, 0.16)',
    cardGradient: 'linear-gradient(135deg, rgba(237,245,244,0.99) 0%, rgba(233,242,241,0.98) 46%, rgba(228,238,236,0.99) 100%)',
    borderColor: 'rgba(182,209,205,0.42)',
    shadowColor: 'rgba(170,194,191,0.18)',
    orbPrimary: 'radial-gradient(circle, rgba(182,209,205,0.24) 0%, rgba(182,209,205,0) 70%)',
    orbSecondary: 'radial-gradient(circle, rgba(206,225,223,0.22) 0%, rgba(206,225,223,0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(246,251,251,0.24) 48%, rgba(255,255,255,0) 100%)',
    topLine: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(250,255,255,0.76) 50%, rgba(255,255,255,0) 100%)',
    eyebrowText: 'rgba(83, 108, 109, 0.9)',
    titleColor: '#2D4344',
    titleShadow: 'rgba(255,255,255,0.72)',
    bodyColor: '#61797A',
    mutedText: '#90A6A7',
    actionBorder: 'rgba(182,209,205,0.42)',
    actionBackground: 'rgba(255,255,255,0.64)',
    actionText: '#2D4344',
    surfaceBorder: 'rgba(182,209,205,0.28)',
    surfaceBackground: 'rgba(255,255,255,0.74)',
    surfaceShadow: 'rgba(170,194,191,0.1)',
    statLabel: '#89A2A3',
    statValue: '#2D4344',
  },
  moonSilver: {
    ...SHARED_THEME_TOKENS,
    pageBase: '#F1F3F6',
    ambientPrimary: 'rgba(198, 203, 214, 0.26)',
    ambientSecondary: 'rgba(220, 224, 231, 0.18)',
    ambientTertiary: 'rgba(252, 253, 255, 0.58)',
    activeGlow: 'rgba(198, 203, 214, 0.2)',
    activeEdge: 'rgba(252, 253, 255, 0.8)',
    activeShadow: 'rgba(80, 92, 118, 0.15)',
    cardGradient: 'linear-gradient(135deg, rgba(241,243,246,0.98) 0%, rgba(236,239,243,0.97) 46%, rgba(230,234,239,0.98) 100%)',
    borderColor: 'rgba(198,203,214,0.4)',
    shadowColor: 'rgba(177,184,198,0.17)',
    orbPrimary: 'radial-gradient(circle, rgba(198,203,214,0.28) 0%, rgba(198,203,214,0) 70%)',
    orbSecondary: 'radial-gradient(circle, rgba(220,224,231,0.24) 0%, rgba(220,224,231,0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(248,250,252,0.22) 48%, rgba(255,255,255,0) 100%)',
    topLine: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(252,253,255,0.74) 50%, rgba(255,255,255,0) 100%)',
    actionBorder: 'rgba(198,203,214,0.4)',
    actionText: '#394252',
    surfaceBorder: 'rgba(198,203,214,0.28)',
    surfaceShadow: 'rgba(177,184,198,0.1)',
    statLabel: '#96a0b0',
  },
}

export function getHomeCardTheme(name: HomeCardThemeName): HomeCardTheme {
  return HOME_CARD_THEMES[name]
}
