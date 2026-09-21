/**
 * 世界观芽登记表（运行时）
 *
 * 「芽名随已有芽的注册」的实现：apps 侧 bootstrap 在芽激活时登记
 * （id 为稳定键；name/description 实时取登记值）——
 * 改芽名 / 增删芽 → worldview 工具返回的清单自动跟随。
 */

export interface WorldviewSprout {
  /** 芽 id（official.xxx，稳定键） */
  id: string
  /** 芽名（随芽注册） */
  name: string
  /** 一句话定位（随芽注册） */
  description: string
}

const sprouts = new Map<string, WorldviewSprout>()

/** 登记（幂等；重复登记同 id 即更新——名字变更随之生效） */
export function registerWorldviewSprout(sprout: WorldviewSprout): void {
  sprouts.set(sprout.id, {
    id: sprout.id,
    name: sprout.name,
    description: sprout.description,
  })
}

/** 全部已登记芽（登记顺序） */
export function listWorldviewSprouts(): WorldviewSprout[] {
  return [...sprouts.values()]
}

/**
 * 按输入解析芽：支持完整 id（official.outline）/ 短 id（outline）/ 芽名（大纲）。
 * 实时扫描（27 条量级），保证改名即时生效。
 */
export function resolveWorldviewSprout(input: string): WorldviewSprout | undefined {
  const q = input.trim()
  if (!q) return undefined
  const qLower = q.toLowerCase()
  for (const s of sprouts.values()) {
    if (s.id === q) return s
    if (s.id.replace(/^official\./, '').toLowerCase() === qLower) return s
    if (s.name === q) return s
  }
  return undefined
}

/** 清空登记（仅测试用；生产路径由 bootstrap 登记） */
export function clearWorldviewSprouts(): void {
  sprouts.clear()
}
