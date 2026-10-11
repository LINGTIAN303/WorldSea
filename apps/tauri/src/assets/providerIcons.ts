/**
 * 供应商品牌图标 — 本地 SVG + CDN 降级
 *
 * 图标来源：@lobehub/icons（https://lobehub.com/icons）
 * 本地 SVG 文件在 src/assets/provider-icons/ 目录下，
 * 通过 Vite 的静态资源导入机制引用，无需网络请求。
 * CDN 降级仅在本地文件缺失时使用。
 */

// 本地 SVG 文件导入（Vite 会处理为 URL）
import anthropicIcon from './provider-icons/anthropic-color.svg'
import openaiIcon from './provider-icons/openai-color.svg'
import googleIcon from './provider-icons/google-color.svg'
import deepseekIcon from './provider-icons/deepseek-color.svg'
import groqIcon from './provider-icons/groq-color.svg'
import openrouterIcon from './provider-icons/openrouter-color.svg'
import zhipuIcon from './provider-icons/zhipu-color.svg'
import qwenIcon from './provider-icons/qwen-color.svg'
import minimaxIcon from './provider-icons/minimax-color.svg'
import kimiIcon from './provider-icons/moonshot-color.svg'
import agnesIcon from './provider-icons/agnes-color.svg'
import sensenovaIcon from './provider-icons/sensenova-color.svg'
import doubaoIcon from './provider-icons/doubao-color.svg'
import xaiIcon from './provider-icons/xai-color.svg'
import mistralIcon from './provider-icons/mistral-color.svg'
import stepfunIcon from './provider-icons/stepfun-color.svg'
// 新增供应商（2026-08-23）
// 六家有官方 SVG（tencentcloud/longcat/bailian/modelscope/kling）；四家（mimo/xfyun/dots/siliconflow）
// CDN 无官方图标，复用本地通用占位 provider-placeholder.svg，避免外部 CDN 跨域（ORB）依赖。
import placeholderIcon from './provider-icons/provider-placeholder.svg'
import tencentcloudIcon from './provider-icons/tencentcloud-color.svg'
import longcatIcon from './provider-icons/longcat-color.svg'
import bailianIcon from './provider-icons/bailian-color.svg'
import modelscopeIcon from './provider-icons/modelscope-color.svg'
import klingIcon from './provider-icons/kling-color.svg'

/** 供应商 key → 本地 SVG URL 映射 */
const LOCAL_ICONS: Record<string, string> = {
  anthropic: anthropicIcon,
  openai: openaiIcon,
  google: googleIcon,
  deepseek: deepseekIcon,
  groq: groqIcon,
  openrouter: openrouterIcon,
  zhipu: zhipuIcon,
  qwen: qwenIcon,
  minimax: minimaxIcon,
  kimi: kimiIcon,
  agnes: agnesIcon,
  sensenova: sensenovaIcon,
  doubao: doubaoIcon,
  xai: xaiIcon,
  mistral: mistralIcon,
  stepfun: stepfunIcon,
  // 新增供应商
  mimo: placeholderIcon,
  xfyun: placeholderIcon,
  dots: placeholderIcon,
  siliconflow: placeholderIcon,
  tencentcloud: tencentcloudIcon,
  longcat: longcatIcon,
  bailian: bailianIcon,
  modelscope: modelscopeIcon,
  kling: klingIcon,
}

/** CDN 降级 URL 基础路径（已弃用——全部供应商走本地 SVG 或占位，避免外部 CDN 跨域） */
// const CDN_BASE = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons'

/**
 * 获取供应商品牌图标 URL
 * 优先使用本地 SVG（含新增供应商本地文件与占位），未知/未登记供应商一律返回本地占位图，
 * 避免对 unpkg 等外部 CDN 发起跨域请求（浏览器 ORB 会拦截，且离线环境失败）。
 */
export function getProviderIconUrl(provider: string): string {
  return LOCAL_ICONS[provider] || placeholderIcon
}

/** 检查供应商是否有对应的品牌图标 */
export function hasProviderIcon(provider: string): boolean {
  return provider in LOCAL_ICONS
}

/** 获取所有支持品牌图标的供应商 key 列表 */
export function getProvidersWithIcons(): string[] {
  return Object.keys(LOCAL_ICONS)
}
