import type { WorldPluginApi } from '../../api'
import { ApparelFacet } from '@worldsea/entity-core/facets'
import ApparelView from './ApparelView.vue'

export const manifest = {
  id: 'official.apparel',
  domain: 'goods',
  entityTypes: [],
  name: '服饰/装备',
  version: '2.1.0',
  description: '服饰视图——展示和管理 Item 中拥有 ApparelFacet 的实体',
  author: 'WorldSea',
  kind: 'sprout' as const,
}

/**
 * 服饰芽不注册独立的 apparel 实体类型——服饰是 Item + ApparelFacet 的组合。
 * 本芽贡献两件：ApparelFacet 的定义归属，以及服饰专属的浏览/筛选视图。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerFacet(ApparelFacet)
  api.registerView({ id: 'apparel', label: '服饰/装备', icon: 'apparel', component: ApparelView })
}

export default { manifest, apply }
