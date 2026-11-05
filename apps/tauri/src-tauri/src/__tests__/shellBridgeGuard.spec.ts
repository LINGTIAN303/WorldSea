// @vitest-environment jsdom

/**
 * 壳桥注入脚本（apps/tauri/src-tauri/src/dsh_shell_bridge.js）的行为测试：外链守卫直接改变用户可见行为
 * （点击外链 → 系统浏览器，而非把应用窗口导航走），且它是注入到页面的**唯一**拦截点——Rust 单测看不见它，
 * 故以 jsdom 载入同一份文件做行为断言；用例对应官方 Electron 桌面版导航定义（main.ts 的 setWindowOpenHandler / will-navigate）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// jsdom 环境下 import.meta.url 不是 file: 形态，按仓根拼路径（vitest 从仓根运行）
const SOURCE = readFileSync(
  join(process.cwd(), 'apps/tauri/src-tauri/src/dsh_shell_bridge.js'),
  'utf8',
)

interface InvokeCall {
  readonly command: string
  readonly args: Record<string, unknown>
}

let calls: InvokeCall[] = []

/**
 * 装桥（含 IPC 桩），返回记录到的命令调用。
 * 脚本自身幂等：同文件内后续 boot 是 no-op（监听器只在首次注册一次），每次只换 IPC 桩与 DOM。
 */
function boot(): InvokeCall[] {
  calls = []
  ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args })
      return Promise.resolve(undefined)
    },
  }
  document.body.replaceChildren()
  // 被测源码是本仓一等文件（Rust 侧同一份 include_str! 注入），非外部输入 → 直接求值
  new Function(SOURCE)()
  return calls
}

function externalCalls(recorded: InvokeCall[]): InvokeCall[] {
  return recorded.filter(call => call.command === 'cmd_shell_open_external')
}

function reportMessages(recorded: InvokeCall[]): string[] {
  return recorded
    .filter(call => call.command === 'cmd_shell_bridge_report')
    .map(call => String(call.args.message))
}

function click(anchor: HTMLAnchorElement, type: 'click' | 'auxclick' = 'click'): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  anchor.dispatchEvent(event)
  return event
}

/* 必须先声明：本用例完成真实安装，后续用例的 boot 都是幂等 no-op */
describe('壳桥：首次安装', () => {
  it('注入即报 ready 并暴露完整 API（文档开始前生效的证据面）', () => {
    const first = boot()
    expect(reportMessages(first).some(message => message.includes('shell bridge ready（platform=worldsea-tauri'))).toBe(true)
    const bridge = (globalThis as unknown as { __WORLDSEA_SHELL__?: Record<string, unknown> }).__WORLDSEA_SHELL__
    expect(bridge?.platform).toBe('worldsea-tauri')
    for (const member of ['notify', 'openExternal', 'report', 'openSettings']) {
      expect(typeof bridge?.[member]).toBe('function')
    }
  })
})

