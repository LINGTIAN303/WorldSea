/**
 * 供应商官方彩色 SVG 图标映射
 * - 大部分来自 @lobehub/icons-static-svg 本地 vendor（彩色 -color.svg）
 * - 其无彩色/缺失者由用户提供的本地官方图标补齐（icons/ 目录）
 * 仍缺失（dots/xfyun）→ ProviderLogo 走品牌色王形。
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
// —— 用户提供的本地官方图标（补 static-svg 无彩色/缺失的供应商）——
import openai from './icons/openai.svg'
import anthropic from './icons/anthropic.svg'
import groq from './icons/groq.svg'
import mimo from './icons/xiaomimimo.svg'
import siliconflow from './icons/siliconcloud-color.svg'
import agnes from './icons/agnesai.svg'

/** provider id → 官方彩色图标 URL；未收录（dots/xfyun）返回 undefined，由调用方回退到品牌色王形 */
const ICONS: Record<string, string> = {
  openai,
  anthropic,
  groq,
  mimo,
  siliconflow,
  agnes,
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
  // dots / xfyun 无官方图标资源 → 走王形兜底
}

/** 取供应商官方彩色图标 URL；无则返回 undefined */
export function providerIconUrl(id: string): string | undefined {
  if (!id) return undefined
  return ICONS[id.toLowerCase()]
}