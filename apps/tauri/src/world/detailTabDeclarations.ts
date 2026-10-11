/**
 * 详情 Tab 的芽级声明单点（2026-10-08 Tab 优化批 C）。
 *
 * 为什么集中到这里：设置面「Tab 管理」卡要列出「该类型有哪些 tab」才能排序/隐藏，
 * 而原先 customTabs 常量散在芽组件里、设置面板读不到；静态图标名守卫也没法一处扫全。
 * 芽组件照旧把声明经 prop 传给 GEV（通道不变），只是源头改为本文件——类型/顺序
 * 消费方（GEV 组装、TAB 管理卡、图标守卫）共用同一份。
 */
import type { DetailTab } from '@worldsea/plugin-sdk'

export interface DetailTabDeclaration {
  /** 芽自定义页（内容经 `#tab-<id>` 槽提供） */
  custom?: DetailTab[]
  /** 插在自定义页与「关联」之间的附加页（如时间线的因果链） */
  extras?: DetailTab[]
}

export const DETAIL_TAB_DECLARATIONS: Record<string, DetailTabDeclaration> = {
  character: {
    custom: [
      { id: 'family', label: '家谱', icon: 'tree' },
      // 2026-10-08：原 id 'relations' 与内置「关联」tab 撞名——Vue 同名具名槽后者覆盖，
      // 此页实际渲染的是关联面板（存量缺陷，随本批修）；改名后槽名同步为 #tab-relation-graph
      { id: 'relation-graph', label: '关系图', icon: 'web' },
      { id: 'experience', label: '经历', icon: 'hourglass' },
      { id: 'names', label: '称呼', icon: 'badge' },
      { id: 'appearance', label: '外貌', icon: 'eye' },
      { id: 'equipment', label: '装备栏', icon: 'clothing' },
    ],
  },
  organization: {
    custom: [
      { id: 'members', label: '成员', icon: 'user' },
      { id: 'subfactions', label: '下属势力', icon: 'building' },
      { id: 'territories', label: '控制区域', icon: 'location' },
      { id: 'diplomacy', label: '外交', icon: 'link' },
    ],
  },
  region: {
    custom: [
      { id: 'subregions', label: '子区域', icon: 'location' },
      { id: 'enclaves', label: '飞地', icon: 'location' },
      { id: 'residents', label: '驻留角色', icon: 'user' },
      { id: 'faction', label: '所属势力', icon: 'building' },
    ],
  },
  event: {
    extras: [{ id: 'causal', label: '因果链', icon: 'link' }],
  },
}
