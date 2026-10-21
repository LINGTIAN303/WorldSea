/** 加载反馈的共享类型（产品域） */
export type LoadingStatus = 'loading' | 'success' | 'error'

export interface LoadingStage {
  /** 弧下短标签（2–3 字） */
  short: string
  /** 面板上方的完整阶段文案 */
  full: string
  /** 阶段详情（计数/说明） */
  detail?: string
}
