/**
 * 工作区回滚跨栈守卫（W 批，2026-09-23）
 *
 * 守的是「记录链 / 回滚链 / 命令注册 / 前端编排」四处齐备——任一环缺失都属
 * 单侧恒绿的接线断裂（UX 批走查教训：恒绿≠守住）。
 *
 * 【结构约束】纯源码扫描，不导入被测模块。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../../..')
const LIB = 'apps/tauri/src-tauri/src/lib.rs'
const COMMANDS = 'apps/tauri/src-tauri/src/commands.rs'
const FS_TOOLS = 'crates/agent-commands/src/fs_tools.rs'
const CMDS_LIB = 'crates/agent-commands/src/lib.rs'
const TOOL_CONTEXT = 'crates/agent-kernel/src/tool_context.rs'
const USE_BRANCH = 'apps/tauri/src/agent/composables/useSessionBranch.ts'
const USE_CONFIRM = 'packages/ui-kit/src/composables/useConfirm.ts'
const DIALOG = 'apps/tauri/src/ui/WsConfirmDialog.vue'

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

describe('W 批：命令注册与前端调用', () => {
  it('rewind_workspace / list_workspace_ops 双侧注册在位', () => {
    const lib = read(LIB)
    expect(lib).toContain('commands::rewind_workspace,')
    expect(lib).toContain('commands::list_workspace_ops,')
    const cmds = read(COMMANDS)
    expect(cmds).toContain('pub async fn rewind_workspace')
    expect(cmds).toContain('pub async fn list_workspace_ops')
  })

  it('前端编排调用两命令且文件先于会话（useSessionBranch 源码序）', () => {
    const src = read(USE_BRANCH)
    const iFile = src.indexOf("'rewind_workspace'")
    const iSession = src.indexOf('await rewindAt(sessionId, requestSeq)')
    expect(iFile).toBeGreaterThan(-1)
    expect(iSession).toBeGreaterThan(-1)
    // 文件回滚必须先于会话回退
    expect(iFile).toBeLessThan(iSession)
    expect(src).toContain("'list_workspace_ops'")
  })
})

describe('W 批：记录链三挂点 + 装配注入齐备', () => {
  it('fs_tools 三处写入点都调 record_before（write / edit / edit_diff）', () => {
    const src = read(FS_TOOLS)
    const hooks = src.match(/rec\.record_before\(/g) ?? []
    // 三处写入点（write_file / edit_file / edit_diff）缺挂点即红
    expect(hooks.length).toBe(3)
    expect(src).toContain('"write").await')
    expect(src).toContain('"edit").await')
    expect(src).toContain('"edit_diff").await')
  })

  it('装配层按会话注入 recorder（with_file_op_recorder）', () => {
    expect(read(CMDS_LIB)).toContain('with_file_op_recorder')
    expect(read(CMDS_LIB)).toContain('WorkspaceFileOpRecorder::new')
  })

  it('内核契约：FileOpRecorder 随 ToolContext 传递（默认关闭=行为不变）', () => {
    const src = read(TOOL_CONTEXT)
    expect(src).toContain('pub trait FileOpRecorder')
    expect(src).toContain('pub file_op_recorder: Option<Arc<dyn FileOpRecorder>>')
  })
})

describe('W 批：回滚弹窗复选框链路', () => {
  it('useConfirm 支持 checkbox 且结果出口为 confirmWithCheckbox', () => {
    const src = read(USE_CONFIRM)
    expect(src).toContain('checkbox?: { label: string; defaultChecked?: boolean }')
    expect(src).toContain('confirmWithCheckbox')
  })

  it('WsConfirmDialog 渲染复选框（label + 勾选态双向绑定）', () => {
    const src = read(DIALOG)
    expect(src).toContain('state.checkboxLabel')
    expect(src).toContain('v-model="state.checkboxChecked"')
  })

  it('回滚弹窗默认带「同时回滚文件」复选框（默认勾选）', () => {
    const src = read(USE_BRANCH)
    expect(src).toContain('同时回滚文件')
    expect(src).toContain('defaultChecked: true')
  })
})
