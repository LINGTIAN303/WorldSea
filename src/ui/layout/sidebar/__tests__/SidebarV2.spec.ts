import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSidebarPhysics } from '../useSidebarPhysics'
import { useSidebarInteraction } from '../useSidebarInteraction'
import { useSidebarDragHandler } from '../useSidebarDragHandler'

/**
 * SidebarV2 测试套件 — 测试用例驱动开发
 *
 * 12 个交互场景覆盖(对应原 Sidebar.vue 的 3 个已修复 BUG + 9 个回归场景):
 *  1. 点击 offset=0 → pulse 反馈,无跳转
 *  2. 点击 offset≠0 → 跳转目标视图
 *  3. 点击时 pos 不被污染(用 dragStartPos)
 *  4. 拖拽 < 25px → 视为点击
 *  5. 拖拽 > 25px → pos 跟随 totalDy
 *  6. 拖拽用 totalDy 而非 dy(无振荡)
 *  7. 滚轮 → 触发物理动画
 *  8. 视图切换 → onSettle 回调
 *  9. 物理弹簧 → 回弹到整数位置
 *  10. fling → 惯性滑动
 *  11. 拖拽重排(自定义视图)→ dragstart 设置 dataTransfer
 *  12. 点击 offset=0 不调用 springTo
 */

