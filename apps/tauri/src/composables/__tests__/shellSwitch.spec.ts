import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUIStore } from '@/stores/uiStore'
import { switchShell, toggleShell } from '../shellSwitch'

type BridgeHost = { __WORLDSEA_SPACE_SWITCH__?: (to: string) => Promise<unknown> }

describe('shellSwitch（空间切换统一入口）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    delete (globalThis as BridgeHost).__WORLDSEA_SPACE_SWITCH__
  })

  it('有壳桥：走壳命令，不落页内壳切换', () => {
    const bridge = vi.fn().mockResolvedValue('space')
    ;(globalThis as BridgeHost).__WORLDSEA_SPACE_SWITCH__ = bridge
    const uiStore = useUIStore()
    uiStore.setShell('workbench')

    switchShell('space')

    expect(bridge).toHaveBeenCalledWith('space')
    expect(uiStore.currentShell).toBe('workbench')
  })

  it('无壳桥：回退页内壳切换', () => {
    const uiStore = useUIStore()
    uiStore.setShell('workbench')

    switchShell('space')

    expect(uiStore.currentShell).toBe('space')
  })

  it('toggle 按当前壳取反，并经桥下发目标', () => {
    const bridge = vi.fn().mockResolvedValue('space')
    ;(globalThis as BridgeHost).__WORLDSEA_SPACE_SWITCH__ = bridge
    const uiStore = useUIStore()

    uiStore.setShell('workbench')
    toggleShell()
    expect(bridge).toHaveBeenLastCalledWith('space')

    uiStore.setShell('space')
    toggleShell()
    expect(bridge).toHaveBeenLastCalledWith('workbench')
  })
})
