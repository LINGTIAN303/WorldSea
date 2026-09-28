/**
 * dsh-plugin-worldsea-console — WorldSea 产品域管理面（客户端半侧）。
 *
 * 形态：**手写闭包工厂产物**（对齐 dsh client 约定：`window.__ModuleLoader__.load({id, factory})`，
 * external 经 loader 模块表 `require` 取——种子表含 `react` / `react/jsx-runtime` 等，见
 * dsh/packages/client/web/src/platform.ts `PLATFORM_MODULES`）。**零构建链**：本文件直接入库，
 * dsh 追版零影响；UI 用 createElement（设置卡片复杂度不需要 JSX 工具链）。
 *
 * 职责（D3-c）：注册 `settings.plugins.tab`「WorldSea 产品域」标签页，管理产品域 ↔ dsh 交界配置：
 * ① 说明书与指针（壳偏好 manualGeneration / agentsPointer——生成类开关保存即时补生成）
 * ② 快照策略（snapshotExport：auto | off——工作台 boot.ts 导出门）
 * ③ 插件数据面（worldsea 插件的 cordis config：v1 只读指引，configForms 跨插件绑定验证后升级编辑）。
 * 壳命令经 `__TAURI_INTERNALS__.invoke`（ACL = worldsea-shell.toml，两窗共用）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-worldsea-console',
  factory: (require) => {
    const module = { exports: {} };
    const react = require('react');

    const PLUGIN_ID = 'dsh-plugin-worldsea-console';
    /** 本插件独占的字典命名空间（locale 字典 + 标签页 label）。 */
    const NS = 'settings.worldseaConsole';

    const zh = {
      tab: 'WorldSea 产品域',
      title: '产品域 ↔ dsh 交界配置',
      desc: '这些开关控制 WorldSea 壳与 Agent 工具面在 dsh 会话中的行为；改动即时保存到壳侧偏好真源。',
      manualGeneration: 'WORLDSEA.md 说明书生成',
      manualGenerationHint: '壳启动（或保存时）在工作区根幂等生成产品域说明书；已存在的文件绝不覆盖。',
      agentsPointer: '薄指针 AGENTS.md 生成',
      agentsPointerHint: '壳启动（或保存时）在工作区根幂等生成薄指针——dsh 会把它自动注入会话，指向 WORLDSEA.md；已有 AGENTS.md 绝不覆盖。',
      snapshotExport: 'Schema 快照导出',
      snapshotExportHint: '工作台启动/切项目时把实体类型 schema 导出到 worlddata/.worldsea/ 供 Agent 工具校验；关闭后插件写操作将 fail loud（提示先打开工作台）。',
      snapshotAuto: '自动（启动/切项目时导出）',
      snapshotOff: '关闭',
      dataFace: '插件数据面（worldsea 工具插件）',
      dataFaceHint: 'dshHome 覆盖与 dataRoot 兜底属 worldsea 插件的 cordis config（profile patch 行内）；本页暂为只读指引，编辑随 configForms 跨插件绑定验证后开放。',
      saved: '已保存',
      loadFailed: '读取失败',
      notTauri: '此面板需要桌面壳环境（Tauri IPC 不可用）。',
      loading: '正在读取产品域设置…',
    };
    const en = {
      tab: 'WorldSea Product',
      title: 'Product ↔ dsh boundary settings',
      desc: 'These switches control how the WorldSea shell and Agent tool face behave in dsh sessions; changes are saved to the shell preference store immediately.',
      manualGeneration: 'WORLDSEA.md manual generation',
      manualGenerationHint: 'The shell idempotently generates the product-domain manual at workspace root on startup (or on save); existing files are never overwritten.',
      agentsPointer: 'Thin-pointer AGENTS.md generation',
      agentsPointerHint: 'The shell idempotently generates a thin pointer at workspace root — dsh injects it into sessions automatically, pointing at WORLDSEA.md; an existing AGENTS.md is never overwritten.',
      snapshotExport: 'Schema snapshot export',
      snapshotExportHint: 'The workbench exports entity schemas to worlddata/.worldsea/ on startup/project switch for Agent tool validation; when off, plugin writes fail loud (prompting to open the workbench first).',
      snapshotAuto: 'Automatic (startup / project switch)',
      snapshotOff: 'Off',
      dataFace: 'Plugin data face (worldsea tool plugin)',
      dataFaceHint: 'dshHome override and dataRoot fallback live in the worldsea plugin cordis config (profile patch row); read-only here for now — editing opens up after the configForms cross-plugin binding is verified.',
      saved: 'Saved',
      loadFailed: 'Failed to load',
      notTauri: 'This panel requires the desktop shell (Tauri IPC unavailable).',
      loading: 'Loading product preferences…',
    };

    /** 客户端 ctx 需要的服务（slots = 模块系统核心；locale 来自 dsh-client-locale）。 */
    const inject = ['slots', 'locale'];

    /** 壳命令调用（与壳注入的 shell_bridge 同链路：__TAURI_INTERNALS__.invoke，受 ACL 白名单管）。 */
    function shellInvoke(command, args) {
      const ipc = globalThis.__TAURI_INTERNALS__;
      if (ipc === undefined || typeof ipc.invoke !== 'function') {
        return Promise.reject(new Error('Tauri IPC unavailable'));
      }
      return ipc.invoke(command, args);
    }

    const styles = {
      wrap: { maxWidth: 560, padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, lineHeight: 1.5 },
      title: { fontSize: 14, fontWeight: 600, margin: 0 },
      hint: { color: 'var(--text-tertiary, #888)', fontSize: 12, margin: '2px 0 0' },
      row: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border, rgba(127,127,127,.2))' },
      box: { marginTop: 3, flexShrink: 0 },
      grow: { flex: 1 },
      select: { marginTop: 6 },
      status: { color: 'var(--color-primary, #4a9eff)', fontSize: 12, alignSelf: 'center' },
      error: { color: '#e5484d', fontSize: 12 },
    };

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'worldsea-console: dictionaries');
      const t = ctx.locale.bind(NS);
      const h = react.createElement;

      /** 单个开关行（checkbox + 标题 + 说明）。 */
      function ToggleRow(props) {
        return h('label', { style: styles.row },
          h('input', { type: 'checkbox', checked: props.checked, onChange: (e) => props.onChange(e.target.checked), style: styles.box }),
          h('span', { style: styles.grow },
            h('div', { style: { fontWeight: 500 } }, props.label),
            h('div', { style: styles.hint }, props.hint)));
      }

      function ConsoleTab() {
        const [prefs, setPrefs] = react.useState(null);
        const [error, setError] = react.useState('');
        const [status, setStatus] = react.useState('');

        react.useEffect(() => {
          shellInvoke('cmd_product_prefs_get', {}).then((value) => {
            setPrefs(value);
            setError('');
          }).catch((e) => setError(String(e)));
        }, []);

        async function patch(next) {
          const merged = { ...prefs, ...next };
          setPrefs(merged); // 乐观更新；失败回落服务端值
          try {
            const saved = await shellInvoke('cmd_product_prefs_set', { prefs: merged });
            setPrefs(saved);
            setStatus(t('saved'));
            window.setTimeout(() => setStatus(''), 1500);
          } catch (e) {
            setError(String(e));
          }
        }

        if (!globalThis.__TAURI_INTERNALS__) {
          return h('div', { style: styles.wrap }, h('p', { style: styles.hint }, t('notTauri')));
        }
        if (error) {
          return h('div', { style: styles.wrap }, h('p', { style: styles.error }, `${t('loadFailed')}：${error}`));
        }
        if (!prefs) {
          return h('div', { style: styles.wrap }, h('p', { style: styles.hint }, t('loading')));
        }
        return h('div', { style: styles.wrap },
          h('h3', { style: styles.title }, t('title')),
          h('p', { style: styles.hint }, t('desc')),
          h(ToggleRow, { checked: prefs.manualGeneration, onChange: (v) => patch({ manualGeneration: v }), label: t('manualGeneration'), hint: t('manualGenerationHint') }),
          h(ToggleRow, { checked: prefs.agentsPointer, onChange: (v) => patch({ agentsPointer: v }), label: t('agentsPointer'), hint: t('agentsPointerHint') }),
          h('div', { style: { ...styles.row, display: 'block' } },
            h('div', { style: { fontWeight: 500 } }, t('snapshotExport')),
            h('div', { style: styles.hint }, t('snapshotExportHint')),
            h('select', { value: prefs.snapshotExport, onChange: (e) => patch({ snapshotExport: e.target.value }), style: styles.select },
              h('option', { value: 'auto' }, t('snapshotAuto')),
              h('option', { value: 'off' }, t('snapshotOff'))),
            status ? h('span', { style: { ...styles.status, marginLeft: 10 } }, status) : null),
          h('h4', { style: { ...styles.title, marginTop: 6 } }, t('dataFace')),
          h('p', { style: styles.hint }, t('dataFaceHint')));
      }

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'worldsea-console',
        order: 20,
        label: () => t('tab'),
        locale: NS,
        inject: () => ({}),
      }, ConsoleTab));
    }

    module.exports = { name: PLUGIN_ID, inject, NS, apply };
    return module.exports;
  },
});
