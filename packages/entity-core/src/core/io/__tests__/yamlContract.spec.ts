// @vitest-environment node
/**
 * YAML 导出/导入契约（2026-11-17，js-yaml 4 → 5 升级时建立）。
 *
 * 钉两件事，都是升级时**没有测试覆盖**、只能靠手工探测才发现的：
 *
 * 1. **导出/导入往返成立**（`defaultFormatEncoder.encode` → `load`）。产品域的
 *    YAML 导出走 `yaml.dump(pack, { indent: 2, noRefs: true })`，导入走「先试 JSON
 *    → 再试 YAML」，两层都没有自己的测试。js-yaml 5 把默认 schema 从
 *    `DEFAULT_SCHEMA` 换成 `DUMP_SCHEMA`/`CORE_SCHEMA`，这类变更会让「以数字开头的
 *    字符串被解析成数字」之类的问题静默通过——故用易误解析的样本来钉。
 *
 * 2. **猜格式链安全**：ImportController 靠 `try { load(text) } catch {}` 排除不匹配
 *    的格式，再用 `'manifest' in data && 'serializers' in data` 判形状。若升级让
 *    `load` 在坏输入上不抛而是返回看似合法的对象，就会静默误判。这里逐个喂「不是
 *    本格式」的输入，断言没有一个是 WorldSeaPack 形状。
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

/** 导出端写出的形状（与 `WorldSeaPack` 的判别字段一致）。 */
const PACK = {
  manifest: {
    version: 2,
    exportedAt: '2026-11-17T00:00:00.000Z',
    counts: { entities: 1, relations: 0 },
  },
  serializers: { character: [{ id: 'c1', name: '角色 A' }] },
}

/**
 * 容易被 YAML 类型推断改写的字符串。每一项都是「dump 时不加引号就会被读成别的类型」
 * 的经典陷阱；升级换了 schema 就可能不再加引号。
 */
const TRICKY: Record<string, string> = {
  colon: 'note: this has a colon',
  leadingZeros: '007',
  boolLike: 'yes',
  nullLike: 'null',
  empty: '',
  multiline: 'line1\nline2',
  chinese: '中文标点：测试',
}

describe('YAML 导出→导入往返（js-yaml 版本无关的契约）', () => {
  it('导出再读回，结构原样（含中文与数字字面量）', async () => {
    // 走生产编码器，不另写一份等价实现——否则测的是测试自己
    const { defaultFormatEncoder } = await import('../ExportController')
    const text = await defaultFormatEncoder.encode(PACK as never, 'yaml')
    const back = load(text) as typeof PACK

    expect(back.manifest.version).toBe(2)
    expect(back.manifest.exportedAt).toBe(PACK.manifest.exportedAt)
    expect(back.serializers.character[0]!.name).toBe('角色 A')
  })

  it('易被类型推断的字符串全部原样往返（升级最容易破坏的一条）', async () => {
    const { dump } = await import('js-yaml')
    const text = dump({ tricky: TRICKY }, { indent: 2, noRefs: true })
    const back = load(text) as { tricky: Record<string, unknown> }

    expect(back.tricky).toEqual(TRICKY)
    // 单独再断言一次类型，避免 toEqual 在某些宽松比较下放过
    expect(typeof back.tricky.leadingZeros).toBe('string')
  })
})

describe('导入猜格式链：非 pack 输入不得被误判', () => {
  /** 与 ImportController 的判别条件同口径。 */
  const looksLikePack = (value: unknown): boolean =>
    !!value && typeof value === 'object' && 'manifest' in value && 'serializers' in value

  const NOT_PACKS = [
    ['空字符串', ''],
    ['纯 JSON 对象', '{"a":1}'],
    ['纯 JSON 数组', '[1,2,3]'],
    ['单行文本', 'hello world'],
    ['截断 JSON', '{"manifest": {'],
    ['缩进错乱', 'a:\n - b\n  - c'],
    ['只有注释', '# just a comment'],
    ['数字', '42'],
    ['null 字面量', 'null'],
    ['制表符缩进', 'a:\n\tb: 1'],
  ] as const

  it.each(NOT_PACKS)('%s 不被当成 WorldSeaPack', (_label, input) => {
    let value: unknown
    try {
      value = load(input)
    } catch {
      // 抛错是正常的排除方式
      return
    }
    expect(looksLikePack(value)).toBe(false)
  })

  it('真正的 pack 输入能被识别（否则上面的断言会假通过）', () => {
    const { dump } = require('js-yaml') as typeof import('js-yaml')
    expect(looksLikePack(load(dump(PACK)))).toBe(true)
  })
})
