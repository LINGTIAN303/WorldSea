// 目标选择与映射：当前目标、工作台/首页地图切换、缩略图与缺失态取值。
// 从设置卡抽出的纯选择层（不含持久化，持久化见 useBackgroundProjectPersist）。
// 机制说明见 docs/details/架构/界面背景机制-v2.md
import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import type { BackgroundTarget, BackgroundTheme } from '@worldsea/style-kit'
import { BACKGROUND_WORKSPACE_TARGETS } from '../backgroundTargets'

interface SelectionDeps {
  /** 当前编辑目标（宿主先建，因为 isProjectCustom 等计算属性依赖它） */
  target: Ref<BackgroundTarget>
  picking: Ref<BackgroundTheme | null>
  error: Ref<string>
  editorRef: Ref<HTMLElement | null>
  isProjectCustom: ComputedRef<boolean>
  projectSrcs: Ref<Record<BackgroundTarget, { light: string; dark: string }>>
  globalSrcs: Ref<Record<BackgroundTarget, { light: string; dark: string }>>
  projectMissing: Ref<Record<BackgroundTarget, Record<BackgroundTheme, boolean>>>
  globalMissing: Ref<Record<BackgroundTarget, Record<BackgroundTheme, boolean>>>
}

export function useBackgroundSelection(deps: SelectionDeps) {
  const { target, picking, error, editorRef, isProjectCustom, projectSrcs, globalSrcs, projectMissing, globalMissing } = deps

  const map = ref<'workspace' | 'home'>('workspace')
  const lastWorkspaceTarget = ref<BackgroundTarget>('titlebar')

  /** 缩略图与缺失态的取数范围：项目自定义时读本项目，否则读全局 */
  const previewScope = computed<'global' | 'project'>(() => isProjectCustom.value ? 'project' : 'global')

  /** 选中后把编辑区带到可见位置；已在视口内时 nearest 不移动 */
  function scrollEditorIntoView() {
    void nextTick(() => {
      const el = editorRef.value
      if (!el) return
      const reduced = document.documentElement.dataset.reduceMotion === 'on'
        || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    })
  }

  function isWorkspaceTarget(t: BackgroundTarget): boolean {
    return BACKGROUND_WORKSPACE_TARGETS.some((target) => target === t)
  }

  /** 地图切换：首页地图只映射 home；工作台恢复上次结构目标，默认窗口栏 */
  function onSelectTarget(t: BackgroundTarget) {
    if (picking.value || t === target.value) return
    error.value = ''
    target.value = t
    if (isWorkspaceTarget(t)) {
      lastWorkspaceTarget.value = t
      map.value = 'workspace'
    } else if (t === 'home') {
      map.value = 'home'
    }
    scrollEditorIntoView()
  }

  function onSwitchMap(next: 'workspace' | 'home') {
    if (picking.value || next === map.value) return
    error.value = ''
    map.value = next
    target.value = next === 'home' ? 'home' : lastWorkspaceTarget.value
    scrollEditorIntoView()
  }

  function thumbSrc(theme: BackgroundTheme): string {
    const srcs = previewScope.value === 'project' ? projectSrcs.value : globalSrcs.value
    return srcs[target.value][theme]
  }

  function thumbStyle(theme: BackgroundTheme) {
    const src = thumbSrc(theme)
    return src ? { backgroundImage: `url("${src}")` } : undefined
  }

  function missingFor(theme: BackgroundTheme): boolean {
    const miss = previewScope.value === 'project' ? projectMissing.value : globalMissing.value
    return miss[target.value][theme]
  }

  return {
    map, lastWorkspaceTarget, previewScope,
    scrollEditorIntoView, onSelectTarget, onSwitchMap,
    thumbSrc, thumbStyle, missingFor,
  }
}
