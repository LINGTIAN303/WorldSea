import { beforeEach, describe, expect, it, vi } from 'vitest'

const listenMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

type ThemeHandler = (event: { payload?: { theme?: string } }) => void

async function loadTheme() {
  vi.resetModules()
  return import('../useTheme')
}

function setShellBridge(notify: (value: string) => Promise<unknown>) {
  ;(globalThis as { __WORLDSEA_SET_THEME__?: (value: string) => Promise<unknown> }).__WORLDSEA_SET_THEME__ = notify
}

describe('useTheme 壳主题同步', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    delete (globalThis as { __WORLDSEA_SET_THEME__?: unknown }).__WORLDSEA_SET_THEME__
    listenMock.mockReset()
    listenMock.mockResolvedValue(() => {})
  })

  it('壳广播只应用主题，不回写壳', async () => {
    localStorage.setItem('worldsea:theme', 'light')
    const notify = vi.fn(async () => undefined)
    setShellBridge(notify)
    await loadTheme()
    await Promise.resolve()

    const handler = listenMock.mock.calls[0]?.[1] as ThemeHandler
    expect(handler).toBeTypeOf('function')
    handler({ payload: { theme: 'dark' } })

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('worldsea:theme')).toBe('dark')
    expect(notify).not.toHaveBeenCalled()
  })

  it('用户主动切换仍回写壳一次', async () => {
    localStorage.setItem('worldsea:theme', 'light')
    const notify = vi.fn(async () => undefined)
    setShellBridge(notify)
    const { useTheme } = await loadTheme()

    useTheme().setMode('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('dark')
  })
})
