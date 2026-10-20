import type { WorldPluginApi } from '../../api'
import ApparelView from './ApparelView.vue'

export const manifest = {
  id: 'official.apparel',
  domain: 'goods',
  entityTypes: [],
  name: '服饰/装备',
  version: '2.0.0',
  description: '服饰视图——展示和管理 Item 中拥有 ApparelFacet 的实体',
  author: 'WorldSea',
}

/**
 * 服饰芽不再注册独立的 apparel 实体类型。
 * 服饰是 Item + ApparelFacet 的组合。
 * 此芽仅保留视图，提供服饰专属的浏览/筛选界面。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerView({ id: 'apparel', label: '服饰/装备', icon: 'apparel', component: ApparelView })
}

export default { manifest, apply }
