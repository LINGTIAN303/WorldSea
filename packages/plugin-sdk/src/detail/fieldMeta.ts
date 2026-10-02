/** 详情渲染一行的字段元信息（来自类型级字段注册表） */
export interface DetailFieldMeta {
  key: string
  label: string
  /** schema 原始 fieldType，控件层内部归一 */
  fieldType: string
  options?: { value: string; label: string }[] | string[]
  refType?: string
  /** builtin＝芽声明；user/shared＝用户或共享加，可移除 */
  source?: 'builtin' | 'user' | 'shared'
}
