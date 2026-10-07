// @vitest-environment node
/**
 * console 宿主半的**纯服务桥**形态（2026-10-07 路线 B 定稿）。
 *
 * 钉两件事：
 * ① apply 只暴露数据面服务桥 `worldseaDataFace`——**不再注册任何指令**（/entity 全量迁至
 *    客户端贡献位，见 __tests__/client.spec.ts；宿主指令与贡献位同名会 fail loud）；
 * ② 服务桥方法读 volatile 句柄现值、空串归一 null（worldsea 侧 `??` 回落链的输入语义）。
 *
 * 就绪卡事实面（三段 kind 码/计数）在壳侧 Rust `cmd_product_briefing` 实现，由
 * `apps/tauri/src-tauri/src/product_briefing.rs` 的 #[cfg(test)] 覆盖（cargo test）。
 */
import { describe, expect, it } from 'vitest'

import * as plugin from '../lib/index.js'

interface DataFace {
  dshHome: () => string | null
  dataRoot: () => string | null
}

/** 假 cordis 上下文：reflect.provide 捕获 + commands 面探测（注册必须不发生）。 */
function loadBridge(config: Record<string, unknown> = {}): {
  face: DataFace | undefined
  commandRegistrations: number
} {
  let face: DataFace | undefined
  let commandRegistrations = 0
  ;(plugin.apply as (ctx: unknown, config?: Record<string, unknown>) => void)(
    {
      reflect: { provide: (serviceName: string, value: unknown) => { if (serviceName === 'worldseaDataFace') face = value as DataFace } },
      commands: { register: () => { commandRegistrations += 1 } },
      // 故意不提供 tools/systemPrompt——宿主半不再依赖它们（inject = []）
    },
    config,
  )
  return { face, commandRegistrations }
}

/** 假 volatile 句柄（cosmokit `Volatile<T>`：物化后非原值，须经 get() 取）。 */
const volatileHandle = (value: string) => ({ get: () => value })

describe('console 宿主半：纯服务桥形态（2026-10-07）', () => {
  it('inject 声明为空：指令面已撤，宿主半只做服务桥（不依赖 commands）', () => {
    expect(plugin.inject).toEqual([])
  })

  it('apply 暴露 worldseaDataFace，且**不注册任何指令**（/entity 属客户端贡献位）', () => {
    const { face, commandRegistrations } = loadBridge()
    expect(face).toBeDefined()
    expect(commandRegistrations).toBe(0)
  })

  it('服务桥读 volatile 现值：普通值、句柄值都取到字符串', () => {
    const plain = loadBridge({ dshHome: 'C:/home-a', dataRoot: 'D:/data-b' })
    expect(plain.face!.dshHome()).toBe('C:/home-a')
    expect(plain.face!.dataRoot()).toBe('D:/data-b')

    const volatile = loadBridge({ dshHome: volatileHandle('C:/home-c'), dataRoot: volatileHandle('D:/data-d') })
    expect(volatile.face!.dshHome()).toBe('C:/home-c')
    expect(volatile.face!.dataRoot()).toBe('D:/data-d')
  })

  it('空串/空白归一 null（worldsea 侧 `??` 回落链的输入语义）', () => {
    const { face } = loadBridge({ dshHome: '   ', dataRoot: '' })
    expect(face!.dshHome()).toBeNull()
    expect(face!.dataRoot()).toBeNull()

    const missing = loadBridge({})
    expect(missing.face!.dshHome()).toBeNull()
    expect(missing.face!.dataRoot()).toBeNull()
  })
})
