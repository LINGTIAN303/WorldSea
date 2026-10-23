/**
 * 日期解析入口（兼容层）。
 * 实现已迁至 `calendar/legacy.ts`（历法内核 + 简式历法），保留既有导入路径与 ParsedDate 契约。
 */
export {
  parseDate,
  parseDateRange,
  compareDates,
  detectEras,
  datesOverlap,
  parseScalar,
  useDateParser,
} from '../calendar/legacy'
export type { ParsedDate, EraInfo } from '../calendar/legacy'
