import type { WorldPluginApi } from '../../api'
import RegionList from './RegionList.vue'

export const manifest = {
  id: 'official.regions',
  name: '区域图谱',
  version: '2.0.0',
  description: '管理世界观中的大陆、国家、城市、地标等地理区域',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'region',
    label: '区域',
    icon: 'region',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'locatable' },
    ],
    ownFields: [
      { key: 'regionType', label: '类型', fieldType: 'select', options: ['大陆', '国家', '行省', '城市', '地标', '区域'].map(s => ({ value: s, label: s })) },
      { key: 'climate', label: '气候', fieldType: 'select', options: ['热带雨林', '热带草原', '沙漠', '地中海', '温带海洋', '温带季风', '温带大陆', '亚寒带', '苔原', '冰原', '高原山地', '火山'].map(s => ({ value: s, label: s })) },
      { key: 'population', label: '人口', fieldType: 'text' },
      { key: 'area', label: '面积', fieldType: 'text' },
      { key: 'government', label: '政体/统治', fieldType: 'select', options: ['君主专制', '君主立宪', '共和制', '联邦制', '部落制', '神权制', '军事统治', '无政府', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'significance', label: '历史意义', fieldType: 'textarea' },
    ],
  })

  api.registerView({ id: 'regions', label: '区域图谱', icon: 'region', component: RegionList })
}

export default { manifest, apply }
