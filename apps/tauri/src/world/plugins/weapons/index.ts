import type { WorldPluginApi } from '../../api'
import { WeaponFacet } from '@worldsea/entity-core/facets'
import WeaponView from './WeaponView.vue'

export const manifest = {
  id: 'official.weapons',
  domain: 'goods',
  entityTypes: [],
  secondaryDomains: ['knowledge'],
  name: '武器',
  version: '2.1.0',
  description: '武器视图——展示和管理 Item 中拥有 WeaponFacet 的实体',
  author: 'WorldSea',
  kind: 'sprout' as const,
  requires: ['world.entities', 'world.relations'],
}

/**
 * 武器芽不注册独立的 weapon 实体类型——武器是 Item + WeaponFacet 的组合。
 * 本芽贡献两件：WeaponFacet 的定义归属（谁贡献的 Facet 在清单上可见），
 * 以及武器专属的浏览/筛选视图。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerFacet(WeaponFacet)
  api.registerView({ id: 'weapons', label: '武器', icon: 'weapon', component: WeaponView })
}

export default { manifest, apply }
