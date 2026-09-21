/**
 * useSessionTree 路径归一化契约（W1 · 2026-09-18 工作区与环境对齐 dsh）
 *
 * 背景：后端 workdir / workspace root 现为规范化形态（canonicalize + 分隔符统一 `/`，
 * 见 `crates/agent-commands/src/workspace_path.rs`），存量数据仍可能是 `\` 原生形态。
 * 本测试锁定「分组 / label / 默认目录匹配」对分隔符与尾分隔符不敏感——
 * 新旧数据共存时不得分裂成重复组。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useSessionTree, type SidebarItem, type WorkdirRecord } from '../useSessionTree'

function item(id: string, workdir?: string): SidebarItem {
  return { id, name: id, messageCount: 0, createdAt: 1, pinned: false, workdir }
}

describe('useSessionTree 路径归一化（W1）', () => {
  it('同一目录的不同分隔符 / 尾分隔符写法归入同一组', () => {
    const list = ref<SidebarItem[]>([
      item('a', 'C:\\proj\\one'),
      item('b', 'C:/proj/one'),
      item('c', 'C:/proj/one/'),
    ])
    const { sessionGroups } = useSessionTree(list, ref<WorkdirRecord[]>([]), ref(''))
    expect(sessionGroups.value).toHaveLength(1)
    expect(sessionGroups.value[0].sessions.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('默认目录匹配对分隔符不敏感', () => {
    const list = ref<SidebarItem[]>([item('a', 'C:\\ws\\agent')])
    const { sessionGroups } = useSessionTree(list, ref<WorkdirRecord[]>([]), ref('C:/ws/agent'))
    expect(sessionGroups.value[0].isDefault).toBe(true)
    expect(sessionGroups.value[0].label).toBe('默认工作区')
  })

  it('目录实体 label 匹配对分隔符 / 尾分隔符不敏感', () => {
    const list = ref<SidebarItem[]>([item('a', 'C:\\ws\\proj')])
    const dirs = ref<WorkdirRecord[]>([
      { id: 'd1', path: 'C:/ws/proj/', label: '项目A', createdAt: 0 },
    ])
    const { sessionGroups } = useSessionTree(list, dirs, ref(''))
    expect(sessionGroups.value[0].label).toBe('项目A')
  })
})