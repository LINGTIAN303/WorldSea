// @vitest-environment jsdom
/**
 * 窗口栏注入脚本（apps/tauri/src-tauri/src/dsh_titlebar.js）的行为测试（C6，2026-09-24；
 * D1-b 起切换控件改走壳命令，占位页退役）。
 *
 * 为什么要直测这份 JS：窗口栏是用户可见的一等壳件（拖拽 / 双击最大化 / 三控制按钮 / 空间切换 /
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
/** 空间切换命令的结果注入（成功 = 返回目标空间名；失败 = 抛错，脚本须落档且不抛到页外）。 */
let switchOutcome: () => unknown = () => 'workbench'

function evalScript(): void {
  new Function(SOURCE)()
}

function stubIpc(): void {
  ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    // 与真 IPC 同形：**永不同步抛**（拒绝也走 Promise），否则脚本的 .catch 接不住
    invoke: (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args })
      return Promise.resolve().then(() => {
        // 日志通道脚本不挂 catch（尽力而为）→ 恒成功，避免测试期产生无关的未处理拒绝
        if (command === 'cmd_shell_bridge_report') return undefined
        if (command === 'cmd_shell_space_switch') return switchOutcome()
        return nextOutcome()
      })
    },
  }
}

function bar(): HTMLElement {
  const element = document.getElementById('worldsea-titlebar')
  if (element === null) throw new Error('缺 #worldsea-titlebar（窗口栏未挂载）')
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
    expect(reports().some(message => message.includes('窗口栏已挂载'))).toBe(true)
    expect(windowActions()).toContain('is-maximized')
  })

  it('幂等：重复求值不叠加（DOM 仍只有一份）', () => {
    evalScript()
    expect(document.querySelectorAll('#worldsea-titlebar').length).toBe(1)
  })
})

