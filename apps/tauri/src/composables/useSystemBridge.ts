// 系统层桥：托盘事件监听 + 状态同步 + 系统通知 + 开机自启
//
// 架构约定（前后端契约）：前端只通过 invoke 命令与 Rust 通信，不直接触碰系统 API。
// - Rust → 前端：tray:open-settings / tray:open-project
//   （由托盘菜单触发，本桥监听后分发到全局事件或直接调用；「打开工作台」壳内直切不派事件）
// - 前端 → Rust：cmd_tray_set_recent_projects / cmd_notify / cmd_autostart_*
//   （状态回写与系统能力调用）
// （2026-09-27 E8：旧 Agent 面退场，移除 Agent 生成状态回写与「打开 Agent 对话」分发）
// （2026-09-28 D2-b2：tray:new-project 随同源模型退役——项目 = dsh 工作区，在 dsh 侧管理）

import { invoke, listen, type UnlistenFn } from './transport'
import { isTauri, hasTauriInvoke } from '@worldsea/entity-core/core'
import { useProjectSwitcher } from './useProjectSwitcher'

/** Tauri 环境且 IPC 桥真正可用（预览/浏览器注入占位标志时桥缺失，需规避 invoke/listen 崩溃） */
const canUseTauri = () => isTauri() && hasTauriInvoke()

let setupDone = false
const unlisteners: UnlistenFn[] = []

export function useSystemBridge() {
  /** 将当前项目列表同步到托盘「最近项目」子菜单 */
  async function syncRecentProjects(): Promise<void> {
    if (!canUseTauri()) return
    try {
      const ps = useProjectSwitcher()
      const list = await ps.listProjects()
      await invoke('cmd_tray_set_recent_projects', {
        projects: list.map(p => ({ id: p.id, name: p.name })),
      })
    } catch (err) {
      console.error('[SystemBridge] 同步最近项目到托盘失败:', err)
    }
  }

  /** 发系统通知（长任务完成/失败等） */
  function notify(title: string, body: string): void {
    if (!canUseTauri()) return
    invoke('cmd_notify', { title, body }).catch(() => {})
  }

  /** 查询开机自启状态 */
  async function autostartEnabled(): Promise<boolean> {
    if (!canUseTauri()) return false
    try {
      return await invoke('cmd_autostart_is_enabled')
    } catch {
      return false
    }
  }

  /** 设置开机自启，返回是否成功 */
  async function setAutostart(enabled: boolean): Promise<boolean> {
    if (!canUseTauri()) return false
    try {
      await invoke('cmd_autostart_set_enabled', { enabled })
      return true
    } catch {
      return false
    }
  }

  /** 挂载托盘事件监听 + 初始同步（应用启动时调用一次，幂等） */
  async function setup(): Promise<void> {
    if (!canUseTauri() || setupDone) return
    setupDone = true

    unlisteners.push(
      await listen('tray:open-settings', () => {
        window.dispatchEvent(new CustomEvent('ws-open-settings'))
      }),
      // D2-b2：tray:new-project 已随同源模型退役（托盘改「打开工作台」，壳内直切不派事件）
      await listen<string>('tray:open-project', e => {
        const projectId = e.payload
        void useProjectSwitcher().switchProject(projectId)
      }),
    )

    // 项目列表变化（切换/删除/重命名/初始化）→ 同步托盘最近项目
    window.addEventListener('project:switched', () => {
      void syncRecentProjects()
    })
    void syncRecentProjects()

    // E9（2026-09-27）：页面就绪信号 → 壳补投积压的托盘动作（工作台窗懒创建期间点托盘
    // 不再丢事件；此时上方三条 listen 已挂好，补投必达）。旧壳无此命令时降级忽略。
    try {
      await invoke('cmd_tray_page_ready')
    } catch {
      /* 非壳环境或旧壳：积压补投是壳侧能力，非本桥硬依赖 */
    }
  }

  return {
    setup,
    syncRecentProjects,
    notify,
    autostartEnabled,
    setAutostart,
  }
}
