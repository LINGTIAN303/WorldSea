import type { WorldPluginApi } from '../../api'
import WeaponView from './WeaponView.vue'

export const manifest = {
  id: 'official.weapons',
  name: '武器',
  version: '2.0.0',
  description: '武器视图——展示和管理 Item 中拥有 WeaponFacet 的实体',
  author: 'WorldSea',
}

/**
 * 武器芽不再注册独立的 weapon 实体类型。
 * 武器是 Item + WeaponFacet 的组合。
 * 此芽仅保留视图，提供武器专属的浏览/筛选界面。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerView({ id: 'weapons', label: '武器', icon: 'weapon', component: WeaponView })
}

export default { manifest, apply }
