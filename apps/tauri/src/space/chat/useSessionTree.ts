/**
 * useSessionTree — Phase 3：会话列表「目录组 → 会话」两级树分组
 *
 * 输入：扁平会话列表（含 workdir）+ 目录实体列表（workdirs）+ 默认目录路径。
 * 输出：两级树结构 sessionGroups（默认工作区组置顶、可按目录折叠），供 SessionSidebar 渲染。
 *
 * 分组规则：
 * - 与默认目录一致的会话 → 置顶「默认工作区」组
 * - 其他 workdir：匹配目录实体得 label；未匹配用路径基名兜底建临时组
 * - 组内固定会话置顶，其余按创建时间倒序
 */
import { ref, computed, type Ref } from 'vue'
import { SCENE_SLIDER_OPTIONS } from './scenes'

/** 场景工作区根目录名 → 中文场景名（分组 label 兜底：hint 是后端 workspace_hint 的静态镜像） */
const SCENE_ROOT_LABELS = new Map(SCENE_SLIDER_OPTIONS.map((s) => [s.hint, s.label]))

/** 目录实体（WorkdirRecord，camelCase，镜像 Rust agent_commands::WorkdirRecord） */
export interface WorkdirRecord {
  id: string
  path: string
  label: string
  createdAt: number
}

/** 侧边栏会话条目（已渲染形态，含 workdir 供分组） */
export interface SidebarItem {
  id: string
  name: string
  messageCount: number
  createdAt: number
  pinned: boolean
  workdir?: string
}

/** 目录组（两级树外层）：workdir 归一化的目录条目 + 其下会话条目 */
export interface SessionGroup {
  workdir: string
  label: string
  isDefault: boolean
  /** 折叠状态（ref，独立于计算，折叠态跨 recompute 保持） */
  collapsed: Ref<boolean>
  sessions: SidebarItem[]
}

/** 归一化路径（统一分隔符为 `/` + 去除尾部 `/` 与 `\`，避免 Windows/Linux 及混用差异影响分组）
 *
 * W1（2026-09-18 工作区与环境对齐 dsh）：后端 workdir/workspace root 现统一为 `/` 形态
 * （`agent-commands::workspace_path`），此处同步做分隔符归一，保证新旧数据分组一致。 */
function normalizePath(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/\/+$/g, '')
}

/** 取路径基名（兼容 / 与 \ 两种分隔符；空路径回退原始字符串） */
function baseName(p: string): string {
  const segs = p.split(/[\\/]/).filter(Boolean)
  return segs[segs.length - 1] ?? p
}

/**
 * 把扁平会话列表按 workdir 聚合为两级树
 *
 * @param sessionList  扁平会话列表（过滤后的即可，支持搜索态）
 * @param workdirs     目录实体列表（标签来源）
 * @param defaultDir   默认目录路径（与 workspace.ts resolveWorkspaceDir 默认值一致）
 */
export function useSessionTree(
  sessionList: Ref<SidebarItem[]>,
  workdirs: Ref<WorkdirRecord[]>,
  defaultDir: Ref<string>,
) {
  const defaultDirNorm = computed(() => normalizePath(defaultDir.value))
  // 折叠状态按归一化 workdir 持久化，跨 computed 重算不丢失
  const collapsedState = new Map<string, Ref<boolean>>()

  function getCollapsed(wd: string): Ref<boolean> {
    let r = collapsedState.get(wd)
    if (!r) {
      // 默认展开，避免新建会话被折叠隐藏
      r = ref(false)
      collapsedState.set(wd, r)
    }
    return r
  }

  const sessionGroups = computed<SessionGroup[]>(() => {
    const defaultNorm = defaultDirNorm.value
    // workdir 归一化路径 → 目录实体 label
    const workdirLabel = new Map<string, string>()
    for (const w of workdirs.value) workdirLabel.set(normalizePath(w.path), w.label)

    // 按 workdir 聚合会话
    const byWorkdir = new Map<string, SidebarItem[]>()
    for (const s of sessionList.value) {
      const wd = s.workdir ? normalizePath(s.workdir) : ''
      const arr = byWorkdir.get(wd)
      if (arr) arr.push(s)
      else byWorkdir.set(wd, [s])
    }

    const groups: SessionGroup[] = []
    for (const [wd, items] of byWorkdir.entries()) {
      const isDefault = defaultNorm !== '' && wd === defaultNorm
      let label: string
      if (isDefault) {
        label = '默认工作区'
      } else {
        // label 链：目录实体 > 场景根中文场景名 > 路径基名
        label = wd ? workdirLabel.get(wd) ?? SCENE_ROOT_LABELS.get(baseName(wd)) ?? baseName(wd) : '未限定目录'
      }
      // 组内排序：固定置顶，其余按创建时间倒序
      const sessions = [...items].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt,
      )
      groups.push({ workdir: wd, label, isDefault, collapsed: getCollapsed(wd), sessions })
    }
    // 默认工作区置顶，其余按 label 字典序
    groups.sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label),
    )
    return groups
  })

  /** 切换目录组折叠状态 */
  function toggleGroup(g: SessionGroup): void {
    g.collapsed.value = !g.collapsed.value
  }

  /** 判断某路径是否为默认目录（供外部判断/高亮） */
  function isDefaultDir(p: string): boolean {
    return defaultDirNorm.value !== '' && normalizePath(p) === defaultDirNorm.value
  }

  return { sessionGroups, toggleGroup, isDefaultDir }
}