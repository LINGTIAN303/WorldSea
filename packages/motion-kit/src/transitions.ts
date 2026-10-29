import type { DurationToken, EasingToken } from './tokens'

export type TransitionPresetName =
  | 'fade'
  | 'scale-fade'
  | 'menu'
  | 'slide-right'
  | 'slide-left'
  | 'slide-up'
  | 'slide-down'
  | 'list'
  | 'surface'

export interface TransitionPreset {
  name: string
  enterDuration: DurationToken
  enterEasing: EasingToken
  exitDuration: DurationToken
  exitEasing: EasingToken
}

export const TRANSITION_PRESETS: Record<TransitionPresetName, TransitionPreset> = {
  fade: {
    name: 'ws-fade',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'instant',
    exitEasing: 'in',
  },
  'scale-fade': {
    name: 'ws-scale-fade',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'fast',
    exitEasing: 'in',
  },
  menu: {
    name: 'ws-menu',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'instant',
    exitEasing: 'in',
  },
  'slide-right': {
    name: 'ws-slide-right',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'normal',
    exitEasing: 'in',
  },
  'slide-left': {
    name: 'ws-slide-left',
    enterDuration: 'normal',
    enterEasing: 'out',
    exitDuration: 'normal',
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
  list: {
    name: 'ws-list',
    enterDuration: 'fast',
    enterEasing: 'out',
    exitDuration: 'instant',
    exitEasing: 'in',
  },
  surface: {
    name: 'ws-surface',
    enterDuration: 'surface',
    enterEasing: 'default',
    exitDuration: 'surface',
    exitEasing: 'in',
  },
}

export function getPreset(name: TransitionPresetName): TransitionPreset {
  return TRANSITION_PRESETS[name]
}

export function getTransitionName(name: TransitionPresetName): string {
  return TRANSITION_PRESETS[name].name
}

export function getAllPresetNames(): TransitionPresetName[] {
  return Object.keys(TRANSITION_PRESETS) as TransitionPresetName[]
}
