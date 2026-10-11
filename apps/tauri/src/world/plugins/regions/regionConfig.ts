import type { FormFieldDef } from '@worldsea/plugin-sdk'

export const regionFields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '区域名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'regionType', label: '类型', type: 'select', options: [
    { value: '大陆', label: '大陆' }, { value: '国家', label: '国家' },
    { value: '行省', label: '行省' }, { value: '城市', label: '城市' },
    { value: '地标', label: '地标' }, { value: '区域', label: '区域' },
  ] },
  { key: 'climate', label: '气候', type: 'select', options: [
    { value: '热带雨林', label: '热带雨林' }, { value: '热带草原', label: '热带草原' },
    { value: '热带沙漠', label: '热带沙漠' }, { value: '地中海', label: '地中海' },
    { value: '温带海洋', label: '温带海洋' }, { value: '温带大陆', label: '温带大陆' },
    { value: '温带季风', label: '温带季风' }, { value: '亚寒带', label: '亚寒带' },
    { value: '寒带苔原', label: '寒带苔原' }, { value: '寒带冰原', label: '寒带冰原' },
    { value: '高山高原', label: '高山高原' },
  ] },
  { key: 'population', label: '人口', type: 'number' },
  { key: 'area', label: '面积', type: 'text' },
  { key: 'government', label: '政体/统治', type: 'select', options: [
    { value: '君主制', label: '君主制' }, { value: '共和制', label: '共和制' },
    { value: '民主制', label: '民主制' }, { value: '寡头制', label: '寡头制' },
    { value: '神权制', label: '神权制' }, { value: '军事独裁', label: '军事独裁' },
    { value: '部落制', label: '部落制' }, { value: '联邦制', label: '联邦制' },
    { value: '其他', label: '其他' },
  ] },
  { key: 'significance', label: '重要性', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]

export const regionTypeOptions = [
  '寰宇', '宇宙', '星系', '星海', '星河', '星域',
  '星球', '大陆', '帝国', '城', '镇', '村', '家',
]

export const typeIconMap: Record<string, string> = {
  '寰宇': 'galaxy', '宇宙': 'planet', '星系': 'galaxy', '星海': 'sparkle',
  '星河': 'galaxy', '星域': 'galaxy', '星球': 'globe', '大陆': 'map',
  '帝国': 'sword', '城': 'castle', '镇': 'city', '村': 'village', '家': 'home',
  '国家': 'flag', '行省': 'landscape', '城市': 'city', '地标': 'monument', '区域': 'location',
}

export const fieldOrder = ['climate', 'population', 'area', 'government']

export const fieldLabelMap: Record<string, string> = {
  climate: '气候', population: '人口', area: '面积', government: '政体',
}