import type { DurationToken, EasingToken } from './tokens'

export type TransitionPresetName =
  | 'fade'
  | 'scale-fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-right'
  | 'modal'
  | 'drawer-overlay'
  | 'drawer-right'
  | 'drawer-left'
  | 'drawer-bottom'
  | 'inspector-backdrop'
  | 'inspector'
  | 'detail-backdrop'
  | 'detail-slide'
  | 'panel-backdrop'
  | 'panel'
  | 'menu'
  | 'overlay'
  | 'toast'
  | 'list'
  | 'confirm-bar'
  | 'popover'
  | 'collapse'
  | 'tooltip'
  | 'select'

export interface TransitionPreset {
  name: string
  mode?: 'in-out' | 'out-in'
  enterDuration: DurationToken
  enterEasing: EasingToken
  exitDuration: DurationToken
  exitEasing: EasingToken
}

/** 运行时过渡预设覆盖（由主题系统注入） */
let _runtimeOverrides: Partial<Record<TransitionPresetName, TransitionPreset>> = {}

/**
 * 设置运行时过渡预设覆盖
 * 用于主题系统动态调整动画效果
 */
export function setTransitionOverrides(
  overrides: Partial<Record<TransitionPresetName, Partial<TransitionPreset>>>
): void {
  const merged: Partial<Record<TransitionPresetName, TransitionPreset>> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (value && TRANSITION_PRESETS[key as TransitionPresetName]) {
      merged[key as TransitionPresetName] = {
        ...TRANSITION_PRESETS[key as TransitionPresetName],
        ...value,
      }
    }
  }
  _runtimeOverrides = merged
}

/**
 * 清除所有运行时过渡预设覆盖
 */
export function clearTransitionOverrides(): void {
  _runtimeOverrides = {}
}

/**
 * 获取当前生效的过渡预设（优先使用运行时覆盖）
 */
export function getEffectivePreset(name: TransitionPresetName): TransitionPreset {
  return _runtimeOverrides[name] || TRANSITION_PRESETS[name]
}

export const TRANSITION_PRESETS: Record<TransitionPresetName, TransitionPreset> = {
  fade: {
    name: 'ws-fade',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'scale-fade': {
    name: 'ws-scale-fade',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'slide-up': {
    name: 'ws-slide-up',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'slide-down': {
    name: 'ws-slide-down',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'slide-right': {
    name: 'ws-slide-right',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  modal: {
    name: 'ws-modal',
    enterDuration: 'slow',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'drawer-overlay': {
    name: 'ws-drawer-overlay',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'drawer-right': {
    name: 'ws-drawer-right',
    enterDuration: 'slow',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'drawer-left': {
    name: 'ws-drawer-left',
    enterDuration: 'slow',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'drawer-bottom': {
    name: 'ws-drawer-bottom',
    enterDuration: 'slow',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'inspector-backdrop': {
    name: 'ws-inspector-backdrop',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  inspector: {
    name: 'ws-inspector',
    enterDuration: 'slow',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'detail-backdrop': {
    name: 'ws-detail-backdrop',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'detail-slide': {
    name: 'ws-detail-slide',
    enterDuration: 'slow',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'panel-backdrop': {
    name: 'ws-panel-backdrop',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  panel: {
    name: 'ws-panel',
    enterDuration: 'slow',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  menu: {
    name: 'ws-menu',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  overlay: {
    name: 'ws-overlay',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  toast: {
    name: 'ws-toast',
    enterDuration: 'normal',
    enterEasing: 'spring',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  list: {
    name: 'ws-list',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  'confirm-bar': {
    name: 'ws-confirm-bar',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  popover: {
    name: 'ws-popover',
    enterDuration: 'fast',
    enterEasing: 'default',
    exitDuration: 'instant',
    exitEasing: 'default',
  },
  collapse: {
    name: 'ws-collapse',
    enterDuration: 'fast',
    enterEasing: 'default',
    exitDuration: 'fast',
    exitEasing: 'default',
  },
  tooltip: {
    name: 'ws-tooltip',
    enterDuration: 'fast',
    enterEasing: 'default',
    exitDuration: 'instant',
    exitEasing: 'default',
  },
  select: {
    name: 'ws-select',
    enterDuration: 'fast',
    enterEasing: 'default',
    exitDuration: 'instant',
    exitEasing: 'default',
  },
}

export function getPreset(name: TransitionPresetName): TransitionPreset {
  return getEffectivePreset(name)
}

export function getTransitionName(name: TransitionPresetName): string {
  return getEffectivePreset(name).name
}

export function getAllPresetNames(): TransitionPresetName[] {
  return Object.keys(TRANSITION_PRESETS) as TransitionPresetName[]
}
