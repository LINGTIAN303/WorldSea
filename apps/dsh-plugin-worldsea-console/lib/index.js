/**
 * dsh-plugin-worldsea-console — WorldSea 产品域管理面（D3，2026-09-28；内置级 cordis 插件）。
 *
 * 宿主半侧（2026-10-07 升级为带 Config 的真宿主插件）：
 * ① **数据面配置宿主**——worldsea 工具插件预设化（挪进「产品域模式」预设）后不再是顶层装载行，
 *    其 config 命名空间随之退出设置面（设置面 configEditor.entries() 只枚举顶层行，见
 *    `dsh/packages/boot/config-editor/src/index.ts` 的 include 过滤）。故 dshHome/dataRoot 的
 *    真源移到本插件（顶层常驻、命名空间 `worldsea-console` 可被设置面枚举与编辑），
 *    编辑入口 = 设置 → 内置插件 → 「WorldSea 插件」Tab 的 worldsea 卡片（configForms 绑定本命名空间）。
 * ② **服务桥**——apply 里 `ctx.reflect.provide('worldseaDataFace', …)` 暴露数据面现值：
 *    worldsea 预设子实例经作用域继承软访问（`ctx.worldseaDataFace?.`，见其 lib/index.js），
 *    每次工具调用现取——设置面保存即生效，无需重挂载。服务缺失（worldsea 单独部署）时由其
 *    自身 config / env 回落链兜底。
 * ③ **`/entity` 全局快捷指令**（2026-10-07 走查后改纯插件形态）——指令行= 客户端贡献位
 *    （`commandUi.register`，见 lib/client.js：样式全套原生支持）；就绪卡数据经壳 IPC
 *    `cmd_product_briefing`（Rust 壳侧，非本插件）读取。本宿主半不再注册指令。
 * 客户端半侧（`lib/client.js`）：注册 settings.plugins.tab「WorldSea 插件」标签页 +
 * settings.section「WorldSea 产品域」交界配置分区 + 「实体」指令贡献位与就绪卡弹层。
 */

/** 稳定 cordis 插件名（内置插件页显示的包标识；亦是设置面 config 命名空间）。 */
const name = 'worldsea-console';

/** 前置服务：无（config 经 apply 第二参传入；reflect 为内建服务）。 */
const inject = [];

import z from '@deepseek-ai/schemastery';

/**
 * 插件配置 schema（cordis `Config` 约定）——数据面真源。
 *
 * 写入门槛要求条目既有 schema、又含 volatile 字段（`dsh/packages/settings/settings/src/index.ts`
 * 分别抛 `No configurable plugin entry` 与 `has no volatile fields`）。两字段都 `volatile()`：
 * 服务桥的取值函数每次现读（见 apply），设置面保存即生效，无需重挂载。缺省 `''` = 未设。
 */
export const Config = z.object({
  /** DSH_HOME 覆盖（worldsea 取值链：服务 > 其自身 config > env）。 */
  dshHome: z.string().default('').volatile(),
  /** 无会话 cwd 时的实体目录兜底（缺省无——非会话调用由 worldsea 直接拒，fail loud）。 */
  dataRoot: z.string().default('').volatile(),
});

/**
 * 取一次配置字段的当前值。
 *
 * volatile 字段物化后**不是原值**，而是 cosmokit 的 `Volatile<T>` 稳定引用（`{ get(): 快照 }`，
 * 见 `vendor/cosmokit/src/volatile.ts`）——直接当路径用会得到 `[object Object]`（worldsea 插件
 * D3-c2 实测踩到的坑，判据与 cosmokit `isVolatile` 等价）。普通字段仍是原值，统一走本函数。
 */
function configText(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value;
}

/** 空串归一为 null（服务桥的「未设置」语义，让 worldsea 侧 `??` 回落链生效）。 */
function orNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

/**
 * 插件装载：暴露数据面服务桥。
 * @param ctx - cordis 上下文（顶层作用域；worldsea 预设子实例经作用域继承可见）。
 * @param config - 插件配置（dshHome / dataRoot，schema 见上方 `Config`）。
 */
export function apply(ctx, config = {}) {
  // 服务桥对象的方法每次现读 config（volatile 现取）——本插件 config 变更走 cordis 热重载
  // （fiber 重启重跑 apply）或原地更新，worldsea 侧经 ctx 属性访问动态解析到最新值。
  ctx.reflect.provide('worldseaDataFace', {
    /** DSH_HOME 覆盖现值（未设置 = null）。 */
    dshHome: () => orNull(configText(config?.dshHome)),
    /** 实体目录兜底现值（未设置 = null）。 */
    dataRoot: () => orNull(configText(config?.dataRoot)),
  });
  console.log('[worldsea-console] 数据面服务桥已就绪（worldseaDataFace）');
}

/** 稳定导出（cordis 插件身份 + 配置 schema + 服务）。 */
export { name, inject };
