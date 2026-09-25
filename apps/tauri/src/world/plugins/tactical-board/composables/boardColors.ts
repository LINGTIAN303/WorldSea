// 画布颜色常量表：由 boardDraw.ts 拆出（2026-08-06），详见 docs/details/注释/README.md
// ── Color Palettes ──
export const TERRAIN_COLORS: Record<string, { fill: string; dark: string; accent: string; stroke: string }> = {
  plain:    { fill: '#4a6741', dark: '#3a5731', accent: '#5a7751', stroke: '#3d5835' },
  forest:   { fill: '#2d5a27', dark: '#1d4a17', accent: '#3d6a37', stroke: '#1e4818' },
  mountain: { fill: '#7a6b5a', dark: '#5b4b3a', accent: '#8a7b6a', stroke: '#5a4a3a' },
  water:    { fill: '#2a6a9a', dark: '#1a4a7a', accent: '#3a7aaa', stroke: '#1a5080' },
  desert:   { fill: '#b8a060', dark: '#9a8040', accent: '#c8b070', stroke: '#8a7040' },
  wall:     { fill: '#5a5a5a', dark: '#3a3a3a', accent: '#6a6a6a', stroke: '#2a2a2a' },
}

export const TEAM_COLORS: Record<string, { main: string; light: string; dark: string; ring: string; glow: string }> = {
  ally:    { main: '#4a9eff', light: '#7ab8ff', dark: '#2a6ecf', ring: '#4a9eff', glow: 'rgba(74,158,255,0.4)' },
  enemy:   { main: '#ff4a4a', light: '#ff7a7a', dark: '#cc2a2a', ring: '#ff4a4a', glow: 'rgba(255,74,74,0.4)' },
  neutral: { main: '#9a9a9a', light: '#bababa', dark: '#6a6a6a', ring: '#9a9a9a', glow: 'rgba(154,154,154,0.4)' },
}

export const HIGHLIGHT_COLORS: Record<string, string> = {
  move:   'rgba(74, 158, 255, 0.25)',
  attack: 'rgba(255, 74, 74, 0.25)',
  skill:  'rgba(255, 200, 50, 0.25)',
}

export const HIGHLIGHT_BORDERS: Record<string, string> = {
  move:   'rgba(74, 158, 255, 0.70)',
  attack: 'rgba(255, 74, 74, 0.70)',
  skill:  'rgba(255, 200, 50, 0.70)',
}

export const INFLUENCE_COLORS: Record<string, string> = {
  ally:    'rgba(74, 158, 255, 0.18)',
  enemy:   'rgba(255, 74, 74, 0.18)',
  neutral: 'rgba(154, 154, 154, 0.18)',
}

export const INFLUENCE_BORDERS: Record<string, string> = {
  ally:    'rgba(74, 158, 255, 0.35)',
  enemy:   'rgba(255, 74, 74, 0.35)',
  neutral: 'rgba(154, 154, 154, 0.35)',
}
