/**
 * @worldsea/theme-kit
 * 
 * 多维度主题切换系统：
 * - 形态令牌（圆角、边框、阴影）
 * - 纹理/装饰（背景纹理、装饰元素）
 * - 图标风格（笔触风格、自定义图标映射）
 * - 动画/交互（缓动、时长、交互模式）
 */

// ─── 类型导出 ───
export type {
  ThemeManifest,
  ShapeTokens,
  TextureTokens,
  DecorativeElement,
  IconStyleConfig,
  IconOverride,
  MotionStyleConfig,
  ComponentOverrides,
  ComponentStylePreset,
} from './types'

// ─── 注册表 ───
export {
  registerManifest,
  getManifest,
  getAllManifests,
  hasManifest,
  unregisterManifest,
} from './registry'

// ─── 纹理引擎 ───
export {
  injectTextures,
  clearTextures,
  getTextureVars,
  injectDecorationCSS,
} from './texture-engine'

// ─── 图标风格 ───
export {
  applyIconStyle,
  clearIconStyle,
  getThemeIconOverride,
  resolveIconForTheme,
  getCurrentIconStyle,
} from './icon-style'

// ─── 动画覆盖 ───
export {
  applyMotionOverrides,
  clearMotionOverrides,
  injectCustomKeyframes,
  getCurrentMotionOverrides,
} from './motion-override'

// ─── Composable ───
export {
  useThemeManifest,
} from './useThemeManifest'

// ─── Manifests Registry ───
export {
  builtinManifests,
  registerAllManifests,
} from './manifests'
