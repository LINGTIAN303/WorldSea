// @vitest-environment jsdom
/**
 * 窗口栏注入脚本（apps/tauri/src-tauri/src/dsh_titlebar.js）的行为测试（C6，2026-09-24）。
 *
 * 为什么要直测这份 JS：窗口栏是用户可见的一等壳件（拖拽 / 双击最大化 / 三控制按钮 / 壳切换占位页 /
 * ⋯ 菜单），且是注入到页面的**唯一**交互点——Rust 单测看不见它，故在此以 jsdom 载入同一份文件
 * （Rust 侧 include_str! 注入同一份源码）做行为断言，每个用例都对一处变异敏感（反证口径）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// jsdom 环境下 import.meta.url 不是 file: 形态，按仓根拼路径（vitest 从仓根运行）
const SOURCE = readFileSync(
  join(process.cwd(), 'apps/tauri/src-tauri/src/dsh_titlebar.js'),
  'utf8',
)

interface InvokeCall {
  readonly command: string
  readonly args: Record<string, unknown>
}

let calls: InvokeCall[] = []
let nextOutcome: () => unknown = () => ({ maximized: false })

function evalScript(): void {
  new Function(SOURCE)()
}

function stubIpc(): void {
  ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args })
      return Promise.resolve(nextOutcome())
    },
  }
}

function bar(): HTMLElement {
  const element = document.getElementById('worldsea-titlebar')
  if (element === null) throw new Error('缺 #worldsea-titlebar（窗口栏未挂载）')
  return element
}

function workbench(): HTMLElement {
  const element = document.getElementById('worldsea-workbench')
  if (element === null) throw new Error('缺 #worldsea-workbench（占位页未挂载）')
  return element
}

function reports(): string[] {
  return calls
    .filter(call => call.command === 'cmd_shell_bridge_report')
    .map(call => String(call.args.message))
}

function windowActions(): string[] {
  return calls
    .filter(call => call.command === 'cmd_shell_window_action')
    .map(call => String(call.args.action))
}

function mouseDown(target: Element, detail = 1): MouseEvent {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail })
  target.dispatchEvent(event)
  return event
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/* 必须先声明：本组完成真实安装，后续用例共享同一份已挂载的窗口栏（脚本幂等） */
describe('窗口栏：装配前置', () => {
  it('无 IPC（非壳环境）不注入——不置标记、不建 DOM、不置 dsh 适配属性', () => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    evalScript()
    expect((globalThis as { __WORLDSEA_TITLEBAR__?: unknown }).__WORLDSEA_TITLEBAR__).toBeUndefined()
    expect(document.getElementById('worldsea-titlebar')).toBeNull()
    expect(document.documentElement.hasAttribute('data-windows-titlebar')).toBe(false)
  })

  it('首装：标记 / dsh 适配属性与高度变量 / DOM / 挂载日志 / 初始最大化查询', async () => {
    calls = []
    stubIpc()
    evalScript()
    await flush()
    expect((globalThis as { __WORLDSEA_TITLEBAR__?: unknown }).__WORLDSEA_TITLEBAR__).toBe(true)
    expect(document.documentElement.getAttribute('data-windows-titlebar')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--dsh-windows-titlebar-height')).toBe('32px')
    expect(bar()).toBeTruthy()
    expect(workbench()).toBeTruthy()
    expect(workbench().classList.contains('wstb-open')).toBe(false)
    expect(reports().some(message => message.includes('窗口栏已挂载'))).toBe(true)
    expect(windowActions()).toContain('is-maximized')
  })

  it('幂等：重复求值不叠加（DOM 仍只有一份）', () => {
    evalScript()
    expect(document.querySelectorAll('#worldsea-titlebar').length).toBe(1)
    expect(document.querySelectorAll('#worldsea-workbench').length).toBe(1)
  })
})