describe('窗口栏：空间切换（D1-b：交壳做双窗互斥）', () => {
  it('点切换控件 → 调 cmd_shell_space_switch(workbench)，本窗文案不翻转（本窗恒为 Agent 空间）', async () => {
    calls = []
    const toggle = bar().querySelector('.wstb-toggle') as HTMLElement
    const title = bar().querySelector('.wstb-title span') as HTMLElement
    expect(toggle.textContent).toContain('Agent 空间')
    expect(title.textContent).toBe('WorldSea — Agent 空间')

    click(toggle)
    await flush()
    const switchCall = calls.find(call => call.command === 'cmd_shell_space_switch')
    expect(switchCall?.args.target).toBe('workbench')
    expect(toggle.textContent).toContain('Agent 空间')
    expect(title.textContent).toBe('WorldSea — Agent 空间')
    expect(reports().some(message => message.includes('space → workbench'))).toBe(true)
  })

  it('切换失败（壳拒绝）→ 落档失败原因，不抛到页外', async () => {
    calls = []
    switchOutcome = () => { throw new Error('工作台窗口尚未创建') }
    const toggle = bar().querySelector('.wstb-toggle') as HTMLElement
    click(toggle)
    await flush()
    await flush()
    expect(reports().some(message => message.includes('空间切换失败'))).toBe(true)
    switchOutcome = () => 'workbench'
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

describe('窗口栏：侧栏开关键捞回（E9）', () => {
  it('占位槽存在且紧跟切换胶囊（DOM 顺序 = 视觉「胶囊右侧」）', () => {
    const toggle = bar().querySelector('.wstb-toggle') as Element
    const slot = bar().querySelector('.wstb-sidebar-slot')
    expect(slot).toBeTruthy()
    expect(toggle.nextElementSibling).toBe(slot)
  })

  it('dsh 键晚到（React 异步渲染）→ 轮询命中：内联样式钉住并抬升 z-index 到本栏之上', async () => {
    /* 模拟 dsh 侧栏键的稳定特征：aria-keyshortcuts + class 含 toggle + fixed 定位（jsdom 无布局，position 走内联） */
    const fakeToggle = document.createElement('button')
    fakeToggle.setAttribute('aria-keyshortcuts', 'Control+B')
    fakeToggle.className = 'SidebarRoot_iconButton__a1 SidebarRoot_toggle__b2'
    fakeToggle.style.position = 'fixed'
    document.body.appendChild(fakeToggle)
    try {
      /* 首装时的轮询周期 250ms → 真实等待一拍即命中 */
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(fakeToggle.style.zIndex).toBe('2147483001')
      expect(fakeToggle.style.left).not.toBe('')
      expect(fakeToggle.style.top).not.toBe('')
    } finally {
      fakeToggle.remove()
    }
  })
})

/* ── 全屏桥（G1，2026-09-29）──
   语义取自上游：`data-fullscreen` = 「原生窗口控件已隐藏」（dsh/apps/desktop/src/preload-platform.ts
   注 + main.ts 的 enter/leave-full-screen 真源），**与最大化无关**；上游 Windows 全屏只重置
   --dsh-frame-overlay-top(→20px) 与 --dsh-frame-chrome-top(→0)，不重置 --dsh-windows-titlebar-height，
   故 dsh 自己那条 32px 带仍在。我方栏 z-index 高于 dsh 浮层 → 只能「隐藏栏 + 置属性」，
   保留栏而置属性会让浮层顶部被栏盖住（无中间态）。 */
describe('窗口栏：全屏桥（G1）', () => {
  /** 造一个 dsh 侧栏键替身并用 resize 触发钉住（首装轮询在 E9 组已命中并停止，故走 resize 重对齐路径） */
  function fakeSidebarToggle(): HTMLElement {
    const fake = document.createElement('button')
    fake.setAttribute('aria-keyshortcuts', 'Control+B')
    fake.className = 'SidebarRoot_iconButton__a1 SidebarRoot_toggle__b2'
    fake.style.position = 'fixed'
    document.body.appendChild(fake)
    window.dispatchEvent(new Event('resize'))
    return fake
  }

  function fireKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    return event
  }

  function fullscreenEvent(on: boolean): void {
    window.dispatchEvent(new CustomEvent('worldsea:fullscreen', { detail: on }))
  }

  it('F11（无修饰键）→ cmd_shell_window_action(toggle-fullscreen) 且阻止默认', async () => {
    calls = []
    nextOutcome = () => ({ maximized: false, fullscreen: false })
    const event = fireKey('F11')
    expect(event.defaultPrevented).toBe(true)
    expect(windowActions()).toEqual(['toggle-fullscreen'])
    await flush()
  })

  it('F11 带任一修饰键 / IME 组词期 → 不触发（照 TitleBar.vue 的窗口控制键口径）', () => {
    calls = []
    fireKey('F11', { ctrlKey: true })
    fireKey('F11', { shiftKey: true })
    fireKey('F11', { altKey: true })
    fireKey('F11', { metaKey: true })
    fireKey('F11', { isComposing: true })
    /* keyCode 229 = IME 处理中（jsdom 的 KeyboardEvent init 不收 keyCode，故覆写属性） */
    const ime = new KeyboardEvent('keydown', { key: 'F11', bubbles: true, cancelable: true })
    Object.defineProperty(ime, 'keyCode', { value: 229 })
    window.dispatchEvent(ime)
    expect(windowActions()).toEqual([])
  })

  it('最大化 ≠ 全屏：maximized:true 不得置 data-fullscreen（52px 内缩必须保住）', async () => {
    calls = []
    nextOutcome = () => ({ maximized: true, fullscreen: false })
    click(bar().querySelector('.wstb-max') as HTMLElement)
    await flush()
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false)
    expect(bar().style.display).toBe('')
    nextOutcome = () => ({ maximized: false, fullscreen: false })
    click(bar().querySelector('.wstb-max') as HTMLElement)
    await flush()
  })

  it('进全屏 → 置 html[data-fullscreen] + 隐藏窗口栏 + 解除侧栏键内联钉住（回 dsh 原生定位）', async () => {
    const fake = fakeSidebarToggle()
    expect(fake.style.zIndex).toBe('2147483001')
    try {
      nextOutcome = () => ({ maximized: false, fullscreen: true })
      fireKey('F11')
      await flush()
      expect(document.documentElement.getAttribute('data-fullscreen')).toBe('true')
      /* 必须走内联 display:none——`hidden` 属性会被本栏的 author 级 display:flex 压掉 */
      expect(bar().style.display).toBe('none')
      expect(fake.style.left).toBe('')
      expect(fake.style.top).toBe('')
      expect(fake.style.zIndex).toBe('')
    } finally {
      nextOutcome = () => ({ maximized: false, fullscreen: false })
      fullscreenEvent(false)
      await flush()
      fake.remove()
    }
  })

  it('退全屏 → 三项全还原（属性删除 / 栏可见 / 侧栏键重新钉回槽位）', async () => {
    const fake = fakeSidebarToggle()
    try {
      nextOutcome = () => ({ maximized: false, fullscreen: true })
      fireKey('F11')
      await flush()
      /* 先钉住「确实进过全屏」，否则本用例会因全程无变化而空转通过 */
      expect(document.documentElement.getAttribute('data-fullscreen')).toBe('true')
      expect(bar().style.display).toBe('none')
      expect(fake.style.zIndex).toBe('')

      nextOutcome = () => ({ maximized: false, fullscreen: false })
      fireKey('F11')
      await flush()
      expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false)
      expect(bar().style.display).toBe('')
      expect(fake.style.zIndex).toBe('2147483001')
      expect(fake.style.left).not.toBe('')
    } finally {
      fake.remove()
    }
  })

  it('菜单路径（Rust 发起）：worldsea:fullscreen CustomEvent 与返回值路径等效', async () => {
    fullscreenEvent(true)
    await flush()
    expect(document.documentElement.getAttribute('data-fullscreen')).toBe('true')
    expect(bar().style.display).toBe('none')
    fullscreenEvent(false)
    await flush()
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false)
    expect(bar().style.display).toBe('')
  })

  it('全屏下 resize → 侧栏键不得被重新钉回（钉住守卫；否则键会落到已隐藏槽位的 0,0）', async () => {
    nextOutcome = () => ({ maximized: false, fullscreen: true })
    fullscreenEvent(true)
    await flush()
    const fake = document.createElement('button')
    fake.setAttribute('aria-keyshortcuts', 'Control+B')
    fake.className = 'SidebarRoot_iconButton__a1 SidebarRoot_toggle__b2'
    fake.style.position = 'fixed'
    document.body.appendChild(fake)
    try {
      window.dispatchEvent(new Event('resize'))
      expect(fake.style.left).toBe('')
      expect(fake.style.zIndex).toBe('')
    } finally {
      fake.remove()
      nextOutcome = () => ({ maximized: false, fullscreen: false })
      fullscreenEvent(false)
      await flush()
    }
  })

  it('跨文件契约：菜单回传的事件名与脚本监听一致（防两侧字面量漂移）', () => {
    const menu = readFileSync(join(process.cwd(), 'apps/tauri/src-tauri/src/menu.rs'), 'utf8')
    expect(menu).toContain('worldsea:fullscreen')
    expect(SOURCE).toContain('worldsea:fullscreen')
  })
})

