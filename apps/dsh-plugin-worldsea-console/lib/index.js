/**
 * dsh-plugin-worldsea-console — WorldSea 产品域管理面（D3，2026-09-28；内置级 cordis 插件）。
 *
 * 宿主半侧：**空 apply 占 Loader 行**（对齐 dsh ui-settings-shell / ui-settings-plugin-inventory 先例）
 * ——真正的行为在客户端半侧 `lib/client.js`（经 client-modules 送浏览器，注册
 * settings.plugins.tab「WorldSea 产品域」标签页）。
 */

/** 稳定 cordis 插件名（内置插件页显示的包标识）。 */
const name = 'worldsea-console';

/** 宿主半无任何行为，不注入服务。 */
const inject = [];

/**
 * 空宿主体：占 Loader 行让 client-modules 扫描到 `dsh.client` 声明并送出浏览器半侧。
 */
export function apply() {}

/** 稳定导出（cordis 插件身份）。 */
export { name, inject };