describe('窗口栏：壳切换与占位页', () => {
  it('点切换控件 → 占位页打开、标题与文案切换、事件落档；再点 → 回到 Agent 空间', () => {
    const toggle = bar().querySelector('.wstb-toggle') as HTMLElement
    const title = bar().querySelector('.wstb-title span') as HTMLElement
    expect(toggle.textContent).toContain('Agent 空间')
    expect(title.textContent).toBe('WorldSea — Agent 空间')

    click(toggle)
    expect(workbench().classList.contains('wstb-open')).toBe(true)
    expect(toggle.textContent).toContain('工作台')
    expect(title.textContent).toBe('WorldSea — 工作台')
    expect(toggle.getAttribute('aria-label')).toBe('返回 Agent 空间')
    expect(reports().some(message => message.includes('工作台（占位页）'))).toBe(true)

    click(toggle)
    expect(workbench().classList.contains('wstb-open')).toBe(false)
    expect(title.textContent).toBe('WorldSea — Agent 空间')
  })

  it('占位页「返回 Agent 空间」按钮 → 收起占位页', () => {
    const toggle = bar().querySelector('.wstb-toggle') as HTMLElement
    click(toggle)
    expect(workbench().classList.contains('wstb-open')).toBe(true)
    click(workbench().querySelector('.wstb-wb-back') as HTMLElement)
    expect(workbench().classList.contains('wstb-open')).toBe(false)
    expect(toggle.textContent).toContain('Agent 空间')
  })
})

describe('窗口栏：拖拽 / 双击（Tauri 生态惯例：detail=2 走最大化）', () => {
  it('空白按下 → start-drag 且阻止默认；双击 → toggle-maximize（不触发 start-drag）', () => {
    calls = []
    const event = mouseDown(bar(), 1)
    expect(event.defaultPrevented).toBe(true)
    expect(windowActions()).toEqual(['start-drag'])

    calls = []
    mouseDown(bar(), 2)
    expect(windowActions()).toEqual(['toggle-maximize'])
  })

  it('按钮上按下不触发拖拽（命中按钮即不参与拖拽）', () => {
    calls = []
    const toggle = bar().querySelector('.wstb-toggle') as HTMLElement
    mouseDown(toggle, 1)
    expect(windowActions()).toEqual([])
  })
})

describe('窗口栏：窗口控制按钮', () => {
  it('最小化 / 关闭各发对应动作；最大化按返回值切换图标', async () => {
    calls = []
    click(bar().querySelector('.wstb-min') as HTMLElement)
    click(bar().querySelector('.wstb-close') as HTMLElement)
    expect(windowActions()).toEqual(['minimize', 'close'])

    calls = []
    nextOutcome = () => ({ maximized: true })
    const maxBtn = bar().querySelector('.wstb-max') as HTMLElement
    click(maxBtn)
    await flush()
    expect(windowActions()).toEqual(['toggle-maximize'])
    // 还原图标 = 两层窗口（含 <rect x="1" y="3"），最大化图标 = 单层（<rect x="0.5"）
    expect(maxBtn.innerHTML).toContain('x="1" y="3"')
    expect(maxBtn.getAttribute('aria-label')).toBe('还原')

    nextOutcome = () => ({ maximized: false })
    click(maxBtn)
    await flush()
    expect(maxBtn.innerHTML).toContain('x="0.5"')
    expect(maxBtn.getAttribute('aria-label')).toBe('最大化')
  })
})

describe('窗口栏：「⋯」popup 菜单', () => {
  it('点击 → 以按钮左下角（页面逻辑坐标）调 cmd_shell_popup_menu', () => {
    calls = []
    const more = bar().querySelector('.wstb-more') as HTMLElement
    more.getBoundingClientRect = () =>
      ({ left: 1180, bottom: 32, right: 1216, top: 0, width: 36, height: 32, x: 1180, y: 0, toJSON: () => ({}) }) as DOMRect
    click(more)
    const popup = calls.find(call => call.command === 'cmd_shell_popup_menu')
    expect(popup).toBeTruthy()
    expect(popup?.args.x).toBe(1180)
    expect(popup?.args.y).toBe(34)
  })
})
