import type { WorldPluginApi } from '../../api'
import SpeciesView from './SpeciesView.vue'

export const manifest = {
  id: 'official.species',
  domain: 'life',
  name: '种族/物种',
  version: '2.0.0',
  description: '管理世界观中的种族、物种及其群体属性',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'species',
    label: '物种',
    icon: 'species',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'physical' },
      { traitId: 'ageable', fieldOverrides: {
        birthDate: { label: '起源时间' },
        deathDate: { label: '灭绝时间' },
      } },
    ],
    ownFields: [
      { key: 'speciesType', label: '类型', fieldType: 'select',
        options: ['类人', '兽族', '精灵', '矮人', '龙族', '机械', '元素', '亡灵', '神话生物', '异界生物', '植物智能', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'avgLifespan', label: '平均寿命', fieldType: 'text' },
      { key: 'language', label: '语言', fieldType: 'text' },
      { key: 'population', label: '人口/数量', fieldType: 'number' },
      { key: 'society', label: '社会结构', fieldType: 'textarea' },
      { key: 'abilities', label: '天赋能力', fieldType: 'textarea' },
      { key: 'weakness', label: '弱点/缺陷', fieldType: 'textarea' },
      { key: 'origin', label: '起源地', fieldType: 'text' },
    ],
  })

  api.registerView({ id: 'species', label: '种族/物种', icon: 'species', component: SpeciesView })
}

export default { manifest, apply }
