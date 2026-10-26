/**
 * 图谱主题令牌（2026-10-26 重构）。
 *
 * G6 是 canvas/WebGL 绘制，吃不到 CSS 变量；画布相关的颜色在此收敛，
 * 与 `worldsea_graph_background` 双档（深色星图 / 跟随主题）对齐。
 */
export interface GraphTheme {
  mode: 'dark' | 'theme'
  canvas: string
  panelBg: string
  panelBorder: string
  text: string
  textStrong: string
  textDim: string
  labelBg: string
  labelFill: string
  edgeLabelFill: string
  accent: string
  coreFill: string
  coreStroke: string
  gridStroke: string
  minimapMask: string
}

export const DARK_GRAPH_THEME: GraphTheme = {
  mode: 'dark',
  canvas: '#070b13',
  panelBg: 'rgba(8,12,20,0.92)',
  panelBorder: 'rgba(255,255,255,0.1)',
  text: '#cbd5e1',
  textStrong: '#e2e8f0',
  textDim: '#94a3b8',
  labelBg: 'rgba(5,8,14,0.72)',
  labelFill: '#e2e8f0',
  edgeLabelFill: '#cbd5e1',
  accent: '#6ea8fe',
  coreFill: 'rgba(110,168,254,0.10)',
  coreStroke: 'rgba(110,168,254,0.52)',
  gridStroke: 'rgba(148,163,184,0.05)',
  minimapMask: 'rgba(110,168,254,0.16)',
}

export const LIGHT_GRAPH_THEME: GraphTheme = {
  mode: 'theme',
  canvas: '#f8fafc',
  panelBg: 'rgba(255,255,255,0.94)',
  panelBorder: '#dbe3ee',
  text: '#475569',
  textStrong: '#1e293b',
  textDim: '#64748b',
  labelBg: 'rgba(255,255,255,0.82)',
  labelFill: '#1e293b',
  edgeLabelFill: '#475569',
  accent: '#4f6ef7',
  coreFill: 'rgba(79,110,247,0.10)',
  coreStroke: 'rgba(79,110,247,0.52)',
  gridStroke: 'rgba(71,85,105,0.08)',
  minimapMask: 'rgba(79,110,247,0.14)',
}

export function graphTheme(mode: 'dark' | 'theme'): GraphTheme {
  return mode === 'theme' ? LIGHT_GRAPH_THEME : DARK_GRAPH_THEME
}
