/**
 * 第二棵树（世界语义）的插件清单规范 + 校验（B，2026-09-25）。
 *
 * 口径：清单**自定、不与 dsh 版本绑定**（dsh 的 `dsh.bundle.patch` / `dsh.client.inject` 等字段
 * 只作参照）。清单是**构建期静态**的：装载器用 `import.meta.glob` 扫 `plugins/<id>/index.ts`
 * 的 `default` 导出，本模块负责形状校验（非法即拒、留痕，不静默跳过）。
 */
export interface WorldPluginManifest {
  /** 插件 id：小写点分、≥2 段（与官方芽 `official.*`、能力 `world.*` 分域，树内新插件用 `ws.*`）。
   *  段内允许 `-` 与 `_`（既有芽 id 有 `combat_stats` 这种下划线写法）。 */
  id: string
  /** 用户可见名（中性描述，不带引导词） */
  name: string
  /** 版本（`major.minor.patch` 起头） */
  version: string
  /** 一句话说明 */
  description: string
  /** 依赖的**服务名**（本树提供；缺失即拒——由装载器预检，cordis 的 `inject` 同源） */
  requires?: string[]
  /** 预留：默认装载开关（当前装载器不消费） */
  defaultEnabled?: boolean
  /** 插件身份（批4，管理面分流依据）：sprout = 芽类（贡献侧栏视图，默认）；
   *  utility = 非芽类（纯 overlay/能力贡献，无侧栏入口）——「芽是插件，但插件不等于芽」。
   *  ★ 声明式而非运行时判定：卸载态下视图/overlay 证据全撤，运行时猜不可靠。 */
  kind?: 'sprout' | 'utility'
  /** 主语义域（R1，2026-10-20）：内置芽必填（测试守卫），外部插件可缺省。
   *  取值应登记在 `SPROUT_DOMAINS`；外部插件允许使用未登记域名，避免锁死扩展面。 */
  domain?: string
  /** 副语义域（R1）：与主域并列的关联域，不得与主域重复；内置芽取值由测试守卫。 */
  secondaryDomains?: string[]
  /** 实体类型（R5）：该芽注册的实体 type；纯视图芽显式声明 []。
   *  用于依赖图，独立于运行时注册表（停用芽也能参与）。 */
  entityTypes?: string[]
}

/** 一个树插件：清单 + 装载函数（`ctx` 是 cordis 上下文，`api` 是**作用域化插件 API**）。 */
export interface WorldPlugin {
  manifest: WorldPluginManifest
  apply(
    ctx: import('@deepseek-ai/cordis').CordisContext,
    api: import('./api').WorldPluginApi,
  ): void
}

export type ManifestCheck = { ok: true; manifest: WorldPluginManifest } | { ok: false; reason: string }

const ID_RE = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/
const VERSION_RE = /^\d+\.\d+\.\d+/

/** 校验插件清单（拒绝即给出可读原因；不做「容忍式」修补）。 */
export function validateManifest(value: unknown): ManifestCheck {
  if (!value || typeof value !== 'object') return { ok: false, reason: '清单不是对象' }
  const manifest = value as Partial<WorldPluginManifest>
  if (typeof manifest.id !== 'string' || !ID_RE.test(manifest.id)) {
    return { ok: false, reason: `id 形状非法（须为小写点分、≥2 段：${String(manifest.id)}）` }
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    return { ok: false, reason: 'name 缺失或为空' }
  }
  if (typeof manifest.version !== 'string' || !VERSION_RE.test(manifest.version)) {
    return { ok: false, reason: `version 非法（须为 x.y.z 起头：${String(manifest.version)}）` }
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    return { ok: false, reason: 'description 缺失或为空' }
  }
  if (manifest.requires !== undefined) {
    if (!Array.isArray(manifest.requires) || manifest.requires.some(item => typeof item !== 'string' || !item.trim())) {
      return { ok: false, reason: 'requires 须为字符串数组' }
    }
  }
  if (manifest.domain !== undefined) {
    if (typeof manifest.domain !== 'string' || !manifest.domain.trim()) {
      return { ok: false, reason: 'domain 须为非空字符串' }
    }
  }
  if (manifest.secondaryDomains !== undefined) {
    if (!Array.isArray(manifest.secondaryDomains) || manifest.secondaryDomains.some(item => typeof item !== 'string' || !item.trim())) {
      return { ok: false, reason: 'secondaryDomains 须为字符串数组' }
    }
  }
  if (manifest.entityTypes !== undefined) {
    if (
      !Array.isArray(manifest.entityTypes) ||
      manifest.entityTypes.some(item => typeof item !== 'string' || !item.trim())
    ) {
      return { ok: false, reason: 'entityTypes 须为字符串数组（元素非空）' }
    }
    if (new Set(manifest.entityTypes).size !== manifest.entityTypes.length) {
      return { ok: false, reason: 'entityTypes 不得重复' }
    }
  }
  return { ok: true, manifest: manifest as WorldPluginManifest }
}
