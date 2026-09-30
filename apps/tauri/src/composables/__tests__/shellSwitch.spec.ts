/**
 * shellSwitch 单测 —— 空间切换统一入口（2026-09-30 C 批重写）。
 *
 * 语义变化：双窗时代工作台侧方向固定「进入 Agent 空间」（去 toggleShell / 去页内回退）；
 * 无桥（浏览器预览）仅警告不抛错。每个用例对一处变异敏感（反证口径）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { switchShell } from '../shellSwitch'

type BridgeHost = { __WORLDSEA_SPACE_SWITCH__?: (to: string) => Promise<unknown> }

describe('shellSwitch（空间切换统一入口，双窗定向）', () => {
  beforeEach(() => {
    delete (globalThis as BridgeHost).__WORLDSEA_SPACE_SWITCH__
    vi.restoreAllMocks()
  })

  it('有壳桥：把目标空间转发给壳命令（工作台侧固定 space）', () => {
    const bridge = vi.fn().mockResolvedValue('space')
    ;(globalThis as BridgeHost).__WORLDSEA_SPACE_SWITCH__ = bridge

    switchShell('space')

    expect(bridge).toHaveBeenCalledWith('space')
  })

  it('有壳桥：workbench 目标原样转发（协议镜像，供对称实现复用）', () => {
    const bridge = vi.fn().mockResolvedValue('workbench')
    ;(globalThis as BridgeHost).__WORLDSEA_SPACE_SWITCH__ = bridge

    switchShell('workbench')

    expect(bridge).toHaveBeenCalledWith('workbench')
  })

  it('桥拒绝时同步不抛错，异步记 console.error（交给页外自愈）', async () => {
    const bridge = vi.fn().mockRejectedValue(new Error('boom'))
    ;(globalThis as BridgeHost).__WORLDSEA_SPACE_SWITCH__ = bridge
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => switchShell('space')).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(error).toHaveBeenCalled()
  })

  it('无壳桥（浏览器预览）：仅警告不抛错（页内已无第二壳可切）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => switchShell('space')).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