// mock requestAnimationFrame(jsdom 不支持,用同步立即执行)
beforeEach(() => {
  let rafId = 0
  const rafQueue: (() => void)[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    const id = ++rafId
    rafQueue.push(cb)
    // 立即执行(测试中不需要真实 RAF 延迟)
    Promise.resolve().then(() => {
      const idx = rafQueue.indexOf(cb)
      if (idx !== -1) {
        rafQueue.splice(idx, 1)
        cb()
      }
    })
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    // 简化:不真正取消(测试中物理循环会自然收敛)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ──────────────────────────────────────────────────────────────
 * 物理引擎测试(useSidebarPhysics)
 * ────────────────────────────────────────────────────────────── */

describe('useSidebarPhysics', () => {
  function createPhysics(onSettle?: (idx: number) => void, viewCount = 5) {
    return useSidebarPhysics({
      getViewCount: () => viewCount,
      onSettle,
    })
  }

  it('场景9:物理弹簧 springTo 应将 pos 吸附到目标整数位置', async () => {
    const physics = createPhysics()
    physics.setPosition(0)
    physics.springTo(3)

    // 等待 RAF 队列收敛(弹簧需要多帧)
    await vi.waitFor(() => {
      expect(physics.pos.value).toBeCloseTo(3, 5)
    })
    expect(physics.getSettledIdx()).toBe(3)
    expect(physics._isRunning()).toBe(false)
  })

  it('场景7:applyImpulse 施加冲量后 pos 应改变', async () => {
    const physics = createPhysics()
    physics.setPosition(0)
    physics.applyImpulse(1) // 向下冲量

    await vi.waitFor(() => {
      expect(physics.pos.value).not.toBe(0)
    })
    // 最终应吸附到某个整数
    await vi.waitFor(() => {
      expect(Number.isInteger(physics.getSettledIdx())).toBe(true)
    })
  })

  it('场景8:onSettle 在 pos 落到新整数时触发', async () => {
    const onSettle = vi.fn()
    const physics = createPhysics(onSettle, 5)
    physics.setPosition(0)
    physics.syncSettledIdx(0)
    physics.springTo(2)

    await vi.waitFor(() => {
      expect(onSettle).toHaveBeenCalledWith(2)
    })
  })

  it('场景10:fling 根据速度产生惯性滑动', async () => {
    const physics = createPhysics()
    physics.setPosition(0)
    physics.fling(0.5) // 正速度(向上滑动)

    await vi.waitFor(() => {
      // fling 后 pos 应有变化(惯性滑动)
      expect(physics.pos.value).not.toBe(0)
    })
  })

  it('setPosition 直接设置 pos 不触发物理', () => {
    const physics = createPhysics()
    physics.setPosition(2.5)
    expect(physics.pos.value).toBe(2.5)
    expect(physics._isRunning()).toBe(false)
    expect(physics._getVel()).toBe(0)
  })

  it('setPosition(shouldSettle=true) 应吸附到最近整数', async () => {
    const physics = createPhysics()
    physics.setPosition(2.4, true)

    await vi.waitFor(() => {
      expect(physics.pos.value).toBeCloseTo(2, 5)
    })
  })

  it('视图数为 0 时不崩溃', () => {
    const physics = createPhysics(undefined, 0)
    physics.setPosition(0)
    // applyImpulse 会修改 vel 和 pos(物理引擎本身不感知视图数)
    // 视图数 0 的保护在 onSettle 层(checkSettle 中 viewCount > 0 判断)
    expect(() => physics.applyImpulse(1)).not.toThrow()
  })

  it('循环取模:pos 超出视图数时 onSettle 返回正确索引', async () => {
    const onSettle = vi.fn()
    const physics = createPhysics(onSettle, 5)
    physics.setPosition(0)
    physics.syncSettledIdx(0)
    physics.springTo(7) // 超出 5,应取模为 2

    await vi.waitFor(() => {
      expect(onSettle).toHaveBeenCalledWith(2)
    })
  })
})

/* ──────────────────────────────────────────────────────────────
 * 交互处理测试(useSidebarInteraction)
 * ────────────────────────────────────────────────────────────── */

describe('useSidebarInteraction', () => {
  /** 模拟 PointerEvent + currentTarget 元素 */
  function createMockPointerEvent(
    type: string,
    clientY: number,
    target: HTMLElement,
    currentTarget: HTMLElement,
  ): PointerEvent {
    const event = new Event(type, { bubbles: true }) as PointerEvent
    Object.defineProperty(event, 'clientY', { value: clientY, configurable: true })
    Object.defineProperty(event, 'target', { value: target, configurable: true })
    Object.defineProperty(event, 'currentTarget', { value: currentTarget, configurable: true })
    Object.defineProperty(event, 'button', { value: 0, configurable: true })
    Object.defineProperty(event, 'pointerId', { value: 1, configurable: true })
    Object.defineProperty(event, 'preventDefault', { value: vi.fn(), configurable: true })
    return event
  }

  /** 创建带按钮的 sidebar 元素 */
  function createSidebarDom(offsets: number[] = [0, 1, -1]) {
    const sidebar = document.createElement('div')
    sidebar.className = 'sidebar'
    const carousel = document.createElement('div')
    carousel.className = 'sidebar-carousel'
    sidebar.appendChild(carousel)

    const buttons: HTMLElement[] = []
    for (const offset of offsets) {
      const btn = document.createElement('div')
      btn.className = 'sidebar-btn'
      btn.dataset.offset = String(offset)
      btn.dataset.viewId = `view-${offset}`
      carousel.appendChild(btn)
      buttons.push(btn)
    }

    // mock setPointerCapture / releasePointerCapture / addEventListener
    sidebar.setPointerCapture = vi.fn()
    sidebar.releasePointerCapture = vi.fn()
    // 真实 addEventListener(让 useSidebarInteraction 能绑定 move/up)
    sidebar.addEventListener = Element.prototype.addEventListener.bind(sidebar)
    sidebar.removeEventListener = Element.prototype.removeEventListener.bind(sidebar)

    return { sidebar, buttons }
  }

  it('场景1:点击 offset=0 按钮 → 触发 onClick(0),不触发 onDragMove', () => {
    const onClick = vi.fn()
    const onDragMove = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0, 1, -1])

    const interaction = useSidebarInteraction({ onClick, onDragMove })
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[0], sidebar), 0)
    // 立即 pointerup(无 move,或 move < 25px)
    sidebar.dispatchEvent(new Event('pointerup'))

    expect(onClick).toHaveBeenCalledWith(0, 0)
    expect(onDragMove).not.toHaveBeenCalled()
  })

  it('场景2:点击 offset≠0 按钮 → 触发 onClick(offset, startPos)', () => {
    const onClick = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0, 1, -1])

    const interaction = useSidebarInteraction({ onClick })
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[1], sidebar), 0)
    sidebar.dispatchEvent(new Event('pointerup'))

    expect(onClick).toHaveBeenCalledWith(1, 0)
  })

  it('场景3:点击时 startPos 传入的是按下时的 pos(未被污染)', () => {
    const onClick = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0, 1])

    const interaction = useSidebarInteraction({ onClick })
    // 按下时 pos = 3
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[1], sidebar), 3)
    sidebar.dispatchEvent(new Event('pointerup'))

    // onClick 第二参数应为 3(按下时的 pos),而非被污染的值
    expect(onClick).toHaveBeenCalledWith(1, 3)
  })

  it('场景4:拖拽 < 25px → 视为点击(不触发 onDragMove)', () => {
    const onClick = vi.fn()
    const onDragMove = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0])

    const interaction = useSidebarInteraction({ onClick, onDragMove })
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[0], sidebar), 0)

    // move 20px(未超 25px 阈值)
    const moveEvent = createMockPointerEvent('pointermove', 120, buttons[0], sidebar)
    sidebar.dispatchEvent(moveEvent)
    sidebar.dispatchEvent(new Event('pointerup'))

    expect(onClick).toHaveBeenCalled()
    expect(onDragMove).not.toHaveBeenCalled()
  })

  it('场景5:拖拽 > 25px → 触发 onDragMove,pos 跟随 totalDy', () => {
    const onDragMove = vi.fn()
    const onDragStart = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0])

    const interaction = useSidebarInteraction({ onDragMove, onDragStart })
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[0], sidebar), 0)

    // move 30px(超过 25px 阈值)
    const moveEvent = createMockPointerEvent('pointermove', 130, buttons[0], sidebar)
    sidebar.dispatchEvent(moveEvent)

    expect(onDragStart).toHaveBeenCalledWith(0)
    expect(onDragMove).toHaveBeenCalled()
    // totalDy = 30, DRAG_SENSITIVITY = 0.028, newPos = 0 - 30 * 0.028 = -0.84
    expect(onDragMove).toHaveBeenCalledWith(expect.closeTo(-0.84, 2))
  })

  it('场景6:拖拽用 totalDy 而非 dy(连续 move 不振荡)', () => {
    const onDragMove = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0])

    const interaction = useSidebarInteraction({ onDragMove })
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[0], sidebar), 0)

    // 连续两次 move,每次 20px(累计 40px,超过阈值)
    // 原代码 BUG:用 dy(单帧增量)会导致 pos 在 dragStartPos 附近振荡
    // 修复后:用 totalDy,pos 应持续跟随总位移
    sidebar.dispatchEvent(createMockPointerEvent('pointermove', 120, buttons[0], sidebar))
    sidebar.dispatchEvent(createMockPointerEvent('pointermove', 140, buttons[0], sidebar))

    // 第二次 move 时 totalDy = 40, newPos = 0 - 40 * 0.028 = -1.12
    const lastCall = onDragMove.mock.calls[onDragMove.mock.calls.length - 1]
    expect(lastCall[0]).toBeCloseTo(-1.12, 2)
  })

  it('场景12:点击 offset=0 不触发 onDragEnd', () => {
    const onClick = vi.fn()
    const onDragEnd = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0])

    const interaction = useSidebarInteraction({ onClick, onDragEnd })
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[0], sidebar), 0)
    sidebar.dispatchEvent(new Event('pointerup'))

    expect(onClick).toHaveBeenCalled()
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('拖拽结束后触发 onDragEnd(含速度)', () => {
    const onDragEnd = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0])

    const interaction = useSidebarInteraction({ onDragEnd })
    interaction.onPointerDown(createMockPointerEvent('pointerdown', 100, buttons[0], sidebar), 0)
    // 超阈值 move
    sidebar.dispatchEvent(createMockPointerEvent('pointermove', 150, buttons[0], sidebar))
    sidebar.dispatchEvent(new Event('pointerup'))

    expect(onDragEnd).toHaveBeenCalled()
    expect(onDragEnd.mock.calls[0][1]).toBe(0) // startPos
  })

  it('右键不响应(button !== 0)', () => {
    const onClick = vi.fn()
    const { sidebar, buttons } = createSidebarDom([0])

    const interaction = useSidebarInteraction({ onClick })
    const event = createMockPointerEvent('pointerdown', 100, buttons[0], sidebar) as any
    Object.defineProperty(event, 'button', { value: 2, configurable: true })
    interaction.onPointerDown(event, 0)

    expect(onClick).not.toHaveBeenCalled()
  })
})

