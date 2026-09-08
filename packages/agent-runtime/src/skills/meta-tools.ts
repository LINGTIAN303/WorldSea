/**
 * Skill 元工具（load_skill / load_skill_reference / load_skill_asset）
 * 从 agent.ts 抽取，避免 toolbus → agent → plugin-sdk/entity-core 的 Vue 依赖链
 */
import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import type { IToolContext } from '../toolbus/types'
import { findSkillById, getEnabledSkills, CAPABILITY_TO_TOOL } from './registry'
import { loadSkillPrompt, loadSkillReference, loadSkillAsset } from './loader'

const REFERENCE_PRELOAD_MAX_TOKENS = 3000

function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.3)
}

const loadSkillTool: ToolDefinition = {
  name: 'load_skill',
  description: 'Load and activate a skill by its id. This will inject the skill instructions into your context, giving you specialized capabilities. Available skills are listed in the "Available Skills" section of your system prompt. Call this tool when the user task matches a skill description. Small reference documents (≤2) are automatically preloaded. For additional references, use load_skill_reference.',
  parameters: {
    skill_id: { type: 'string', description: 'The skill id to activate (e.g. "worldbuilding", "content-craft", "analysis-engine", "retrofit-architect", "web-scout", "roleplay")', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    alwaysAvailable: true,
    displayName: '加载技能',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext) => {
    const skillId = String(args.skill_id)
    const skill = findSkillById(skillId)
    if (!skill) {
      const available = getEnabledSkills().map(s => s.id).join(', ')
      return JSON.stringify({ ok: false, error: `Skill "${skillId}" not found`, available })
    }
    const prompt = await loadSkillPrompt(skill)
    if (!prompt) {
      return JSON.stringify({ ok: false, error: `Skill "${skillId}" has no instructions` })
    }

    const toolList = skill.capabilities
      ? [...skill.baseTools, ...skill.capabilities.internal.map(c => CAPABILITY_TO_TOOL[c] || c), ...skill.capabilities.cli.map(c => CAPABILITY_TO_TOOL[c] || c), ...skill.capabilities.mcp.map(c => CAPABILITY_TO_TOOL[c] || c)]
      : [...skill.baseTools, ...skill.allowedTools]

    const result: Record<string, unknown> = {
      ok: true,
      skill: skillId,
      name: skill.name,
      availableTools: toolList,
      instructions: prompt,
    }

    if (skill.references && skill.references.length > 0 && skill.references.length <= 2) {
      const refs: Record<string, string> = {}
      let totalTokens = estimateTokens(prompt)

      for (const refPath of skill.references) {
        if (totalTokens >= REFERENCE_PRELOAD_MAX_TOKENS) break
        const content = await loadSkillReference(skill, refPath)
        if (content) {
          const tokens = estimateTokens(content)
          if (totalTokens + tokens <= REFERENCE_PRELOAD_MAX_TOKENS) {
            const shortKey = refPath.replace('references/', '').replace(/\.md$/, '')
            refs[shortKey] = content
            totalTokens += tokens
          }
        }
      }

      if (Object.keys(refs).length > 0) {
        result.references = refs
      }
    }

    if (skill.references && skill.references.length > 2) {
      result.referencesAvailable = skill.references.map(r => r.replace('references/', '').replace(/\.md$/,''))
    }

    return JSON.stringify(result)
  },
}

const loadReferenceTool: ToolDefinition = {
  name: 'load_skill_reference',
  description: 'Load a reference document from an active skill. Note: small reference sets (≤2 files) are already preloaded when you call load_skill. Use this tool for additional references or skills with 3+ references. Returns the full reference content.',
  parameters: {
    skill_id: { type: 'string', description: 'The skill id that contains the reference', required: true },
    ref_path: { type: 'string', description: 'The reference file name (e.g. "references/algo-catalog.md")', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '加载技能参考',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext) => {
    const skillId = String(args.skill_id)
    const refPath = String(args.ref_path)
    const skill = findSkillById(skillId)
    if (!skill) {
      return JSON.stringify({ ok: false, error: `Skill "${skillId}" not found` })
    }
    const content = await loadSkillReference(skill, refPath)
    if (!content) {
      return JSON.stringify({ ok: false, error: `Reference "${refPath}" not found in skill "${skillId}"` })
    }
    return JSON.stringify({ ok: true, skill: skillId, reference: refPath, content })
  },
}

const loadAssetTool: ToolDefinition = {
  name: 'load_skill_asset',
  description: 'Load a template or static resource from an active skill. Use when you need entity templates, output format templates, or other assets referenced in the skill instructions.',
  parameters: {
    skill_id: { type: 'string', description: 'The skill id that contains the asset', required: true },
    asset_path: { type: 'string', description: 'The asset file name (e.g. "entity-templates.yaml")', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'orchestrator',
    displayName: '加载技能资源',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext) => {
    const skillId = String(args.skill_id)
    const assetPath = String(args.asset_path)
    const skill = findSkillById(skillId)
    if (!skill) {
      return JSON.stringify({ ok: false, error: `Skill "${skillId}" not found` })
    }
    const content = await loadSkillAsset(skill, assetPath)
    if (!content) {
      return JSON.stringify({ ok: false, error: `Asset "${assetPath}" not found in skill "${skillId}"` })
    }
    return JSON.stringify({ ok: true, skill: skillId, asset: assetPath, content })
  },
}

export const SKILL_META_TOOLS = [loadSkillTool, loadReferenceTool, loadAssetTool]
