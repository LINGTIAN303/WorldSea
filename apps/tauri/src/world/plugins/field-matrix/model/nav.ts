export interface MatrixNavItem {
  id: string
  label: string
  meta?: string
  count?: number
}

export interface MatrixNavGroup {
  title: string
  items: MatrixNavItem[]
  /** 固定在目录顶部、不参与滚动的分组（当前仅「总览」） */
  fixed?: boolean
}