describe('壳桥：外链守卫', () => {
  it('同源链接放行（应用内导航不受影响）', () => {
    const calls = boot()
    const anchor = document.createElement('a')
    anchor.href = `${location.origin}/sessions`
    document.body.appendChild(anchor)
    expect(click(anchor).defaultPrevented).toBe(false)
    expect(externalCalls(calls)).toHaveLength(0)
  })

  it('外链点击 → 拦截 + 系统浏览器', () => {
    const local = boot()
    const anchor = document.createElement('a')
    anchor.href = 'https://platform.deepseek.com'
    document.body.appendChild(anchor)
    expect(click(anchor).defaultPrevented).toBe(true)
    expect(externalCalls(local)).toHaveLength(1)
    expect(externalCalls(local)[0]?.args.url).toBe('https://platform.deepseek.com/')
  })

  it('中键（auxclick）外链同样拦截', () => {
    const local = boot()
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/doc'
    document.body.appendChild(anchor)
    expect(click(anchor, 'auxclick').defaultPrevented).toBe(true)
    expect(externalCalls(local)).toHaveLength(1)
  })

  it('window.open 外链 → 不开新窗 + 系统浏览器（官方 action:deny 同款）', () => {
    const local = boot()
    const result = (globalThis as unknown as { open: (url: string) => unknown }).open('https://example.com/x')
    expect(result).toBeNull()
    expect(externalCalls(local)).toHaveLength(1)
    expect(externalCalls(local)[0]?.args.url).toBe('https://example.com/x')
  })

  it('window.open 一律不开应用内新窗；http(s) 交系统浏览器（官方 action:deny 同款）', () => {
    const local = boot()
    // 官方 setWindowOpenHandler：http(s) 先 shell.openExternal，再恒 { action: 'deny' }
    const sameOrigin = (globalThis as unknown as { open: (url: string) => unknown }).open(`${location.origin}/preview`)
    expect(sameOrigin).toBeNull()
    expect(externalCalls(local)).toHaveLength(1)
    // 非 http(s)/mailto：只拒绝 + 落档，不外开（about:blank 例外见下一条用例）
    const blocked = (globalThis as unknown as { open: (url: string) => unknown }).open('about:blank#frag')
    expect(blocked).toBeNull()
    expect(externalCalls(local)).toHaveLength(1)
    expect(reportMessages(local).some(message => message.includes('已拦截 window.open'))).toBe(true)
  })

  it('window.open("about:blank") 交回预开窗桩：登录的「先开窗再导航」依赖它', () => {
    const local = boot()
    const handle = (globalThis as unknown as { open: (url: string) => unknown }).open('about:blank') as {
      closed: boolean
      location: { replace: (url: string) => void }
    }
    // 返回可用的桩而不是 null —— 否则 dsh 的 BrowserLogin 拿不到句柄，授权页永不打开
    expect(handle).not.toBeNull()
    expect(handle.closed).toBe(false)
    expect(externalCalls(local)).toHaveLength(0)
    // 桩的导航把授权页交给系统浏览器（与其它外开同一条命令），且不开应用内新窗
    handle.location.replace('https://platform.deepseek.com/dsh/authorize?x=1')
    expect(externalCalls(local)).toHaveLength(1)
    expect(externalCalls(local)[0]?.args.url).toBe('https://platform.deepseek.com/dsh/authorize?x=1')
  })

  it('只有 about:blank / 空参走预开窗语义（逃逸面不放大）', () => {
    boot()
    const noArg = (globalThis as unknown as { open: () => unknown }).open()
    expect(noArg).not.toBeNull()
    const addressed = (globalThis as unknown as { open: (url: string) => unknown }).open('https://example.com/x')
    expect(addressed).toBeNull()
  })

  it('mailto 交系统处理；file: 等其它协议只拦截不外开', () => {
    const local = boot()
    const mail = document.createElement('a')
    mail.href = 'mailto:support@example.com'
    document.body.appendChild(mail)
    expect(click(mail).defaultPrevented).toBe(true)
    expect(externalCalls(local)[0]?.args.url).toBe('mailto:support@example.com')

    const file = document.createElement('a')
    file.href = 'file:///C:/Windows/win.ini'
    document.body.appendChild(file)
    expect(click(file).defaultPrevented).toBe(true)
    expect(externalCalls(local)).toHaveLength(1)
  })

  it('重复注入是 no-op（监听器与覆盖不叠加）', () => {
    boot()
    const second = boot()
    expect(reportMessages(second).filter(message => message.includes('shell bridge ready'))).toHaveLength(0)
    // 再点一次外链：仍只触发一次外开（没有叠加成两次）
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/dup'
    document.body.appendChild(anchor)
    click(anchor)
    expect(externalCalls(second)).toHaveLength(1)
  })
})

describe('壳桥：对外 API', () => {
  it('notify 走 cmd_notify', () => {
    const calls = boot()
    const bridge = (globalThis as unknown as { __WORLDSEA_SHELL__: { notify: (t: string, b: string) => unknown } }).__WORLDSEA_SHELL__
    void bridge.notify('标题', '正文')
    expect(calls.some(call => call.command === 'cmd_notify' && call.args.title === '标题' && call.args.body === '正文')).toBe(true)
  })

  it('openSettings 命中 aria-label 的设置入口并点击（折叠态路径）', () => {
    const calls = boot()
    const trigger = document.createElement('button')
    trigger.setAttribute('aria-label', '设置')
    let clicked = 0
    trigger.addEventListener('click', () => { clicked += 1 })
    document.body.appendChild(trigger)
    const bridge = (globalThis as unknown as { __WORLDSEA_SHELL__: { openSettings: () => boolean } }).__WORLDSEA_SHELL__
    expect(bridge.openSettings()).toBe(true)
    expect(clicked).toBe(1)
    expect(calls.some(call => String(call.args.message).startsWith('openSettings: clicked'))).toBe(true)
  })

  it('openSettings 找不到入口时如实上报失败（不静默）', () => {
    const calls = boot()
    const bridge = (globalThis as unknown as { __WORLDSEA_SHELL__: { openSettings: () => boolean } }).__WORLDSEA_SHELL__
    expect(bridge.openSettings()).toBe(false)
    expect(calls.some(call => String(call.args.message).includes('未找到设置入口'))).toBe(true)
  })
})
