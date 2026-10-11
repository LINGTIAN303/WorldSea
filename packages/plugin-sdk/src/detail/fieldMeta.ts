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
  /** 作用域：type＝注册表（同类型共享）/ entity＝仅当前实体（定义随实体走） */
  scope?: 'entity' | 'type'
}
