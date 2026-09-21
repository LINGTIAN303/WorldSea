/**
 * 世界观芽「使用方法」概述数据（id 键控）
 *
 * 中性撰写规范（见 docs/plans/2026-09-21-世界观芽工具整合.md §三）：
 * 只陈述事实——能力、参数、数据模型约束、边界；
 * 不出现推荐 / 优先 / 建议 / 应该等引导词，不含输出渠道偏好与方法论断言。
 *
 * 批 2 填充全部 27 条；未填充时渲染回退到芽登记 description。
 */

export interface SproutGuide {
  /** 概述文本（Markdown）：定位 / 实体类型 / 数据模型约束 / 边界 */
  overview: string
}

export const SPROUT_GUIDES: Record<string, SproutGuide> = {}
