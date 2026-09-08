/**
 * @worldsea/theme-kit - Type Definitions
 * 
 * ThemeManifest 声明式配置系统，支持多维度主题切换：
 * - 形态令牌（圆角、边框、阴影）
 * - 纹理/装饰（背景纹理、装饰元素）
 * - 图标风格（笔触风格、自定义图标映射）
 * - 动画/交互（缓动、时长、交互模式）
 */

// 内联 DurationToken 和 EasingToken 类型，避免跨包依赖导致 Vite 依赖扫描失败
type DurationToken = 'instant' | 'fast' | 'normal' | 'slow' | 'slower'
type EasingToken = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring' | 'bounce'

/** 主题 Manifest —— 声明主题在所有视觉维度上的完整配置 */
export interface ThemeManifest {
  /** 主题唯一ID，与 semantic.css 中 [data-theme="xxx"] 对应 */
  id: string
  /** 显示名称 */
  name: string
  /** 亮/暗模式 */
  mode: 'dark' | 'light'

  // ── 第二层：形态令牌（可选，覆盖 semantic.css 中的值） ──
  shapeTokens?: ShapeTokens

  // ── 第三层：纹理/装饰 ──
  textureTokens?: TextureTokens

  // ── 第四层：图标风格 ──
  iconStyle?: IconStyleConfig

  // ── 第五层：动画风格 ──
  motionStyle?: MotionStyleConfig

  // ── 第六层：组件形态覆盖 ──
  componentOverrides?: ComponentOverrides
}

// ─── 形态令牌 ───
export interface ShapeTokens {
  /** 圆角覆盖，如 { btn: '2px', card: '4px' } */
  radius?: Partial<Record<'btn' | 'card' | 'input' | 'modal' | 'toast' | 'badge', string>>
  /** 边框样式覆盖 */
  border?: Partial<Record<'card' | 'input' | 'modal' | 'dropdown', string>>
  /** 阴影覆盖 */
  shadow?: Partial<Record<'card' | 'cardHover' | 'modal' | 'dropdown' | 'tooltip', string>>
}

// ─── 纹理/装饰 ───
export interface TextureTokens {
  /** 全局背景纹理（CSS background-image 值，如 url("data:image/svg+xml,...") repeat） */
  bgPattern?: string
  /** 卡片背景纹理 */
  cardTexture?: string
  /** 按钮纹理 */
  buttonTexture?: string
  /** 遮罩/叠加纹理 */
  overlayTexture?: string
  /** 装饰元素列表 */
  decorativeElements?: DecorativeElement[]
}

export interface DecorativeElement {
  /** 装饰类型ID */
  type: string
  /** 应用位置：card-top-right / modal-corner / sidebar-bottom 等 */
  position: string
  /** 尺寸 */
  size: string
  /** SVG内容（内联）或URL */
  svg?: string
  /** CSS额外样式 */
  style?: Record<string, string>
}

// ─── 图标风格 ───
export interface IconStyleConfig {
  /** 图标家族：lucide（默认线性）| custom-svg（主题自定义SVG）| hybrid（混合） */
  family: 'lucide' | 'custom-svg' | 'hybrid'
  /** 笔触风格（影响CSS变量） */
  strokeStyle?: 'round' | 'square' | 'brush'
  /** 默认 stroke-width 覆盖 */
  defaultStrokeWidth?: number
  /** 自定义图标映射：标准图标名 → 主题图标SVG path */
  customIconMap?: Record<string, IconOverride>
}

export interface IconOverride {
  /** SVG path d 属性 */
  d: string
  /** 是否填充（而非描边） */
  fill?: boolean
  /** 额外 viewBox（默认 0 0 24 24） */
  viewBox?: string
}

// ─── 动画风格 ───
export interface MotionStyleConfig {
  /** 缓动函数覆盖（覆盖 semantic.css 中的 --ease-* 变量） */
  easingOverrides?: Partial<Record<string, string>>
  /** 时长覆盖（覆盖 semantic.css 中的 --duration-* 变量） */
  durationOverrides?: Partial<Record<string, string>>
  /** motion-scale 覆盖 */
  motionScale?: number
  /** 自定义关键帧（注入到 document） */
  customKeyframes?: Record<string, string>
  /** 过渡预设覆盖（覆盖 motion-kit 的 TRANSITION_PRESETS） */
  transitionOverrides?: Partial<Record<string, {
    enterDuration: DurationToken
    enterEasing: EasingToken
    exitDuration: DurationToken
    exitEasing: EasingToken
  }>>
  /** 交互效果模式 */
  interactionMode?: 'modern' | 'ink-spread' | 'crystal-refract' | 'minimal'
}

// ─── 组件形态覆盖 ───
export interface ComponentOverrides {
  button?: ComponentStylePreset
  card?: ComponentStylePreset
  modal?: ComponentStylePreset
  input?: ComponentStylePreset
}

export interface ComponentStylePreset {
  /** 额外的 CSS 变量覆盖（直接注入 :root） */
  cssVars?: Record<string, string>
  /** 额外的 CSS class（追加到组件根元素） */
  extraClass?: string
}
