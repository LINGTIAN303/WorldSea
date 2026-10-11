import type { FormFieldDef } from '@worldsea/plugin-sdk'

export const characterFields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '角色名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'age', label: '年龄', type: 'text', placeholder: '如：25 / 不朽' },
  { key: 'gender', label: '性别', type: 'text', placeholder: '男/女/其他' },
  { key: 'race', label: '种族', type: 'text', autoLink: { targetType: 'species', relationType: 'belongs_to' } },
  { key: 'occupation', label: '职业', type: 'text', placeholder: '如：剑士/学者' },
  { key: 'affiliation', label: '所属势力', type: 'text', autoLink: { targetType: 'organization', relationType: 'belongs_to' } },
  { key: 'role', label: '角色', type: 'select', options: [
    { value: '主角', label: '主角' }, { value: '反派', label: '反派' },
    { value: '配角', label: '配角' }, { value: '导师', label: '导师' },
    { value: '信使', label: '信使' }, { value: '其他', label: '其他' },
  ] },
  { key: 'appearance', label: '外貌特征', type: 'textarea' },
  { key: 'personality', label: '性格', type: 'textarea' },
  { key: 'background', label: '背景故事', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags', placeholder: '逗号分隔' },
]