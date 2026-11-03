// 背景配置的类型与常量：被 useBackground（状态单例）与 background-normalize（归一化）共用，
// 下沉到本文件以避免二者循环导入。
export type BackgroundTarget =
  | 'canvas'
  | 'home'
  | 'titlebar'
  | 'sidebar'
  | 'content-toolbar'
  | 'content-view'
export type BackgroundTheme = 'light' | 'dark'
export type BackgroundScope = 'global' | 'project'
export type BackgroundFit = 'cover' | 'contain' | 'tile'
export type FocusStep = 0 | 50 | 100

export interface BackgroundImageRef {
  path: string
  src: string
}

export interface BackgroundTargetConfig {
  enabled: boolean
  paths: { light: string; dark: string }
  fit: BackgroundFit
  focusX: FocusStep
  focusY: FocusStep
  dim: number
  blur: number
}

export interface BackgroundGlobalConfig {
  version: 2
  targets: Record<BackgroundTarget, BackgroundTargetConfig>
}

export interface BackgroundProjectConfig {
  version: 1
  targets: Partial<Record<BackgroundTarget, BackgroundTargetConfig>>
}

export const BACKGROUND_KEY = 'worldsea_background_v2'
export const BACKGROUND_V1_KEY = 'worldsea_workspace_background'
export const BACKGROUND_TARGETS: readonly BackgroundTarget[] = [
  'canvas', 'home', 'titlebar', 'sidebar', 'content-toolbar', 'content-view',
]
export const BACKGROUND_THEMES: readonly BackgroundTheme[] = ['light', 'dark']
export const BACKGROUND_TARGET_CAPS: Record<BackgroundTarget, { fit: boolean; focus: boolean }> = {
  canvas: { fit: true, focus: true },
  home: { fit: true, focus: true },
  titlebar: { fit: false, focus: false },
  sidebar: { fit: false, focus: false },
  'content-toolbar': { fit: false, focus: false },
  'content-view': { fit: false, focus: false },
}

export const FOCUS_STEPS: FocusStep[] = [0, 50, 100]
export const FIT_VALUES: BackgroundFit[] = ['cover', 'contain', 'tile']
