/**
 * 交互元数据与 UX 批跨栈守卫（UX-b，2026-09-22）
 *
 * 守的是「契约加了字段、装配没填、前端没读」这类**单侧恒绿**的断裂：
 * 单测各自过（契约测序列化、前端测弹窗），中间的命令名 / 字段名 / 装配链无人核对。
 *
 * 【结构约束】纯源码扫描，不导入被测模块（避免 jsdom 下拉起 Tauri/Vue 运行时）；
 * 断言方向均为「以 Rust 侧定义为准，要求前端与装配跟齐」，改一端即报红。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../../..')
const LIB = 'apps/tauri/src-tauri/src/lib.rs'
const ENGINE_INTERACTION = 'crates/agent-engine/src/contracts/interaction.rs'
const KERNEL_TOOLS = 'crates/agent-kernel/src/agent/tools.rs'
const USE_AGENT = 'apps/tauri/src/agent/composables/useAgentRust.ts'
const PROJECT_RULES = 'apps/tauri/src/agent/panels/ProjectRulesSection.vue'
const SETTINGS_PANEL = 'apps/tauri/src/agent/AgentSettingsPanel.vue'

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

describe('审批载荷元数据（UX-b）：契约 → 装配 → 前端消费三段齐全', () => {
  it('契约 Permission 变体带 risk_level / side_effect_scope（default 兼容旧载荷）', () => {
    const variant = /Permission \{([\s\S]*?)\n    \},/.exec(read(ENGINE_INTERACTION))?.[1]
    expect(variant).toBeTruthy()
    expect(variant).toContain('risk_level: Option<String>')
    expect(variant).toContain('side_effect_scope: Option<String>')
    expect(variant).toContain('skip_serializing_if = "Option::is_none"')
  })

  it('kernel 装配从 descriptor 取线面串并随审批请求下发', () => {
    const src = read(KERNEL_TOOLS)
    expect(src).toContain('.safety.risk_level.as_str()')
    expect(src).toContain('.safety.side_effect_scope.as_str()')
    expect(src).toContain('request_permission(&self.broadcaster, name, args.clone(), risk_level, scope)')
  })

  it('前端 payload 镜像含两字段且弹窗消费（元数据行 + 中文显示名）', () => {
    const src = read(USE_AGENT)
    expect(src).toContain('risk_level?: string')
    expect(src).toContain('side_effect_scope?: string')
    expect(src).toContain('formatToolMeta(payload.risk_level, payload.side_effect_scope)')
    expect(src).toContain('getToolLabel(toolName)')
  })
})

describe('会话级授权按钮（UX-b）：命令名与后端注册对齐', () => {
  it('弹窗附加动作调用 grant_session_permission（工具级全量）且命令已注册', () => {
    const src = read(USE_AGENT)
    expect(src).toContain("'grant_session_permission'")
    expect(src).toContain('本会话总是允许')
    expect(src).toContain('once: false')
    expect(src).toContain('content: null')
    expect(read(LIB)).toContain('commands::grant_session_permission,')
  })
})

describe('项目规则编辑（UX-b）：组件已挂载且命令可达', () => {
  it('ProjectRulesSection 调用三命令且后端注册在位', () => {
    const src = read(PROJECT_RULES)
    for (const cmd of ['reload_project_rules', 'cmd_fs_read', 'cmd_fs_write']) {
      expect(src).toContain(`'${cmd}'`)
    }
    expect(read(LIB)).toContain('commands::reload_project_rules,')
  })

  it('双渲染路径都已挂载 ProjectRulesSection（防「组件写了没挂」/「只挂一条路径」）', () => {
    const src = read(SETTINGS_PANEL)
    expect(src).toContain("import ProjectRulesSection from './panels/ProjectRulesSection.vue'")
    // 路径①：embedded 卡片流的安全卡（idx === 4）——用户日常路径（设置对话框）
    const embeddedCard = /idx === 4[\s\S]*?idx === 5/.exec(src)?.[0]
    expect(embeddedCard).toBeTruthy()
    expect(embeddedCard).toContain('<ProjectRulesSection')
    // 路径②：非 embedded 的 safety 子面板
    const subPanel = /settingsSubPanel === 'safety'[\s\S]*?settingsSubPanel === 'persona'/.exec(src)?.[0]
    expect(subPanel).toBeTruthy()
    expect(subPanel).toContain('<ProjectRulesSection')
  })
})

describe('UX-a 请求边界命令：注册在位（防未来删注册）', () => {
  it('list_request_boundaries 在 Tauri handler 注册', () => {
    expect(read(LIB)).toContain('commands::list_request_boundaries,')
  })
})
