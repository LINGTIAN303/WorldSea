/**
 * 世界观芽说明渲染（纯函数）
 *
 * 两级输出：
 * - 清单（renderSproutList）：芽名 + id + 一句话定位（不含说明全量——渐进披露第一级）
 * - 说明（renderSproutGuide）：概述（手写数据）+ 动作目录（自 SPROUT_ACTIONS 自动生成，杜绝双份漂移）
 */
import type { WorldviewSprout } from './registry'
import { SPROUT_ACTIONS } from './actions'
import { SPROUT_GUIDES } from './guides'

/** 芽名清单（渐进披露第一级；不披露各芽说明） */
export function renderSproutList(sprouts: WorldviewSprout[]): string {
  return JSON.stringify({
    ok: true,
    count: sprouts.length,
    sprouts: sprouts.map(s => ({
      sprout: s.name,
      id: s.id,
      summary: s.description,
    })),
    usage: '指定 sprout 获取该芽的使用方法；再指定 action 执行动作',
  })
}

/** 单个芽的使用方法（概述 + 动作目录） */
export function renderSproutGuide(sprout: WorldviewSprout): string {
  const guide = SPROUT_GUIDES[sprout.id]
  const table = SPROUT_ACTIONS[sprout.id]
  const lines: string[] = []

  lines.push(`# ${sprout.name}（${sprout.id}）`)
  lines.push('')
  lines.push(guide?.overview?.trim() || sprout.description || '（暂无详述）')

  if (table && Object.keys(table).length > 0) {
    lines.push('', '## 动作', '')
    for (const action of Object.values(table)) {
      let line = `- **${action.name}**：${action.description}`
      const paramEntries = action.params ? Object.entries(action.params) : []
      if (paramEntries.length > 0) {
        const parts = paramEntries.map(
          ([key, p]) => `${key}${p.required ? '（必填）' : ''}：${p.description}`,
        )
        line += `\n  - 参数：${parts.join('；')}`
      } else {
        line += '\n  - 参数：无'
      }
      lines.push(line)
    }
    lines.push('', `执行方式：worldview(sprout='${sprout.name}', action='<动作名>', params={...})`)
  } else {
    lines.push(
      '',
      '## 动作',
      '',
      '该芽无专属动作；其实体通过通用工具读写（entity_list / entity_get / entity_create / entity_update / relation_list / relation_create）。',
    )
  }

  return lines.join('\n')
}
