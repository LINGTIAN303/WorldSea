/**
 * WORLDSEA.md（内置认知文档）守卫（发现路径轮，2026-09-21）
 *
 * 背景：批 3 退役 26 份芽技能时，「领域入口地图」随技能索引段一同消失——真机实测
 * 模型面对「道具实体怎么用」改用 shell / 源码检索（bash 失败 → grep → read_file → powershell），
 * 未走 worldview 工具。本轮在内置认知文档补「世界观领域（芽）」入口指向（A 线）。
 *
 * 本守卫防两件事：① 该指向被静默移除；② 示例退化为写死的完整领域清单（漂移源）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// vitest 在仓库根运行（见 vitest.config.ts），按仓库相对路径读取内置认知文档
const text = readFileSync(resolve(process.cwd(), 'apps/tauri/src/agent/rules/WORLDSEA.md'), 'utf8')

describe('WORLDSEA.md：世界观领域（芽）入口指向', () => {
  it('含 worldview 入口与三级用法（sprout / action）', () => {
    expect(text).toContain('worldview')
    expect(text).toContain('sprout')
    expect(text).toContain('action')
  })

  it('示例明示非穷尽（以运行时返回为准），不写死领域清单', () => {
    expect(text).toContain('以运行时返回为准')
  })

  it('点明「某领域怎么用」类问题的路径（不用源码 / 文件检索代偿）', () => {
    expect(text).toContain('不用源码 / 文件检索代偿')
  })
})
