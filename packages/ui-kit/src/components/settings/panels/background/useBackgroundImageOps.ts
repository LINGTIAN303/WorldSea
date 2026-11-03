// 背景图片的选取 / 移除：捕获发起时的范围与目录，避免等待期间项目切换写错位置。
// 从设置卡抽出的图片操作层；持久化细节由宿主注入。
// 机制说明见 docs/details/架构/界面背景机制-v2.md
import type { Ref } from 'vue'
import type { BackgroundScope, BackgroundTarget, BackgroundTargetConfig, BackgroundTheme } from '@worldsea/style-kit'
import { pickAndSaveBackground, removeBackgroundFile, removeProjectBackgroundFile } from '@worldsea/entity-core/core'

interface ImageOpsDeps {
  scope: Ref<BackgroundScope>
  target: Ref<BackgroundTarget>
  projectDir: Ref<string>
  selected: { value: BackgroundTargetConfig }
  readOnly: { value: boolean }
  picking: Ref<BackgroundTheme | null>
  error: Ref<string>
  invalidateProjectLoad: () => void
  setTargetImage: (target: BackgroundTarget, theme: BackgroundTheme, image: { path: string; src: string }, scope: BackgroundScope) => void
  clearTargetImage: (target: BackgroundTarget, theme: BackgroundTheme, scope: BackgroundScope) => void
  persistProjectNow: (dir: string) => void
  flushGlobal: () => void
}

export function useBackgroundImageOps(deps: ImageOpsDeps) {
  const {
    scope, target, projectDir, selected, readOnly, picking, error,
    invalidateProjectLoad, setTargetImage, clearTargetImage, persistProjectNow, flushGlobal,
  } = deps

  async function onPick(theme: BackgroundTheme) {
    if (readOnly.value || picking.value) return
    invalidateProjectLoad()
    // 捕获发起时的范围/目标/目录/旧路径：等待选图期间一律用捕获值，不读实时状态
    const scopeAt = scope.value
    const targetAt = target.value
    const dirAt = projectDir.value
    const oldPath = selected.value.paths[theme]
    picking.value = theme
    error.value = ''
    try {
      const result = await pickAndSaveBackground({
        scope: scopeAt,
        projectDir: dirAt,
        target: targetAt,
        theme,
      })
      if (result === null) return
      if (!result.ok || !result.src) {
        error.value = result.reason ?? '背景导入失败'
        return
      }
      if (scopeAt === 'project') {
        if (!result.relativePath) { error.value = '背景导入失败'; return }
        if (dirAt !== projectDir.value) {
          // 选图期间项目已切换：丢弃结果，并从旧项目目录清理刚写入的文件
          void removeProjectBackgroundFile(dirAt, result.relativePath)
          return
        }
        setTargetImage(targetAt, theme, { path: result.relativePath, src: result.src }, 'project')
        persistProjectNow(dirAt)
        if (oldPath && oldPath !== result.relativePath) void removeProjectBackgroundFile(dirAt, oldPath)
      } else {
        if (!result.path) { error.value = '背景导入失败'; return }
        setTargetImage(targetAt, theme, { path: result.path, src: result.src }, 'global')
        if (oldPath && oldPath !== result.path) void removeBackgroundFile(oldPath)
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      picking.value = null
    }
  }

  function onRemove(theme: BackgroundTheme) {
    if (readOnly.value) return
    error.value = ''
    invalidateProjectLoad()
    const scopeAt = scope.value
    const targetAt = target.value
    const dirAt = projectDir.value
    const oldPath = selected.value.paths[theme]
    clearTargetImage(targetAt, theme, scopeAt)
    if (scopeAt === 'project') {
      if (oldPath) void removeProjectBackgroundFile(dirAt, oldPath)
      persistProjectNow(dirAt)
    } else {
      if (oldPath) void removeBackgroundFile(oldPath)
      flushGlobal()
    }
  }

  return { onPick, onRemove }
}
