/**
 * 设置分类目录 —— 分类元数据与搜索关键词的唯一来源。
 * 2026-10-23 自 SettingsDialog.vue 抽出，新增「首页」分类。
 */
export const SETTINGS_CATEGORIES = [
  { id: 'appearance', icon: 'cat-appearance', label: '外观' },
  { id: 'accessibility', icon: 'motion', label: '动画效果' },
  { id: 'icons', icon: 'image', label: '图标' },
  { id: 'home', icon: 'home', label: '首页' },
  { id: 'plugins', icon: 'cat-plugins', label: '插件' },
  { id: 'editor', icon: 'cat-editor', label: '编辑' },
  { id: 'layout', icon: 'cat-layout', label: '布局' },
  { id: 'outline', icon: 'outline', label: '大纲' },
  { id: 'detail', icon: 'data-entity', label: '实体详情' },
  { id: 'relations', icon: 'cat-relations', label: '关系' },
  { id: 'shortcuts', icon: 'cat-shortcuts', label: '快捷键' },
  { id: 'storage', icon: 'cat-storage', label: '存储' },
  { id: 'about', icon: 'info', label: '关于' },
] as const

export const SETTINGS_CATEGORY_KEYWORDS: Record<string, string> = {
  appearance: '主题 外观 深色 浅色 宇宙 极光 锻造 水墨 棱镜 编辑器 高亮 脉冲 动画 淡化 扩散 透明度 theme highlight 字体 字体库 字体分层 导入 变体 背景 壁纸 背景图 wallpaper',
  icons: '图标 图标库 芽 实体 实体类型 语义域 详情 页签 tab 区域类型 全局 项目 跟随 icon icons sprout entity domain detail tab region global project',
  home: '首页 主页 项目首页 封面 简介 一句话 短文 tagline about cover profile',
  plugins: '插件 外部插件 内置插件 功能插件 常驻 非芽 芽 扩展 模块 启用 禁用 内置 本地 远程 外部 sprout 分组 全选 源码 重载 装载 plugin external puzzle utility',
  editor: '编辑 撤销 重做 历史 大纲 内嵌 光标 平滑 undo redo outline caret smooth',
  layout: '布局 面板 思维导图 中心节点 字段 预设 宽度 panel mindmap field 时间线 timeline 拖拽 泳道 甘特图 紧凑 分组 手机预览 phone preview',
  outline: '大纲 白板 编辑面板 悬浮 定位 跟随 卡片 outline board inspector follow fixed',
  relations: '关系 自动 创建 实体 引用 图谱 选择器 relation auto create',
  shortcuts: '快捷键 键盘 快捷 绑定 shortcut keyboard',
  storage: '存储 清理 孤立 文件 诊断 缓存 空间 配额 storage cleanup orphan diagnostic',
  accessibility: '动画效果 减弱动态 动画 动效 消息 脉冲 状态 面板 侧边栏 弹窗 控件 启动 眩晕 降低 可访问 reduce motion accessibility',
  about: '关于 版本 产品 WorldSea about version',
}
