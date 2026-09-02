/** WORLD.md 节奏型注入纯逻辑回归（H5 八文件体系，2026-08-30 拍板） */
import { describe, expect, it } from 'vitest'
import {
  WorldRulesTrigger,
  clampTriggerThreshold,
  extractWorldRuleSections,
} from '../world-rules'

describe('clampTriggerThreshold', () => {
  it('默认值与范围夹取', () => {
    expect(clampTriggerThreshold(undefined)).toBe(20)
    expect(clampTriggerThreshold('abc')).toBe(20)
    expect(clampTriggerThreshold(0)).toBe(1)
    expect(clampTriggerThreshold(-5)).toBe(1)
    expect(clampTriggerThreshold(999)).toBe(150)
    expect(clampTriggerThreshold('35.9')).toBe(35)
    expect(clampTriggerThreshold(20)).toBe(20)
  })
})

describe('extractWorldRuleSections', () => {
  const md = [
    '# 世界观固定规则',
    '',
    '## 角色',
    '角色命名用中文。',
    '主角必须有缺陷。',
    '',
    '## 地域',
    '地名需附地理特征。',
    '',
    '## 通用',
    '所有设定需自洽。',
  ].join('\n')

  it('按 typeKey 匹配节（label 映射「角色」→ character 场景由调用方传入）', () => {
    const out = extractWorldRuleSections(md, ['role'], ['角色'])
    expect(out).toContain('## 角色')
    expect(out).toContain('主角必须有缺陷')
    expect(out).not.toContain('## 地域')
  })

  it('label 直接匹配显示名', () => {
    const out = extractWorldRuleSections(md, ['region'], ['地域'])
    expect(out).toContain('地名需附地理特征')
    expect(out).not.toContain('## 角色')
  })

  it('标题 includes 类型键（宽松匹配，如 heading "## NPC 角色规则" 匹配 npc）', () => {
    const md2 = ['## NPC 角色规则', 'NPC 命名需带姓氏。', '', '## 地域', '地名需附地理特征。'].join('\n')
    const out = extractWorldRuleSections(md2, ['npc'], [])
    expect(out).toContain('## NPC 角色规则')
    expect(out).not.toContain('## 地域')
  })

  it('无匹配节兜底返回全文', () => {
    const out = extractWorldRuleSections(md, ['item'], ['物品'])
    expect(out).toBe(md)
  })

  it('内容无二级标题 → 全文兜底', () => {
    const flat = '只有一段规则，没有分节。'
    expect(extractWorldRuleSections(flat, ['character'], ['角色'])).toBe(flat)
  })

  it('空内容返回 null', () => {
    expect(extractWorldRuleSections('   ', ['character'])).toBeNull()
  })

  it('多类型合并提取多节（label 映射跨语言标题）', () => {
    const out = extractWorldRuleSections(md, ['character', 'region'], ['角色', '地域'])
    expect(out).toContain('## 角色')
    expect(out).toContain('## 地域')
    expect(out).not.toContain('## 通用')
  })
})

describe('WorldRulesTrigger', () => {
  it('满阈值触发并归零，返回窗口内类型集合', () => {
    const t = new WorldRulesTrigger(3)
    expect(t.bump('character')).toBeNull()
    expect(t.bump('region')).toBeNull()
    const fired = t.bump('character')
    expect(fired).toEqual(['character', 'region'])
    expect(t.currentCount).toBe(0)
    // 触发后窗口清空：下一轮从空窗口重新收集
    expect(t.bump('item')).toBeNull()
  })

  it('阈值可实时更新（用户可配置 1-150）', () => {
    const t = new WorldRulesTrigger(20)
    t.setThreshold(2)
    t.bump('a')
    expect(t.bump('b')).toEqual(['a', 'b'])
  })

  it('重复类型窗口去重', () => {
    const t = new WorldRulesTrigger(2)
    t.bump('character')
    const fired = t.bump('character')
    expect(fired).toEqual(['character'])
  })
})
