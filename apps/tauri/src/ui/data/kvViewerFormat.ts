/**
 * [E 项·键值项只读浏览器] 纯函数模块：体积口径 + 值格式化。
 * 独立成模块便于单测（纯数据入参，无 pinia/组件依赖）。
 */

const encoder = new TextEncoder()

/** 键值体积口径：值字符串的 UTF-8 字节数（落盘 JSON 转义后略大，此处标注为估算） */
export function kvValueBytes(value: string): number {
  return encoder.encode(value).length
}

/** 值格式化：对象/数组型 JSON 做缩进美化便于阅读；标量与解析失败按原文返回 */
export function prettyKvValue(value: string): { isJson: boolean; text: string } {
  // 超大值跳过美化（解析+缩进的额外内存不值得，阅读场景允许原文展示）
  if (value.length > 200_000) return { isJson: false, text: value }
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object') {
      return { isJson: true, text: JSON.stringify(parsed, null, 2) }
    }
  } catch {
    // 非 JSON，原样展示
  }
  return { isJson: false, text: value }
}

/** 条目体积展示（与存储概览卡 formatSize 同口径：KB/MB 一位小数） */
export function formatKvBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
