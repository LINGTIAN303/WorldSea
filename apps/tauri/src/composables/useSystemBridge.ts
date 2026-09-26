// 系统层桥：托盘事件监听 + 状态同步 + 系统通知 + 开机自启
//
// 架构约定（前后端契约）：前端只通过 invoke 命令与 Rust 通信，不直接触碰系统 API。
// - Rust → 前端：tray:open-agent / tray:open-settings / tray:new-project / tray:open-project
//   （由托盘菜单触发，本桥监听后分发到全局事件或直接调用）
// - 前端 → Rust：cmd_tray_set_recent_projects / cmd_tray_set_agent_state / cmd_notify
//   / cmd_autostart_*（状态回写与系统能力调用）
//
// 为什么需要状态回写：项目列表与 Agent 流式状态都在前端（ProjectManager / useAgent），
// Rust 原生菜单无法读取 Vue 状态，故前端在状态变化时调用命令，Rust 重建托盘菜单。

import { invoke, listen, type UnlistenFn } from './transport'
import { isTauri, hasTauriInvoke } from '@worldsea/entity-core/core'
import { useProjectSwitcher } from './useProjectSwitcher'
import { switchShell } from './shellSwitch'

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

  /** 回写 Agent 生成状态（托盘「Agent 生成中… / 空闲」状态项） */
  function setAgentState(streaming: boolean): void {
    if (!canUseTauri()) return
    invoke('cmd_tray_set_agent_state', { streaming }).catch(() => {})
  }

  /** 发系统通知（Agent 长任务完成/失败等） */
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

  /** 切到 Agent 面（托盘「打开 Agent 对话」）：新壳里 = 显示 dsh 主窗（壳桥切换），无桥回退页内 space 壳 */
  function openAgentView(): void {
    switchShell('space')
  }

  /** 挂载托盘事件监听 + 初始同步（应用启动时调用一次，幂等） */
  async function setup(): Promise<void> {
    if (!canUseTauri() || setupDone) return
    setupDone = true

    unlisteners.push(
      await listen('tray:open-agent', () => openAgentView()),
      await listen('tray:open-settings', () => {
        window.dispatchEvent(new CustomEvent('ws-open-settings'))
      }),
      await listen('tray:new-project', () => {
        window.dispatchEvent(new CustomEvent('ws-open-project-manager'))
      }),
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
  }

  return {
    setup,
    syncRecentProjects,
    setAgentState,
    notify,
    autostartEnabled,
    setAutostart,
    openAgentView,
  }
}