/* ── 窗口控制键与空间切换键（G1 收尾，2026-09-30）──
   对齐工作台窗 `TitleBar.vue:139-148` 的四键口径（Ctrl+M 最小化 / F10 最大化还原 / F11 全屏 /
   Ctrl+W 关闭；F11 已在上组），并接 Ctrl+Tab 切空间（全屏下唯一通路）。
   相位 = **冒泡**：dsh runtime=web（`client/dom.ts`：data-platform 缺席 → web）——`page.close`
   在 web 档是 Ctrl+Alt+W，裸 Ctrl+W/F10/Ctrl+M/Ctrl+Tab 均无上游默认绑定；冒泡让「上游已处理
   （defaultPrevented）」与「终端区局部语义」先走：终端里 Ctrl+M＝回车、Ctrl+W＝删词、F10 是
   TUI 功能键，一律不抢（`.xterm` 容器内让行）；Ctrl+Tab 无终端语义，终端聚焦时也可切。 */
describe('窗口栏：窗口控制键与空间切换键（G1 收尾）', () => {
  /** 从指定目标派发（冒泡到 window；capture 让行用例需要非 window 目标，见该用例注） */
  function fireKeyOn(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('Ctrl+M → minimize / Ctrl+W → close / F10（无修饰）→ toggle-maximize，且都阻止默认', () => {
    calls = []
    expect(fireKeyOn(window, 'm', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(fireKeyOn(window, 'w', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(fireKeyOn(window, 'F10').defaultPrevented).toBe(true)
    expect(windowActions()).toEqual(['minimize', 'close', 'toggle-maximize'])
  })

  it('修饰键门槛照 TitleBar.vue：Ctrl+M/Ctrl+W 需 mod 且无 alt/shift；F10 不得带任何修饰', () => {
    calls = []
    fireKeyOn(window, 'm') // 无 mod
    fireKeyOn(window, 'm', { ctrlKey: true, altKey: true })
    fireKeyOn(window, 'w', { ctrlKey: true, shiftKey: true })
    fireKeyOn(window, 'w', { ctrlKey: true, altKey: true })
    fireKeyOn(window, 'F10', { ctrlKey: true })
    fireKeyOn(window, 'F10', { shiftKey: true })
    expect(windowActions()).toEqual([])
  })

  it('Ctrl+Tab → cmd_shell_space_switch(workbench)；Shift/Alt 组合不触发', async () => {
    calls = []
    const event = fireKeyOn(window, 'Tab', { ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    await flush()
    const switchCall = calls.find(call => call.command === 'cmd_shell_space_switch')
    expect(switchCall?.args.target).toBe('workbench')
    fireKeyOn(window, 'Tab', { ctrlKey: true, shiftKey: true })
    fireKeyOn(window, 'Tab', { ctrlKey: true, altKey: true })
    await flush()
    expect(calls.filter(call => call.command === 'cmd_shell_space_switch').length).toBe(1)
  })

  it('IME 组词期（isComposing / keyCode 229）→ 全部键让行', () => {
    calls = []
    fireKeyOn(window, 'w', { ctrlKey: true, isComposing: true })
    fireKeyOn(window, 'm', { ctrlKey: true, isComposing: true })
    const ime = new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true })
    Object.defineProperty(ime, 'keyCode', { value: 229 })
    window.dispatchEvent(ime)
    expect(windowActions()).toEqual([])
    expect(calls.filter(call => call.command === 'cmd_shell_space_switch')).toEqual([])
  })

  it('上游已处理（defaultPrevented）→ 让行，不双重触发', () => {
    calls = []
    const blocker = (event: KeyboardEvent): void => { event.preventDefault() }
    window.addEventListener('keydown', blocker, true)
    try {
      /* 目标取 body 而非 window：对 window 直派时该节点同时是 target，捕获/冒泡监听按注册顺序混排，
         拦不住先注册的脚本处理器；从子节点冒泡才能让「window 捕获相位 = 真·先手」成立。 */
      fireKeyOn(document.body, 'w', { ctrlKey: true })
      fireKeyOn(document.body, 'F10')
      fireKeyOn(document.body, 'Tab', { ctrlKey: true })
      expect(windowActions()).toEqual([])
      expect(calls.filter(call => call.command === 'cmd_shell_space_switch')).toEqual([])
    } finally {
      window.removeEventListener('keydown', blocker, true)
    }
  })

  it('终端区（.xterm 内）Ctrl+M / Ctrl+W / F10 让行且不阻止默认；Ctrl+Tab 仍可切', async () => {
    calls = []
    const term = document.createElement('div')
    term.className = 'xterm'
    const inner = document.createElement('textarea')
    term.appendChild(inner)
    document.body.appendChild(term)
    try {
      const m = fireKeyOn(inner, 'm', { ctrlKey: true })
      const w = fireKeyOn(inner, 'w', { ctrlKey: true })
      const f = fireKeyOn(inner, 'F10')
      expect([m.defaultPrevented, w.defaultPrevented, f.defaultPrevented]).toEqual([false, false, false])
      expect(windowActions()).toEqual([])

      fireKeyOn(inner, 'Tab', { ctrlKey: true })
      await flush()
      expect(calls.some(call => call.command === 'cmd_shell_space_switch')).toBe(true)
    } finally {
      term.remove()
    }
  })
})

/* G1-c（2026-09-30）：工作台窗全屏隐栏的**接线锁**——隐栏的真实行为在真机走查看，这里只钉接线
   不漂移（类名绑定 / 隐栏 CSS / 全屏态读取三个锚点；任一处被摘掉即报红）。 */
describe('工作台窗全屏隐栏接线（G1-c，跨文件契约）', () => {
  it('TitleBar.vue：全屏态绑定 is-fullscreen 类 + 隐栏 CSS + 从窗口读全屏态 + 进全屏先脱最大化', () => {
    const vue = readFileSync(join(process.cwd(), 'apps/tauri/src/ui/layout/TitleBar.vue'), 'utf8')
    expect(vue).toContain("'is-fullscreen': fullscreen")
    expect(vue).toContain('.titlebar.is-fullscreen')
    expect(vue).toContain('isFullscreen()')
    // G1 收尾批修：tao 全屏不脱最大化 → 任务栏条/坏组合；进全屏前须 unmaximize
    expect(vue).toContain('unmaximize()')
    expect(vue).toContain('isMaximized()')
  })
})

/* 须置于文件末尾：本组做二次真实安装（清幂等标记 + 摘旧 DOM），会再挂一份监听器 */
describe('窗口栏：全屏桥挂载恢复（G1）', () => {
  it('挂载时壳回 fullscreen:true → 直接落全屏形态（全屏中重载不退回窗口态 CSS，对齐上游 main.ts:244）', async () => {
    delete (globalThis as { __WORLDSEA_TITLEBAR__?: unknown }).__WORLDSEA_TITLEBAR__
    document.getElementById('worldsea-titlebar')?.remove()
    document.getElementById('worldsea-titlebar-style')?.remove()
    document.documentElement.removeAttribute('data-fullscreen')
    calls = []
    nextOutcome = () => ({ maximized: false, fullscreen: true })
    evalScript()
    await flush()
    expect(windowActions()).toContain('is-maximized')
    expect(document.documentElement.getAttribute('data-fullscreen')).toBe('true')
    expect(bar().style.display).toBe('none')
  })
})