/* ──────────────────────────────────────────────────────────────
 * 拖拽处理测试(useSidebarDragHandler)
 * ────────────────────────────────────────────────────────────── */

describe('useSidebarDragHandler', () => {
  it('场景11:自定义视图模式下 dragstart 设置 dataTransfer', () => {
    const dragHandler = useSidebarDragHandler(() => true)
    const view = { id: 'characters', label: '角色', icon: 'character' }

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    }
    const event = { dataTransfer: dataTransfer } as unknown as DragEvent

    dragHandler.onDragStart(view, event)

    expect(dataTransfer.setData).toHaveBeenCalledWith('application/worldsmith-view-id', 'characters')
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/worldsmith-view-label', '角色')
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/worldsmith-view-icon', 'character')
    expect(dataTransfer.effectAllowed).toBe('copy')
  })

  it('非自定义视图模式不触发 dragstart', () => {
    const dragHandler = useSidebarDragHandler(() => false)
    const view = { id: 'characters', label: '角色', icon: 'character' }
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    const event = { dataTransfer } as unknown as DragEvent

    dragHandler.onDragStart(view, event)

    expect(dataTransfer.setData).not.toHaveBeenCalled()
  })

  it('custom 视图本身不可拖拽', () => {
    const dragHandler = useSidebarDragHandler(() => true)
    expect(dragHandler.getDraggable({ id: 'custom' })).toBe(false)
    expect(dragHandler.getDraggable({ id: 'characters' })).toBe(true)
  })

  it('无 dataTransfer 时安全退出', () => {
    const dragHandler = useSidebarDragHandler(() => true)
    const view = { id: 'characters', label: '角色', icon: 'character' }
    const event = { dataTransfer: null } as unknown as DragEvent

    expect(() => dragHandler.onDragStart(view, event)).not.toThrow()
  })
})
