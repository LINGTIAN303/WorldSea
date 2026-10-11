// @vitest-environment jsdom
/**
 * 工作区横幅注入脚本（apps/tauri/src-tauri/src/dsh_workspace_notice.js）的 jsdom 测试。
 *
 * 为什么直测这份 JS：横幅是「工作区不可供给」时唯一的一等用户交互面（修复 / 忽略），
 * Rust 侧 `include_str!` 注入同一份源码但看不见 DOM 行为与样式；本件同时锁样式契约——
 * 吃 dsh 设计令牌（--dsw-*，缺省时回退自包含色值）+ 让位壳级窗口栏
 * （`--dsh-windows-titlebar-height` 32px，全屏 `html[data-fullscreen]` 归零）。
 * 每个断言都对一处变异敏感（反证口径）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

// jsdom 环境下 import.meta.url 不是 file: 形态，按仓根拼路径（vitest 从仓根运行）
const SOURCE = readFileSync(
  join(process.cwd(), 'apps/tauri/src-tauri/src/dsh_workspace_notice.js'),
  'utf8',
)

const MESSAGE = '工作区不可供给：D:\\A（修复：icacls ...）'

interface InvokeCall {
  readonly command: string
  readonly args?: Record<string, unknown>
}

let calls: InvokeCall[] = []
let fixOutcome: () => unknown = () => ({ label: 'pwsh', note: '恢复命令已写入 .acl-recovery' })

function evalScript(message: string): void {
  ;(globalThis as { __WORLDSEA_WORKSPACE_NOTICE__?: string }).__WORLDSEA_WORKSPACE_NOTICE__ = message
  new Function(SOURCE)()
}

function stubIpc(): void {
  calls = []
  ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args })
      return Promise.resolve().then(() => fixOutcome())
    },
  }
}

function notice(): HTMLElement {
  const element = document.getElementById('worldsea-workspace-notice')
  if (element === null) throw new Error('缺 #worldsea-workspace-notice（横幅未挂载）')
  return element
}

function styleCss(): string {
  const element = document.getElementById('worldsea-workspace-notice-style')
  if (element === null) throw new Error('缺 #worldsea-workspace-notice-style（样式未挂载）')
  return element.textContent ?? ''
}

function part(root: HTMLElement, className: string): HTMLElement {
  const element = root.querySelector<HTMLElement>('.' + className)
  if (element === null) throw new Error(`横幅内缺 .${className}`)
  return element
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  document.querySelectorAll('#worldsea-workspace-notice, #worldsea-workspace-notice-style').forEach(el => el.remove())
  document.head.innerHTML = ''
  if (document.body === null) document.documentElement.appendChild(document.createElement('body'))
  document.body.innerHTML = ''
  fixOutcome = () => ({ label: 'pwsh', note: '恢复命令已写入 .acl-recovery' })
  stubIpc()
})

describe('工作区横幅（worldsea-shell:workspace-notice）', () => {
  it('无文案不注入；有文案 → 横幅与样式挂载', () => {
    evalScript('')
    expect(document.getElementById('worldsea-workspace-notice')).toBeNull()

    evalScript(MESSAGE)
    const box = notice()
    expect(part(box, 'wsn-text').textContent).toContain('D:\\A')
    expect(styleCss().length).toBeGreaterThan(0)
  })

  it('body 未就绪（head 注入时序）→ 先挂 html，DOMContentLoaded 后迁入 body', () => {
    document.body?.remove()
    evalScript(MESSAGE)
    expect(notice().parentElement?.tagName).toBe('HTML')
    document.documentElement.appendChild(document.createElement('body'))
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(notice().parentElement).toBe(document.body)
  })

  it('样式契约：dsh 令牌 + 窗口栏让位 + 全屏归零', () => {
    evalScript(MESSAGE)
    const css = styleCss()
    // 让位壳级窗口栏（32px 兜底）；全屏时窗口栏隐藏 → 归零
    expect(css).toContain('top:var(--dsh-windows-titlebar-height,32px)')
    expect(css).toContain('html[data-fullscreen] #worldsea-workspace-notice{top:0}')
    // 警告面配色取 dsh 原生令牌（标签 / 底 / 主色按钮 / 字体）
    expect(css).toContain('var(--dsw-alias-state-warn-tertiary,')
    expect(css).toContain('var(--dsw-alias-state-warn-label,')
    expect(css).toContain('var(--dsw-alias-button-primary-fill,')
    expect(css).toContain('var(--dsw-font-family,')
  })

  it('修复按钮：点击才执行；成功回执替换文案并隐去按钮', async () => {
    evalScript(MESSAGE)
    const box = notice()
    const fix = part(box, 'wsn-fix')
    expect(calls.length).toBe(0)
    click(fix)
    await flush()
    expect(calls.map(call => call.command)).toContain('cmd_fix_workspace_acl')
    expect(part(box, 'wsn-text').textContent).toContain('已修复（pwsh）')
    expect(part(box, 'wsn-text').textContent).toContain('恢复命令已写入 .acl-recovery')
    expect(fix.style.display).toBe('none')
  })

  it('修复失败：回显错误 + 原提示，按钮可重试', async () => {
    fixOutcome = () => {
      throw new Error('boom')
    }
    evalScript(MESSAGE)
    const box = notice()
    const fix = part(box, 'wsn-fix')
    click(fix)
    await flush()
    expect(part(box, 'wsn-text').textContent).toContain('修复失败')
    expect(part(box, 'wsn-text').textContent).toContain('boom')
    expect(part(box, 'wsn-text').textContent).toContain(MESSAGE)
    expect(fix.textContent).toBe('重试')
    expect(fix.disabled).toBe(false)
  })

  it('忽略：移除横幅', () => {
    evalScript(MESSAGE)
    const box = notice()
    click(part(box, 'wsn-dismiss'))
    expect(document.getElementById('worldsea-workspace-notice')).toBeNull()
  })
})
