import { describe, expect, it, beforeEach } from 'vitest'
import {
  createSimpleCalendar,
  createThreeEraCalendar,
  createGregorianCalendar,
  createDeepChainCalendar,
} from '../defaults'
import { createCalendarRuntime } from '../math'
import { validateCalendar } from '../validate'
import { parseTimePoint, parseUnitValue } from '../parse'
import { formatTimePoint } from '../format'
import { scalarRange } from '../fuzzy'
import { expandRecurrence, formatRecurrenceSummary } from '../recurrence'
import { migrateEventDates } from '../migrate'
import { parseDate, parseDateRange, detectEras } from '../legacy'
import {
  ensureTimelineCalendars,
  loadCalendars,
  saveActiveCalendarId,
  saveCalendar,
  removeCalendar,
  loadActiveCalendarId,
  exportTimelineSettings,
  importTimelineSettings,
} from '../store'
import type { Calendar } from '../types'

const simple = createSimpleCalendar()
const simpleRt = createCalendarRuntime(simple)

describe('简式历法：解析 / 换算 / 格式化', () => {
  it('解析中文纪年并往返', () => {
    const parsed = parseTimePoint('第三纪元147年', simple)
    expect(parsed).not.toBeNull()
    expect(parsed!.point.values).toEqual([3, 147])
    expect(formatTimePoint(parsed!.point, simple)).toBe('第三纪元147年')
  })

  it('只写年份时补默认纪元，但记录精度', () => {
    const parsed = parseTimePoint('147年', simple)!
    expect(parsed.point.values).toEqual([1, 147])
    expect(parsed.parsedLevels).toEqual([1])
  })

  it('标量与取值向量互逆', () => {
    const point = parseTimePoint('第三纪元147年', simple)!.point
    const scalar = simpleRt.toScalar(point)
    expect(scalar).toBe(20146)
    expect(simpleRt.fromScalar(scalar).values).toEqual([3, 147])
  })

  it('按精度计算跨度：只写年 = 一年', () => {
    const yearOnly = parseTimePoint('第三纪元147年', simple)!.point
    expect(simpleRt.spanOf(yearOnly)).toBe(1)
    const eraOnly = parseTimePoint('第三纪元', simple)!.point
    expect(simpleRt.spanOf(eraOnly)).toBe(10000)
  })

  it('模糊限定词进入 certainty 且格式化保留', () => {
    const parsed = parseTimePoint('约 第三纪元147年', simple)!
    expect(parsed.point.certainty).toBe('approx')
    expect(formatTimePoint(parsed.point, simple)).toBe('约 第三纪元147年')
  })

  it('未知文本返回 null，不伪造日期', () => {
    expect(parseTimePoint('不可考', simple)).toBeNull()
    expect(parseTimePoint('?', simple)).toBeNull()
  })
})

describe('命名纪元与无界末尾', () => {
  const calendar = createThreeEraCalendar()
  const runtime = createCalendarRuntime(calendar)

  it('第二纪元 50 年 = 1049', () => {
    const point = parseTimePoint('第二纪元50年', calendar)!.point
    expect(runtime.toScalar(point)).toBe(1049)
    expect(runtime.fromScalar(1049).values).toEqual(['e2', 50])
  })

  it('第三纪元无界，后续标量仍可落到年', () => {
    const point = parseTimePoint('第三纪元1年', calendar)!.point
    expect(runtime.toScalar(point)).toBe(2000)
    expect(runtime.fromScalar(2000).values).toEqual(['e3', 1])
  })

  it('命名纪元名可单独解析', () => {
    expect(parseUnitValue('第二纪元', calendar.units[0])).toBe('e2')
  })
})

describe('完整历法：变长月与闰年', () => {
  const calendar = createGregorianCalendar()
  const runtime = createCalendarRuntime(calendar)

  it('公历闰年 2024-02-29 往返', () => {
    const point = parseTimePoint('公元2024年二月29日12时', calendar)!.point
    expect(point.values).toEqual(['ce', 2024, 'm2', 29, 12])
    const scalar = runtime.toScalar(point)
    expect(runtime.fromScalar(scalar).values).toEqual(['ce', 2024, 'm2', 29, 12])
  })

  it('1900 不闰、2000 闰', () => {
    const feb1900 = parseTimePoint('公元1900年二月1日', calendar)!.point
    const feb2000 = parseTimePoint('公元2000年二月1日', calendar)!.point
    const march1900 = parseTimePoint('公元1900年三月1日', calendar)!.point
    const march2000 = parseTimePoint('公元2000年三月1日', calendar)!.point
    expect(runtime.toScalar(march1900) - runtime.toScalar(feb1900)).toBe(28 * 24)
    expect(runtime.toScalar(march2000) - runtime.toScalar(feb2000)).toBe(29 * 24)
  })

  it('跨年平移会钳制到当月最后一天', () => {
    const leapDay = parseTimePoint('公元2024年二月29日', calendar)!.point
    const nextYear = runtime.shift(leapDay, 'year', 1)
    expect(nextYear.values).toEqual(['ce', 2025, 'm2', 28])
  })

  it('跨月平移会钳制到目标月最后一天', () => {
    const jan31 = parseTimePoint('公元2024年一月31日', calendar)!.point
    const feb = runtime.shift(jan31, 'month', 1)
    expect(feb.values).toEqual(['ce', 2024, 'm2', 29])
  })

  it('星期按日锚点计算', () => {
    expect(runtime.weekday(0)?.name).toBe('周一')
    expect(runtime.weekday(24)?.name).toBe('周二')
  })
})

