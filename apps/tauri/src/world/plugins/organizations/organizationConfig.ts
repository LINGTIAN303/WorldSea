import type { FormFieldDef } from '@worldsea/plugin-sdk'

export const orgTypes = ['王国', '帝国', '共和国', '部落', '公会', '教团', '商会', '帮派', '军事组织', '秘密组织', '其他']

export const orgTypeFilterOptions = [
  { value: '', label: '全部类型' },
  ...orgTypes.map(t => ({ value: t, label: t })),
]

/** 组织类型 → 图标（单一来源：OrgTreeNode / OrganizationView 共用；2026-10-02 收敛两份已分叉的副本）。
 *  含表单选项之外的历史遗留值（教会/佣兵团/学派/家族/商团/联盟），兜底 organization。 */
export const orgTypeIconMap: Record<string, string> = {
  '王国': 'crown', '帝国': 'building', '共和国': 'building', '部落': 'camp',
  '公会': 'wrench', '教团': 'church', '教会': 'church', '商会': 'coin',
  '帮派': 'sword', '军事组织': 'sword', '秘密组织': 'scroll', '佣兵团': 'sword',
  '学派': 'scroll', '家族': 'home', '商团': 'coin', '联盟': 'handshake',
}

export function orgIconOf(entity: { properties?: Record<string, unknown> }): string {
  const t = entity.properties?.orgType as string
  return orgTypeIconMap[t] || 'organization'
}

export const orgFields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '势力名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'orgType', label: '类型', type: 'select', options: [
    { value: '王国', label: '王国' }, { value: '帝国', label: '帝国' },
    { value: '共和国', label: '共和国' }, { value: '部落', label: '部落' },
    { value: '公会', label: '公会' }, { value: '教团', label: '教团' },
    { value: '商会', label: '商会' }, { value: '帮派', label: '帮派' },
    { value: '军事组织', label: '军事组织' }, { value: '秘密组织', label: '秘密组织' },
    { value: '其他', label: '其他' },
  ] },
  { key: 'size', label: '规模', type: 'select', options: [
    { value: '小型', label: '小型' }, { value: '中型', label: '中型' },
    { value: '大型', label: '大型' }, { value: '超大型', label: '超大型' },
  ] },
  { key: 'alignment', label: '阵营', type: 'select', options: [
    { value: '守序善良', label: '守序善良' }, { value: '中立善良', label: '中立善良' },
    { value: '混沌善良', label: '混沌善良' }, { value: '守序中立', label: '守序中立' },
    { value: '绝对中立', label: '绝对中立' }, { value: '混沌中立', label: '混沌中立' },
    { value: '守序邪恶', label: '守序邪恶' }, { value: '中立邪恶', label: '中立邪恶' },
    { value: '混沌邪恶', label: '混沌邪恶' },
  ] },
  { key: 'motto', label: '座右铭', type: 'text' },
  { key: 'headquarters', label: '总部', type: 'text' },
  { key: 'leader', label: '领袖', type: 'text' },
  { key: 'foundingDate', label: '创立日期', type: 'text' },
  { key: 'dissolutionDate', label: '解散日期', type: 'text' },
  { key: 'ideology', label: '理念/宗旨', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]
