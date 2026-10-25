/**
 * 强调色预设与 CSS 注入模板（纯数据 + 纯函数，零依赖除 accentColor 派生算法）。
 * 从 useTheme.ts 抽出（2026-10-26）：启动页独立构建入口不含 entity-core 响应式层，
 * 但需要同一套预设清单与注入模板——抽出后两边共用单一真源，杜绝两处漂移。
 */
import { deriveDark, deriveGradTo, pickOnAccent } from './accentColor'

/** 强调色预设：id 同时作为 currentThemeId（面板高亮 / 编辑器导出取名） */
export interface AccentPreset {
  id: string
  label: string
  /** 浅色主值 = 色相锚点（须与 #ffffff 对比 ≥ 4.5:1，保证 accent 面白字达标） */
  light: string
  /** 深色主值：缺省由 OKLCH 算法派生（提亮 + 降饱和）；水墨等特殊中性色可手工指定 */
  dark?: string
  /** 渐变末端手工覆盖（仅水墨这类近黑锚点需要——色相旋转公式对近黑色无意义） */
  gradTo?: { light: string; dark: string }
}

// 2026-10-24 重排：按 OKLCH 色相均匀取锚（靛蓝 277 / 棱镜蓝 262 / 青瓷 210 / 苔绿 150 / 余烬橙 45 / 水墨中性），
// 旧「三紫扎堆」退场；全部浅色锚点过 AA 白字线（≥4.5:1）。深色值除基准靛蓝与水墨外一律算法派生。
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', label: '靛蓝', light: '#4f46e5', dark: '#8b87f8' },
  { id: 'prism', label: '棱镜蓝', light: '#2563eb' },
  { id: 'cyan', label: '青瓷', light: '#0e7490' },
  { id: 'moss', label: '苔绿', light: '#15803d' },
  { id: 'ember', label: '余烬橙', light: '#c2410c' },
  { id: 'ink', label: '水墨', light: '#2a2018', dark: '#d6c9b4', gradTo: { light: '#847c72', dark: '#efe9dd' } },
]

export const DEFAULT_ACCENT_ID = 'indigo'

/**
 * 单个强调色在指定明暗下的 CSS 声明串（--accent 及全部派生令牌）。
 * 派生令牌用 color-mix 表达，浏览器端随主值实时计算，JS 侧无需逐个求值。
 */
export function accentCssBlock(p: AccentPreset, mode: 'light' | 'dark'): string {
  const a = mode === 'light' ? p.light : (p.dark ?? deriveDark(p.light))
  // 渐变末端 = 类比色（色相 +25°）；水墨等近黑锚点走手工覆盖。默认靛蓝不注入（theme.css 基准 #7c3aed 与本式同源）
  const gradTo = mode === 'light' ? (p.gradTo?.light ?? deriveGradTo(a)) : (p.gradTo?.dark ?? deriveGradTo(a))
  const decls = [
    `--accent: ${a}`,
    `--accent-soft: color-mix(in srgb, ${a} ${mode === 'light' ? '12' : '18'}%, transparent)`,
    `--accent-soft-border: color-mix(in srgb, ${a} 35%, transparent)`,
    `--accent-grad-to: ${gradTo}`,
    `--ring-color: color-mix(in srgb, ${a} ${mode === 'light' ? '35' : '40'}%, transparent)`,
    // accent 面文字：锚点已保证浅色白字 ≥4.5:1，此处按实测对比择向（深色提亮主值自动落墨字侧）
    `--on-accent: ${pickOnAccent(a)}`,
  ]
  if (mode === 'light') {
    // 浅色底：hover 加深
    decls.push(`--accent-hover: color-mix(in srgb, ${a} 85%, #000)`)
  } else {
    // 深色底：hover 提亮
    decls.push(`--accent-hover: color-mix(in srgb, ${a} 82%, #fff)`)
  }
  return decls.join('; ')
}