describe('任意层级单位链', () => {
  const calendar = createDeepChainCalendar()
  const runtime = createCalendarRuntime(calendar)

  it('劫/会/元/运/世/年 往返', () => {
    const point = parseTimePoint('2劫3会4元5运6世7年', calendar)!.point
    expect(point.values).toEqual([2, 3, 4, 5, 6, 7])
    const scalar = runtime.toScalar(point)
    const back = runtime.fromScalar(scalar)
    expect(back.values).toEqual([2, 3, 4, 5, 6, 7])
    expect(formatTimePoint(back, calendar)).toBe('2劫3会4元5运6世7年')
  })
})

describe('历法校验', () => {
  it('缺 factor 的非最小单位报错', () => {
    const calendar: Calendar = {
      id: 'bad', name: '坏历法',
      units: [
        { id: 'a', name: '甲', kind: 'numeric' },
        { id: 'b', name: '乙', kind: 'numeric' },
      ],
    }
    expect(validateCalendar(calendar).some(error => error.path.includes('factor'))).toBe(true)
  })

  it('命名值缺长度（非顶层末尾）报错', () => {
    const calendar: Calendar = {
      id: 'bad', name: '坏历法',
      units: [
        { id: 'a', name: '甲', kind: 'numeric', factor: 10 },
        { id: 'b', name: '乙', kind: 'named', values: [{ id: 'x', name: 'X' }] },
        { id: 'c', name: '丙', kind: 'numeric' },
      ],
    }
    expect(validateCalendar(calendar).some(error => error.path.includes('values'))).toBe(true)
  })

  it('内置模板全部通过校验', () => {
    for (const calendar of [
      createSimpleCalendar(), createThreeEraCalendar(), createGregorianCalendar(), createDeepChainCalendar(),
    ]) {
      expect(validateCalendar(calendar)).toEqual([])
    }
  })
})

describe('周期事件', () => {
  const calendar = createGregorianCalendar()
  const runtime = createCalendarRuntime(calendar)

  it('按年展开并尊重窗口', () => {
    const base = parseTimePoint('公元2024年一月1日', calendar)!.point
    const end = parseTimePoint('公元2027年一月1日', calendar)!.point
    const occurrences = expandRecurrence(base, { unit: 'year', every: 1 }, runtime, {
      start: runtime.toScalar(base), end: runtime.toScalar(end),
    })
    expect(occurrences.map(item => item.values[1])).toEqual([2024, 2025, 2026, 2027])
  })

  it('跳过列表生效', () => {
    const base = parseTimePoint('公元2024年一月1日', calendar)!.point
    const until = parseTimePoint('公元2026年一月1日', calendar)!.point
    const occurrences = expandRecurrence(
      base,
      { unit: 'year', every: 1, until: '公元2026年一月1日', exceptions: ['公元2025年一月1日'] },
      runtime,
      { start: runtime.toScalar(base), end: runtime.toScalar(until) },
    )
    expect(occurrences.map(item => item.values[1])).toEqual([2024, 2026])
  })
})

