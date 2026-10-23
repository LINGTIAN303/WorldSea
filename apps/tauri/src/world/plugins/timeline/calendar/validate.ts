/** 历法结构校验：面板保存前与加载后都跑一遍。 */
import type { Calendar, CalendarError, CalendarUnit } from './types'

function checkLeap(leap: NonNullable<CalendarUnit['leap']>, path: string, errors: CalendarError[]) {
  if (!leap.every || leap.every <= 0) errors.push({ path: `${path}.every`, message: '闰规则 every 必须大于 0' })
  if (leap.add < 0) errors.push({ path: `${path}.add`, message: '闰规则 add 不能为负' })
  if (leap.exceptEvery !== undefined && leap.exceptEvery <= 0) errors.push({ path: `${path}.exceptEvery`, message: 'exceptEvery 必须大于 0' })
  if (leap.butEvery !== undefined && leap.butEvery <= 0) errors.push({ path: `${path}.butEvery`, message: 'butEvery 必须大于 0' })
}

export function validateCalendar(calendar: Calendar): CalendarError[] {
  const errors: CalendarError[] = []
  if (!calendar.id) errors.push({ path: 'id', message: '历法缺少 id' })
  if (!calendar.units?.length) {
    errors.push({ path: 'units', message: '至少需要一个单位' })
    return errors
  }
  const ids = new Set<string>()
  const last = calendar.units.length - 1
  calendar.units.forEach((unit, level) => {
    if (!unit.id) errors.push({ path: `units[${level}].id`, message: '单位缺少 id' })
    else if (ids.has(unit.id)) errors.push({ path: `units[${level}].id`, message: `单位 id 重复：${unit.id}` })
    else ids.add(unit.id)
    if (!unit.name) errors.push({ path: `units[${level}].name`, message: '单位缺少名称' })
    if (level < last && unit.kind === 'numeric') {
      if (!unit.factor || unit.factor <= 0) {
        errors.push({ path: `units[${level}].factor`, message: `单位 ${unit.id} 需要大于 0 的 factor` })
      }
    }
    if (unit.kind === 'named') {
      const values = unit.values ?? []
      if (!values.length) {
        errors.push({ path: `units[${level}].values`, message: `命名单位 ${unit.id} 至少需要一个取值` })
      }
      const valueIds = new Set<string>()
      values.forEach((item, index) => {
        if (!item.id) errors.push({ path: `units[${level}].values[${index}].id`, message: '命名值缺少 id' })
        else if (valueIds.has(item.id)) errors.push({ path: `units[${level}].values[${index}].id`, message: `命名值 id 重复：${item.id}` })
        else valueIds.add(item.id)
        if (!item.name) errors.push({ path: `units[${level}].values[${index}].name`, message: '命名值缺少名称' })
        const length = item.length ?? unit.factor
        if (length === undefined && !(level === 0 && index === values.length - 1)) {
          errors.push({
            path: `units[${level}].values[${index}].length`,
            message: `命名值「${item.name}」缺少长度（只有顶层最后一个值可以无界）`,
          })
        }
        if (length !== undefined && length <= 0) {
          errors.push({ path: `units[${level}].values[${index}].length`, message: '命名值长度必须大于 0' })
        }
        if (item.leap) checkLeap(item.leap, `units[${level}].values[${index}].leap`, errors)
      })
    }
    if (unit.leap) {
      if (level === last) errors.push({ path: `units[${level}].leap`, message: '最小单位不能有闰规则' })
      checkLeap(unit.leap, `units[${level}].leap`, errors)
    }
  })
  if (calendar.week) {
    if (calendar.week.length <= 0) errors.push({ path: 'week.length', message: '每周天数必须大于 0' })
    if (calendar.week.names.length && calendar.week.names.length !== calendar.week.length) {
      errors.push({ path: 'week.names', message: '星期名数量与每周天数不一致' })
    }
  }
  if (calendar.timeOfDay && calendar.timeOfDay.hoursPerDay <= 0) {
    errors.push({ path: 'timeOfDay.hoursPerDay', message: '每天小时数必须大于 0' })
  }
  return errors
}
