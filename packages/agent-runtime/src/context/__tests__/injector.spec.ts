import { describe, it, expect } from 'vitest'
import { buildSharedBaseLayer, buildSystemPrompt } from '../injector'

const baseParams = {
  projectName: '测试项目',
  entityTypes: ['角色', '地点', '事件'],
  relationTypes: ['属于', '关联'],
}

describe('buildSharedBaseLayer', () => {
  it('returns a string containing project info (entity types, relation types)', () => {
    const result = buildSharedBaseLayer(baseParams)
    expect(result).toContain('角色')
    expect(result).toContain('地点')
    expect(result).toContain('事件')
    expect(result).toContain('属于')
    expect(result).toContain('关联')
    expect(result).toContain('可用实体类型')
    expect(result).toContain('可用关系类型')
  })

  it('contains tool usage strategy section', () => {
    const result = buildSharedBaseLayer(baseParams)
    expect(result).toContain('工具使用策略')
    expect(result).toContain('先查后建')
    expect(result).toContain('批量优先')
  })

  it('contains output capability section (12 output tools)', () => {
    const result = buildSharedBaseLayer(baseParams)
    expect(result).toContain('输出能力')
    expect(result).toContain('output_table')
    expect(result).toContain('output_choice')
    expect(result).toContain('output_code')
    expect(result).toContain('output_entity_card')
    expect(result).toContain('output_alert')
    expect(result).toContain('output_stat')
    expect(result).toContain('output_list')
    expect(result).toContain('output_progress')
    expect(result).toContain('output_comparison')
    expect(result).toContain('output_timeline')
    expect(result).toContain('output_image')
    expect(result).toContain('output_accordion')
  })

  it('contains image generation capability section', () => {
    const result = buildSharedBaseLayer(baseParams)
    expect(result).toContain('图像生成能力')
    expect(result).toContain('image_generate')
    expect(result).toContain('image_gen_config')
    expect(result).toContain('image_list')
    expect(result).toContain('image_show')
  })

  it('contains session management capability section', () => {
    const result = buildSharedBaseLayer(baseParams)
    expect(result).toContain('会话管理能力')
    expect(result).toContain('session_info')
    expect(result).toContain('session_list')
    expect(result).toContain('session_read')
  })

  it('works with empty entity/relation types', () => {
    const result = buildSharedBaseLayer({
      ...baseParams,
      entityTypes: [],
      relationTypes: [],
    })
    expect(result).toContain('可用实体类型:')
    expect(result).toContain('可用关系类型:')
    // Should still contain other sections
    expect(result).toContain('工具使用策略')
    expect(result).toContain('输出能力')
  })

  it('uses "web" platform by default', () => {
    const result = buildSharedBaseLayer(baseParams)
    expect(result).toContain('Web 浏览器')
    expect(result).toContain('UI 渲染')
  })
})

describe('buildSystemPrompt', () => {
  it('contains the default identity declaration ("WorldSmith 的 AI 助手")', () => {
    const result = buildSystemPrompt(baseParams)
    expect(result).toContain('WorldSmith 的 AI 助手')
    expect(result).toContain('测试项目')
  })

  it('contains all shared base layer content (by checking for known markers)', () => {
    const result = buildSystemPrompt(baseParams)
    expect(result).toContain('工具使用策略')
    expect(result).toContain('输出能力')
    expect(result).toContain('图像生成能力')
    expect(result).toContain('会话管理能力')
  })

  it('with personaPreset, includes persona instruction', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      personaPreset: 'creative',
    })
    expect(result).toContain('人格设定')
    expect(result).toContain('富有创造力的写手')
    expect(result).toContain('比喻')
  })

  it('without personaPreset, no persona section', () => {
    const result = buildSystemPrompt(baseParams)
    expect(result).not.toContain('人格设定')
  })

  it('backward compatible: same output structure as before the split', () => {
    const result = buildSystemPrompt(baseParams)
    // The full prompt should start with identity, then contain the base layer
    const identityIndex = result.indexOf('WorldSmith 的 AI 助手')
    const projectInfoIndex = result.indexOf('可用实体类型')
    const toolStrategyIndex = result.indexOf('工具使用策略')
    const outputIndex = result.indexOf('输出能力')
    // Identity should come before project info, which comes before tool strategy, which comes before output
    expect(identityIndex).toBeLessThan(projectInfoIndex)
    expect(projectInfoIndex).toBeLessThan(toolStrategyIndex)
    expect(toolStrategyIndex).toBeLessThan(outputIndex)
  })
})