describe('模糊日期区间', () => {
  it('早于 = 左无穷，晚于 = 右无穷', () => {
    const before = parseTimePoint('早于 第三纪元147年', simple)!.point
    const after = parseTimePoint('晚于 第三纪元147年', simple)!.point
    expect(scalarRange(simpleRt, before).start).toBe(Number.NEGATIVE_INFINITY)
    expect(scalarRange(simpleRt, after).end).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('旧日期迁移', () => {
  const calendar = createSimpleCalendar()

  it('纪元字段补进日期并生成规范文本', () => {
    const result = migrateEventDates([
      { id: 'a', properties: { date: '147年', era: '第三纪元' } },
      { id: 'b', properties: { date: '第三纪元147年', dateEnd: '第三纪元148年' } },
    ], calendar)
    expect(result.updated).toBe(2)
    const a = result.updates.find(item => item.id === 'a')!
    expect(a.properties.date).toBe('第三纪元147年')
    expect(a.properties.calendarId).toBe(calendar.id)
    const b = result.updates.find(item => item.id === 'b')!
    expect(b.properties.dateEnd).toBe('第三纪元148年')
  })

  it('解析失败保留原文并登记失败项', () => {
    const result = migrateEventDates([
      { id: 'c', properties: { date: '不可考', era: '' } },
    ], calendar)
    expect(result.updated).toBe(0)
    expect(result.failed[0].id).toBe('c')
  })

  it('已迁移且可解析的事件不重复改写', () => {
    const result = migrateEventDates([
      { id: 'd', properties: { date: '第三纪元147年', calendarId: calendar.id } },
    ], calendar)
    expect(result.updated).toBe(0)
  })

  it('命名历法遇到未知纪元名会登记，供面板补值', () => {
    const result = migrateEventDates([
      { id: 'e', properties: { date: '2024年', era: '灰烬纪元' } },
    ], createGregorianCalendar())
    expect(result.missingEraNames).toContain('灰烬纪元')
  })
})

describe('旧解析器兼容层', () => {
  it('保持 era/year 契约', () => {
    expect(parseDate('第三纪元147年')).toMatchObject({ era: 3, year: 147 })
    expect(parseDate('第三纪147年')).toMatchObject({ era: 3, year: 147 })
    expect(parseDate('3纪元147年')).toMatchObject({ era: 3, year: 147 })
    expect(parseDate('147年')).toMatchObject({ era: 0, year: 147 })
    expect(parseDate('公元前100年')).toMatchObject({ era: 0, year: -100 })
    expect(parseDate('纪元：3')).toBeNull()
    expect(parseDate('?')).toBeNull()
  })

  it('范围与纪元探测', () => {
    const range = parseDateRange('第三纪元147年', '第三纪元148年')!
    expect(range.isRange).toBe(true)
    expect(range.yearEnd).toBe(148)
    const eras = detectEras([parseDate('第三纪元147年'), parseDate('第三纪元200年'), parseDate('147年')])
    expect(eras.map(era => era.name)).toEqual(['未知纪元', '第3纪元'])
  })
})

describe('历法持久化（localStorage 回退）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('首次加载自动建简式历法', async () => {
    const { calendars, activeId } = await ensureTimelineCalendars()
    expect(calendars).toHaveLength(1)
    expect(calendars[0].id).toBe('simple')
    expect(activeId).toBe('simple')
  })

  it('保存 / 读取 / 删除历法', async () => {
    await ensureTimelineCalendars()
    const calendar = createThreeEraCalendar()
    await saveCalendar(calendar)
    expect((await loadCalendars()).map(item => item.id)).toContain('three-era')
    await saveActiveCalendarId('three-era')
    await removeCalendar('three-era')
    expect((await loadCalendars()).map(item => item.id)).not.toContain('three-era')
  })

  it('项目迁移快照：merge 补缺失且幂等，overwrite 覆盖同名', async () => {
    await ensureTimelineCalendars()
    await saveCalendar(createThreeEraCalendar())
    await saveActiveCalendarId('three-era')
    const bundle = await exportTimelineSettings()
    expect(bundle.calendars.map(item => item.id)).toEqual(expect.arrayContaining(['simple', 'three-era']))
    expect(bundle.activeId).toBe('three-era')

    localStorage.clear()
    expect(await importTimelineSettings(bundle, 'merge')).toBe(2)
    expect((await loadCalendars())).toHaveLength(2)
    expect(await loadActiveCalendarId()).toBe('three-era')
    // 幂等：重复导入不重复写入
    expect(await importTimelineSettings(bundle, 'merge')).toBe(0)

    const renamed = { ...createThreeEraCalendar(), name: '三纪元（改名）' }
    expect(await importTimelineSettings({ ...bundle, calendars: [renamed] }, 'overwrite')).toBe(1)
    expect((await loadCalendars()).find(item => item.id === 'three-era')?.name).toBe('三纪元（改名）')
  })
})

describe('周期摘要（详情只读）', () => {
  const calendar = createSimpleCalendar()

  it('规则转中文摘要，含结束与跳过次数', () => {
    const raw = JSON.stringify({
      unit: 'year', every: 2, until: '第三纪元10年', exceptions: ['第三纪元4年'],
    })
    expect(formatRecurrenceSummary(raw, calendar)).toBe('每 2 年，至 第三纪元10年，跳过 1 次')
    expect(formatRecurrenceSummary(JSON.stringify({ unit: 'year', every: 1 }), calendar)).toBe('每年')
  })

  it('空值与非法 JSON 原样兜底', () => {
    expect(formatRecurrenceSummary('', calendar)).toBe('—')
    expect(formatRecurrenceSummary('not-json', calendar)).toBe('not-json')
  })
})
