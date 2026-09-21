/**
 * 桥工具契约漂移校验（T5，2026-09-17）
 *
 * 契约流向：TS 工具定义（唯一事实源）→ `../bridge-spec.ts` 转换 →
 * `apps/tauri/src-tauri/src/bridge_tool_specs.json`（Rust include_str! 嵌入）。
 * 本文件是该链路的两端执行体：
 *   - 校验（默认）：对比生成物与 TS 定义，不一致即失败（vitest 全量跑测自动覆盖）；
 *   - 生成（写入模式）：`node scripts/gen-bridge-spec.mjs` 设 WORLDSEA_BRIDGE_SPEC=write 后写盘。
 *
 * 漂移后果：LLM 看到的工具契约（名称/描述/参数）与实际执行的前端实现不符——
 * 属硬 BUG，因此校验放在测试集内而非仅靠脚本自觉。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolDefinition } from '../../bridge-types'
import { entityCrudTools } from '../entity-crud'
import { contentSearchTools } from '../content-search'
import { a2uiTools } from '../a2ui-tools'
import { kbTools } from '../kb-tools'
import { projectTools } from '../project-io'
import { dailyTaskTools } from '../daily-task'
import { entityContextTools } from '../entity-context'
import { visionTools } from '../vision-tools'
import { SKILL_META_TOOLS } from '../../skills/meta-tools'
import { BRIDGE_TOOL_NAMES, buildBridgeSpec, serializeBridgeSpec } from '../bridge-spec'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Rust 侧生成物（apps/tauri/src-tauri/src/bridge_tool_specs.json） */
const ARTIFACT_PATH = path.resolve(HERE, '../../../../../apps/tauri/src-tauri/src/bridge_tool_specs.json')

/** 写入模式由生成脚本设置（见 scripts/gen-bridge-spec.mjs） */
const WRITE_MODE = process.env.WORLDSEA_BRIDGE_SPEC === 'write'

/** 桥工具可能来自的全部工具模块（合并后按 BRIDGE_TOOL_NAMES 过滤） */
const ALL_BRIDGED_SOURCES: ToolDefinition[] = [
  ...entityCrudTools,
  ...contentSearchTools,
  ...a2uiTools,
  ...SKILL_META_TOOLS,
  // S3 补桥（2026-09-18）
  ...kbTools,
  ...projectTools,
  ...dailyTaskTools,
  ...entityContextTools,
  // E2（2026-09-18）：视觉工具补桥
  ...visionTools,
]

describe('桥工具契约（TS 单源 → Rust 生成物）', () => {
  it('BRIDGE_TOOL_NAMES 均能在工具模块中找到定义且无重复', () => {
    const available = ALL_BRIDGED_SOURCES.map(tool => tool.name)
    const missing = BRIDGE_TOOL_NAMES.filter(name => !available.includes(name))
    expect(missing).toEqual([])
    expect(new Set(BRIDGE_TOOL_NAMES).size).toBe(BRIDGE_TOOL_NAMES.length)
  })

  it('生成物与 TS 定义逐字节一致（漂移检测）', () => {
    const serialized = serializeBridgeSpec(buildBridgeSpec(ALL_BRIDGED_SOURCES))
    if (WRITE_MODE) {
      writeFileSync(ARTIFACT_PATH, serialized, 'utf8')
      return
    }
    let artifact: string
    try {
      artifact = readFileSync(ARTIFACT_PATH, 'utf8')
    } catch {
      throw new Error(
        `未找到桥工具生成物：${ARTIFACT_PATH}\n请先运行：node scripts/gen-bridge-spec.mjs`,
      )
    }
    expect(artifact).toBe(serialized)
  })
})