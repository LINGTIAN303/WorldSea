// @vitest-environment jsdom
/**
 * 启动失败安全网（apps/tauri/src-tauri/src/dsh_watchdog.js）的 jsdom 测试。
 *
 * 为什么不白屏安全网要直测：它是入口脚本/样式失败或长时间无渲染时唯一的自救面（错误页 + 重试），
 * Rust 侧 `include_str!` 注入同一份源码但看不见 DOM 行为；本件同时锁样式契约——配色/字体吃
 * dsh 设计令牌（--dsw-*，缺省时回退自包含色值）。每个断言都对一处变异敏感（反证口径）。
 *
 * 注：错误事件派发只在本文件第一个用例出现（脚本的事件监听是 window 级、跨用例残留），
 * 其余用例不派发错误事件以免触发前序闭包的监听。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(
  join(process.cwd(), 'apps/tauri/src-tauri/src/dsh_watchdog.js'),
  'utf8',
)

function evalScript(): void {
  new Function(SOURCE)()
}

function page(): HTMLElement | null {
  return document.getElementById('worldsea-shell-boot-error')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllTimers()
  document.querySelectorAll('#worldsea-shell-boot-error').forEach(el => el.remove())
  document.head.innerHTML = ''
  if (document.body === null) document.documentElement.appendChild(document.createElement('body'))
  document.body.innerHTML = ''
  delete (globalThis as { __WORLDSEA_BOOT_ROOT__?: string }).__WORLDSEA_BOOT_ROOT__
})

afterAll(() => {
  vi.useRealTimers()
})

describe('不白屏安全网（worldsea-shell:boot-watchdog）', () => {
  it('入口脚本失败 → 立即出示并列出失败资源', () => {
    document.body.innerHTML = '<div id="root"></div>'
    evalScript()
    const script = document.createElement('script')
    script.src = 'https://boot.test/app-entry.js'
    document.head.appendChild(script)
    script.dispatchEvent(new Event('error'))
    const box = page()
    expect(box).not.toBeNull()
    expect(box?.textContent).toContain('界面未能启动')
    expect(box?.textContent).toContain('app-entry.js')
  })

  it('空挂载点超时 → 出示错误页（含等待秒数与 dsh 令牌样式）', () => {
    document.body.innerHTML = '<div id="root"></div>'
    evalScript()
    expect(page()).toBeNull()
    vi.advanceTimersByTime(25_000)
    const box = page()
    expect(box).not.toBeNull()
    expect(box?.textContent).toContain('已等待 25 秒')
    const style = box?.getAttribute('style') ?? ''
    expect(style).toContain('var(--dsw-alias-bg-layer-1,')
    expect(style).toContain('var(--dsw-alias-label-primary,')
    expect(style).toContain('var(--dsw-font-family,')
    const retry = box?.querySelector('button')
    expect(retry?.textContent).toBe('重试')
    const retryStyle = retry?.getAttribute('style') ?? ''
    expect(retryStyle).toContain('var(--dsw-alias-button-primary-fill,')
  })

  it('body 未就绪时出示 → DOMContentLoaded 后迁入 body（吃 body 级令牌）', () => {
    document.body?.remove()
    evalScript()
    vi.advanceTimersByTime(25_000)
    const box = page()
    expect(box?.parentElement?.tagName).toBe('HTML')
    document.documentElement.appendChild(document.createElement('body'))
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(page()?.parentElement).toBe(document.body)
  })

  it('挂载点已渲染 → 永不介入', () => {
    document.body.innerHTML = '<div id="root"><div>ready</div></div>'
    evalScript()
    vi.advanceTimersByTime(30_000)
    expect(page()).toBeNull()
  })
})
