/**
 * C1 对话区性能门禁：预算常量（源码常量，环境变量不可覆盖）
 *
 * REFERENCE_MS = 参考机（开发机 Windows / Node 20）实测中位数，随 `conversation.bench.ts`
 * 的基线报告一起校准与提交；BUDGET_MS = ciTimeBudget(REFERENCE_MS) = ceil(期望 × 2 × 1.25)。
 * 门禁运行：`pnpm bench:gate`
 *
 * ⚠️ 修改语义：这些是**门禁**常量。调高任何一个都必须附「本机实测报告 + 原因」，
 * 否则「回归即红」失效（判别力由 conversation.bench.ts 内的自证用例守住）。
 */
import { ciTimeBudget } from '../support/calibration'

/** 参考机（开发机）实测期望（毫秒，中位数） */
export const REFERENCE_MS = {
  /** 路径① 归约：200 轮 × 50 delta 全量回放（1 万事件） */
  reduceSession: 5,
  /** 路径① 展平：200 轮全量展平 */
  flattenSession: 0.5,
  /** 路径③ 流式消费：单轮 500 推理 delta（归约 + 引用缓存展平） */
  consumeReasoningStream: 0.8,
  /** 路径③ 流式消费：单轮 500 正文 delta（归约 + 引用缓存展平） */
  consumeTextStream: 0.6,
  /** C2 增量：长文档（约 7 千字符 / 72 帧）流式逐帧增量渲染 */
  markdownIncrementalFrames: 300,
  /** 推理专项：64k **多行**推理文本摘要 200 次（定向扫描） */
  thinkSummaryBatched: 0.3,
  /** 推理专项：64k **单行**推理文本摘要 200 次（无换行 → 一次原生扫描上界） */
  thinkSummarySingleLineBatched: 15,
  /** 代码高亮专项：同一份 60 行 TS 源码 × 50 次请求（内容键 memo 命中后不再跑 Prism） */
  highlightMemoizedBatched: 2,
} as const

/** CI 预算（毫秒，整数）= ceil(参考期望 × 2 × 1.25) */
export const BUDGET_MS: Record<keyof typeof REFERENCE_MS, number> = Object.fromEntries(
  Object.entries(REFERENCE_MS).map(([key, value]) => [key, ciTimeBudget(value)]),
) as Record<keyof typeof REFERENCE_MS, number>

// ─── 无量纲语义阈值（不乘时间系数——机器差异不影响比值） ───────────────

/** 展平缓存全命中相对冷全量展平的加速比下限（两级缓存必须生效；轮次行数越多比值越大） */
export const FLATTEN_INCREMENTAL_SPEEDUP_MIN = 3
/** 定向扫描摘要相对「全文逐行切分」参考实现的加速比下限（判别力：预算能捕获旧实现） */
export const SUMMARY_SPEEDUP_MIN = 8
/** 增量 markdown 相对整段重渲的加速比下限 */
export const MARKDOWN_INCREMENTAL_SPEEDUP_MIN = 3
/** 内容键 memo 高亮相对「直接调 Prism」的加速比下限（判别力：预算能捕获去掉缓存的回归） */
export const HIGHLIGHT_MEMO_SPEEDUP_MIN = 20