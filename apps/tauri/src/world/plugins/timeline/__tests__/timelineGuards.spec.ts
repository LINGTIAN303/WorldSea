/**
 * 时间线收口守卫（T5）：
 * ① 视图层不得回退到硬编码纪元数学或直接读 properties.era（迁移层除外）；
 * ② 「拖拽改时间」设置必须有消费方，不得成为死开关；
 * ③ 时间体系必须随项目导出/导入（目录文件 + 打包分区两条链）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TIMELINE_DIR = join(ROOT, 'apps', 'tauri', 'src', 'world', 'plugins', 'timeline')
const SKIP_DIRS = new Set(['__tests__', 'node_modules'])

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collect(full, acc)
    else if (/\.(ts|vue)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

/** 剥除注释：防空注释满足守卫（沿用 shortcutCatalog 的既有做法） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const sources = collect(TIMELINE_DIR).map(file => ({
  file: file.replace(ROOT + '\\', '').replace(/\\/g, '/'),
  text: stripComments(readFileSync(file, 'utf8')),
}))

function find(pattern: RegExp, exclude: (file: string) => boolean = () => false): string[] {
  return sources.filter(item => !exclude(item.file) && pattern.test(item.text)).map(item => item.file)
}

describe('时间线守卫 / 硬编码与旧字段', () => {
  it('除迁移层外不出现 era * 10000', () => {
    expect(find(/era\s*\*\s*10000/)).toEqual([])
  })

  it('除迁移层外不直接读 properties.era', () => {
    const offenders = find(/properties\.era/, file => file.endsWith('calendar/migrate.ts'))
    expect(offenders).toEqual([])
  })
})

describe('时间线守卫 / 设置消费方', () => {
  it('「拖拽改时间」设置接到画布（无死开关）', () => {
    const view = sources.find(item => item.file.endsWith('TimelineView.vue'))
    expect(view?.text).toContain('timelineDragEnabled')
    expect(view?.text).toContain(':drag-enabled="dragEnabled"')
    const canvas = sources.find(item => item.file.endsWith('components/TimelineCanvas.vue'))
    expect(canvas?.text).toContain('dragEnabled')
    expect(canvas?.text).toContain('useTimelineCanvasDrag')
  })
})

describe('时间线守卫 / 事件右键菜单', () => {
  it('壳层委托右键并把动作抛给视图（两态共用同一委托）', () => {
    const chart = sources.find(item => item.file.endsWith('components/TimelineChart.vue'))
    expect(chart?.text).toContain('@contextmenu="onContextMenu"')
    expect(chart?.text).toContain('useTimelineEventMenu')
    const view = sources.find(item => item.file.endsWith('TimelineView.vue'))
    expect(view?.text).toContain('@event-action="onEventMenu"')
  })
})

describe('时间线守卫 / 项目迁移接线', () => {
  it('时间体系同时接入目录导出与打包分区', () => {
    const entry = readFileSync(join(TIMELINE_DIR, 'index.ts'), 'utf8')
    expect(entry).toContain('registerProjectExtraProvider')
    expect(entry).toContain('registerPackSerializer')
    const extras = readFileSync(join(TIMELINE_DIR, 'calendar', 'projectExtras.ts'), 'utf8')
    expect(extras).toContain("TIMELINE_SETTINGS_PATH = 'settings/timeline.json'")
    expect(extras).toContain('exportTimelineSettings')
    expect(extras).toContain('importTimelineSettings')
  })
})
