/**
 * 工具目录（R 批 · R-0 分派基座）
 *
 * 拉取 `cmd_agent_tool_catalog`（Rust descriptor 投影：category / 读写语义 / MCP 归属），
 * 建 name → 条目映射并经 `provide` 下发；shared-ui 行段组件用 `useToolClass()` 注入消费。
 *
 * 刷新时机：① 会话切换（`activeSessionId` 变化）② MCP 工具集变化（`mcp:status` 事件）。
 * 降级口径：命令失败 / 草稿态无会话 → 目录保持为空，行段按静态规则分派——
 * **目录只是「更好的类归属」，不是渲染的前置条件，不弹错、不阻断**。
 *
 * 设计依据：docs/plans/2026-09-21-ZCode能力内化方向探究/18-对话区行段渲染批草案.md §5.1。
 */
import { provide, ref, watch, type Ref } from 'vue'

import { TOOL_CATALOG_KEY } from '@worldsea/shared-ui/agent/stream/rows/toolCatalogContext'
import type { ToolCatalogEntryView } from '@worldsea/shared-ui/agent/stream/rows/toolClassify'

import { invoke, listen } from './transport'
import { useSessionViewState } from './useSessionViewState'

/** 模块级单例：跨组件共享同一份目录，会话切换时整体替换 */
const catalog: Ref<ReadonlyMap<string, ToolCatalogEntryView>> = ref(new Map())
let loadedForSession: string | null = null

async function loadCatalog(sessionId: string): Promise<void> {
  try {
    const list = await invoke<ToolCatalogEntryView[]>('cmd_agent_tool_catalog', { sessionId })
    catalog.value = new Map(list.map((e) => [e.name, e]))
    loadedForSession = sessionId
  } catch {
    // 草稿态 / 会话尚未在服务层创建 → 保持空目录（静态规则兜底）
  }
}

/** 工具集可能已变化（MCP 重连 / 热注入）→ 失效缓存并重拉 */
function invalidateCatalog(): void {
  const sid = loadedForSession
  loadedForSession = null
  if (sid) void loadCatalog(sid)
}

export function useToolCatalog() {
  const { activeSessionId } = useSessionViewState()

  /** 在应用壳 setup 调用一次：provide 目录 + 接线刷新时机 */
  function provideToolCatalog(): void {
    provide(TOOL_CATALOG_KEY, catalog)
    watch(
      activeSessionId,
      (sid) => {
        if (sid) {
          void loadCatalog(sid)
        } else {
          catalog.value = new Map()
          loadedForSession = null
        }
      },
      { immediate: true },
    )
    void listen('mcp:status', () => invalidateCatalog())
  }

  return { catalog, provideToolCatalog, loadCatalog }
}
