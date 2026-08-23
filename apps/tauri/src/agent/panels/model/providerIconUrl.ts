/**
 * 供应商官方彩色 SVG 图标映射（来源：@lobehub/icons-static-svg 本地 vendor）
 *
 * 优先用彩色 `-color.svg`（部分缺彩色/no 变体的：anthropic/openai/xai/grok/agnes 无彩色静态；
 * mimo/siliconflow/dots 无任何静态 → 抛给 ProviderLogo 走品牌色王形，保证全部有颜色、无黑色）。
 * 命名对照：agnes→agnesai、qwen→qwen、xai→xai（同名），alibabacloud 为阿里云。
 */
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg'
import tencentcloud from '@lobehub/icons-static-svg/icons/tencentcloud-color.svg'
import stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg'
import sensenova from '@lobehub/icons-static-svg/icons/sensenova-color.svg'
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg'
import openrouter from '@lobehub/icons-static-svg/icons/openrouter-color.svg'
import modelscope from '@lobehub/icons-static-svg/icons/modelscope-color.svg'
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg'
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg'
import longcat from '@lobehub/icons-static-svg/icons/longcat-color.svg'
import kling from '@lobehub/icons-static-svg/icons/kling-color.svg'
import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg'
import google from '@lobehub/icons-static-svg/icons/google-color.svg'
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import bailian from '@lobehub/icons-static-svg/icons/bailian-color.svg'
import chatglm from '@lobehub/icons-static-svg/icons/chatglm-color.svg'
import alibabacloud from '@lobehub/icons-static-svg/icons/alibabacloud-color.svg'
import bytedance from '@lobehub/icons-static-svg/icons/bytedance-brand-color.svg'

/** provider id → 官方彩色图标 URL；未收录（无彩色静态/完全缺失）返回 undefined，由调用方回退到品牌色王形 */
const ICONS: Record<string, string> = {
  zhipu,
  tencentcloud,
  stepfun,
  sensenova,
  qwen,
  openrouter,
  modelscope,
  mistral,
  minimax,
  longcat,
  kling,
  kimi,
  google,
  doubao,
  deepseek,
  bailian,
  chatglm,
  alibabacloud,
  bytedance,
  // 注意：anthropic/openai/xai/grok/agnes 无彩色静态；mimo/siliconflow/dots 无静态 → 不在此映射，走王形兜底
}

/** 取供应商官方彩色图标 URL；无则返回 undefined */
export function providerIconUrl(id: string): string | undefined {
  if (!id) return undefined
  return ICONS[id.toLowerCase()]
}