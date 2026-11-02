import type { BackgroundTarget } from '@worldsea/style-kit'

/** 六目标界面文案；canvas 在 UI 上称「大背景」 */
export const BACKGROUND_TARGET_LABELS: Record<BackgroundTarget, string> = {
  canvas: '大背景',
  home: '首页',
  titlebar: '窗口栏',
  sidebar: '侧栏',
  'content-toolbar': '工具条',
  'content-view': '视图',
}

/** 工作台映射区的四个结构目标（大背景与首页各有独立入口） */
export const BACKGROUND_WORKSPACE_TARGETS = [
  'titlebar', 'sidebar', 'content-toolbar', 'content-view',
] as const satisfies readonly BackgroundTarget[]
