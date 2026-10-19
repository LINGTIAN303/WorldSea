/**
 * 「思维导图」插件清单（**轻数据**：不含任何视图/重依赖 import，
 * 便于装载器与测试在**不拉起重图**的前提下校验形状与依赖预检）。
 */
import type { WorldPluginManifest } from '../../manifest'

export const MINDMAP_MANIFEST: WorldPluginManifest = {
  id: 'official.mindmap',
  domain: 'tool',
  name: '思维导图',
  version: '2.0.0',
  description:
    '真正的树状思维导图——发散构思、整理世界观想法；节点可绑定实体，构思成熟后一键跳转落地',
}
