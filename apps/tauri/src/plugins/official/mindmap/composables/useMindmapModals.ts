/**
 * 思维导图模态框 / 内联编辑 / 图片查看等 UI 状态集中管理
 *
 * 从 MindmapView.vue 拆出，仅承载纯 UI 状态（ref/reactive），
 * 不含业务逻辑——业务逻辑仍保留在主文件中通过解构出的 ref 操作。
 */
import { ref, reactive } from 'vue'
import type { Entity } from '@worldsmith/entity-core'

export function useMindmapModals() {
  // ===== 内联编辑（节点/边名称行内编辑）=====
  const showInlineEdit = ref(false)
  const inlineEditText = ref('')
  const inlineEditTarget = ref<string>('')
  const inlineEditStyle = ref({ left: '0px', top: '0px' })

  // ===== 各类模态框可见状态 =====
  const showTypePicker = ref(false)
  const showRelationPicker = ref(false)
  const showTagEditor = ref(false)
  const showDescEditor = ref(false)
  const showColorPicker = ref(false)

  // ===== 标签编辑器 =====
  const tagEditorText = ref('')
  const tagEditorTargetId = ref('')

  // ===== 描述编辑器 =====
  const descEditorText = ref('')
  const descEditorTargetId = ref('')

  // ===== 实体表单（新建/编辑实体）=====
  const showEntityForm = ref(false)
  const editingEntity = ref<Entity | null>(null)
  const entityFormType = ref('character')

  // ===== 关系类型选择器候选 =====
  const availableRelationTypes = ref<{ type: string; label: string }[]>([])

  // ===== 图片查看器 =====
  const imageViewer = reactive<{ show: boolean; url: string }>({ show: false, url: '' })

  // ===== 颜色选择器 =====
  const customColor = ref('#4f46e5')
  const presetColors = [
    '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4',
    '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#000000', '#ffffff',
  ]

  return {
    // 内联编辑
    showInlineEdit, inlineEditText, inlineEditTarget, inlineEditStyle,
    // 模态框可见状态
    showTypePicker, showRelationPicker, showTagEditor, showDescEditor, showColorPicker,
    // 标签编辑器
    tagEditorText, tagEditorTargetId,
    // 描述编辑器
    descEditorText, descEditorTargetId,
    // 实体表单
    showEntityForm, editingEntity, entityFormType,
    // 关系类型
    availableRelationTypes,
    // 图片查看器
    imageViewer,
    // 颜色选择器
    customColor, presetColors,
  }
}
