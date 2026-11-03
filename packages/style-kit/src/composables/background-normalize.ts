// 背景配置归一化：把任意来源（旧版 localStorage、项目文件、外部导入）的原始数据
// 收敛成当前版本的强类型配置。纯函数、无副作用、不读写存储——安全性最高的一层。
// 详细说明见 docs/details/架构/界面背景机制-v2.md
import type {
  BackgroundFit,
  BackgroundGlobalConfig,
  BackgroundProjectConfig,
  BackgroundTarget,
  BackgroundTargetConfig,
  FocusStep,
} from './background-types'
import { BACKGROUND_TARGETS, BACKGROUND_TARGET_CAPS, FIT_VALUES, FOCUS_STEPS } from './background-types'

function nearestFocus(value: unknown): FocusStep {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 50
  return FOCUS_STEPS.reduce((best, step) => Math.abs(step - n) < Math.abs(best - n) ? step : best, 50)
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 单目标归一化：分区目标强制 cover/居中；paths 只接受字符串 light/dark */
export function normalizeTargetConfig(raw: unknown, target: BackgroundTarget): BackgroundTargetConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const paths = value.paths && typeof value.paths === 'object' ? value.paths as Record<string, unknown> : {}
  const caps = BACKGROUND_TARGET_CAPS[target]
  const fit = typeof value.fit === 'string' && FIT_VALUES.includes(value.fit as BackgroundFit)
    ? value.fit as BackgroundFit
    : 'cover'
  return {
    enabled: value.enabled === true,
    paths: {
      light: typeof paths.light === 'string' ? paths.light : '',
      dark: typeof paths.dark === 'string' ? paths.dark : '',
    },
    fit: caps.fit ? fit : 'cover',
    focusX: caps.focus ? nearestFocus(value.focusX) : 50,
    focusY: caps.focus ? nearestFocus(value.focusY) : 50,
    dim: clamp(value.dim, 0, 80, 35),
    blur: clamp(value.blur, 0, 30, 8),
  }
}

/** 旧 content 键：新 content-view 缺失时作为迁移输入；不复制到 content-toolbar */
function legacyContent(raw: Record<string, unknown>): unknown {
  return raw.content
}

/** 目标条目：新 key 优先，缺失时 content-view 回落旧 content */
function targetEntry(targetsRaw: Record<string, unknown>, target: BackgroundTarget): unknown {
  return targetsRaw[target] ?? (target === 'content-view' ? legacyContent(targetsRaw) : undefined)
}

/** 全局配置归一化：六个目标逐个归一化，缺失目标用默认值 */
export function normalizeGlobalConfig(raw: unknown): BackgroundGlobalConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const targetsRaw = value.targets && typeof value.targets === 'object' ? value.targets as Record<string, unknown> : {}
  const targets = {} as Record<BackgroundTarget, BackgroundTargetConfig>
  for (const target of BACKGROUND_TARGETS) {
    targets[target] = normalizeTargetConfig(targetEntry(targetsRaw, target), target)
  }
  return { version: 2, targets }
}

/** 项目配置归一化：只保留已知目标；无有效目标返回 null */
export function normalizeProjectConfig(raw: unknown): BackgroundProjectConfig | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (!value.targets || typeof value.targets !== 'object') return null
  const targetsRaw = value.targets as Record<string, unknown>
  const targets: Partial<Record<BackgroundTarget, BackgroundTargetConfig>> = {}
  let count = 0
  for (const target of BACKGROUND_TARGETS) {
    const entry = targetEntry(targetsRaw, target)
    if (!entry || typeof entry !== 'object') continue
    targets[target] = normalizeTargetConfig(entry, target)
    count++
  }
  return count ? { version: 1, targets } : null
}
