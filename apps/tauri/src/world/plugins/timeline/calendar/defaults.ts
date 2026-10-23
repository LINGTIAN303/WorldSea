/** 内置历法模板：简式 / 公历式 / 三纪元式。 */
import type { Calendar, CalendarUnit } from './types'

export const SIMPLE_CALENDAR_ID = 'simple'

/** 简式历法：纪元 + 年（旧数据的迁移落点） */
export function createSimpleCalendar(): Calendar {
  return {
    id: SIMPLE_CALENDAR_ID,
    name: '简式历法',
    units: [
      {
        id: 'era', name: '纪元', kind: 'numeric', start: 1, factor: 10000,
        numeral: 'chinese', format: '第{value}纪元',
      },
      { id: 'year', name: '年', kind: 'numeric', start: 1, format: '{value}年' },
    ],
    format: '{0}{1}',
  }
}

const MONTH_NAMES = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
]
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** 公历式历法：纪元 + 年 + 月 + 日 + 时（含公历闰年规则） */
export function createGregorianCalendar(): Calendar {
  const months = MONTH_NAMES.map((name, index) => ({
    id: `m${index + 1}`,
    name,
    length: MONTH_DAYS[index],
    ...(index === 1
      ? { leap: { every: 4, add: 1, exceptEvery: 100, butEvery: 400 } }
      : {}),
  }))
  return {
    id: 'gregorian',
    name: '公历式历法',
    units: [
      { id: 'era', name: '纪元', kind: 'named', values: [{ id: 'ce', name: '公元' }], format: '{value}' },
      { id: 'year', name: '年', kind: 'numeric', start: 1, factor: 12, format: '{value}年' },
      { id: 'month', name: '月', kind: 'named', values: months, format: '{value}' },
      { id: 'day', name: '日', kind: 'numeric', start: 1, factor: 24, format: '{value}日' },
      { id: 'hour', name: '时', kind: 'numeric', start: 0, format: '{value}时' },
    ],
    week: {
      length: 7,
      names: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      anchorScalar: 0,
      anchorIndex: 0,
    },
    timeOfDay: { hoursPerDay: 24 },
    format: '{0}{1}{2}{3}{4}',
  }
}

/** 三纪元式历法：三个纪元依次 1000 / 1000 / 无界，年内只用年 */
export function createThreeEraCalendar(): Calendar {
  return {
    id: 'three-era',
    name: '三纪元历法',
    units: [
      {
        id: 'era', name: '纪元', kind: 'named',
        values: [
          { id: 'e1', name: '第一纪元', length: 1000 },
          { id: 'e2', name: '第二纪元', length: 1000 },
          { id: 'e3', name: '第三纪元' },
        ],
        format: '{value}',
      },
      { id: 'year', name: '年', kind: 'numeric', start: 1, format: '{value}年' },
    ],
    format: '{0}{1}',
  }
}

/** 任意层级示例：劫 → 会 → 元 → 运 → 世 → 年（只作为结构样例，数值可编辑） */
export function createDeepChainCalendar(): Calendar {
  const numeric = (id: string, name: string, factor: number): CalendarUnit => ({
    id, name, kind: 'numeric', start: 1, factor, format: `{value}${name}`,
  })
  return {
    id: 'deep-chain',
    name: '劫会元运世',
    units: [
      numeric('kalpa', '劫', 30),
      numeric('hui', '会', 12),
      numeric('yuan', '元', 30),
      numeric('yun', '运', 12),
      numeric('shi', '世', 30),
      { id: 'year', name: '年', kind: 'numeric', start: 1, format: '{value}年' },
    ],
    format: '{0}{1}{2}{3}{4}{5}',
  }
}

export interface CalendarPreset {
  id: string
  name: string
  create: () => Calendar
}

export const CALENDAR_PRESETS: CalendarPreset[] = [
  { id: 'simple', name: '简式历法（纪元 + 年）', create: createSimpleCalendar },
  { id: 'gregorian', name: '公历式历法（纪元/年/月/日/时）', create: createGregorianCalendar },
  { id: 'three-era', name: '三纪元历法（等长纪元 + 年）', create: createThreeEraCalendar },
  { id: 'deep-chain', name: '劫会元运世（任意层级示例）', create: createDeepChainCalendar },
]

/** 深拷贝一个历法并换 id（复制/新建用） */
export function cloneCalendar(source: Calendar, id: string, name?: string): Calendar {
  return {
    ...JSON.parse(JSON.stringify(source)),
    id,
    name: name ?? source.name,
    updatedAt: Date.now(),
  }
}
