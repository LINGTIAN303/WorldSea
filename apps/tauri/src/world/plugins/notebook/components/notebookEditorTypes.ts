// 笔记本编辑器共享类型（2026-10-18 拆件时抽出）。
// 单独成文件的原因：`<script setup>` 内不允许 ES 导出，而主组件与工具栏组件都要引用该类型。

/** 四态视图（批 4 V8 三态 + 块 3「源码」）：编辑 / 分栏 / 预览 / 源码 */
export type EditorViewMode = 'edit' | 'split' | 'preview' | 'source'
