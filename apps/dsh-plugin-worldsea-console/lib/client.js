/**
 * dsh-plugin-worldsea-console — WorldSea 产品域管理面（客户端半侧）。
 *
 * 形态：**手写闭包工厂产物**（对齐 dsh client 约定：`window.__ModuleLoader__.load({id, factory})`，
 * external 经 loader 模块表 `require` 取——种子表含 `react` / `react/jsx-runtime` /
 * `@deepseek-ai/dsh-client-ui-primitives` 等，见 dsh/packages/client/web/src/platform.ts
 * `PLATFORM_MODULES`）。**零构建链**：本文件直接入库，dsh 追版零影响。
 * UI 组件对齐 dsh 原生（ui-primitives 的 Switch / SegmentedControl——与设置分区同质感）。
 *
 * 职责（D3-c）：注册 `settings.plugins.tab`「WorldSea 产品域」标签页，管理产品域 ↔ dsh 交界配置：
 * ① 说明书与指针（壳偏好 manualGeneration / agentsPointer——生成类开关保存即时补生成）
 * ② 快照策略（snapshotExport：auto | off——工作台 boot.ts 导出门）
 * ③ 插件数据面（worldsea 插件的 cordis config：dshHome / dataRoot）——**可编辑**（D3-c2，2026-09-30）：
 *    经 `configForms` 跨插件绑定 + 上游 SettingsForm/SettingsFormModel 出表单，写盘落 profile 补丁层；
 *    未覆盖时另显示壳注入的缺省生效值（D3-c2b，`__WORLDSEA_DSH_HOME__`）。
 * 壳命令经 `__TAURI_INTERNALS__.invoke`（ACL = worldsea-shell.toml，两窗共用）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-worldsea-console',
  factory: (require) => {
    const module = { exports: {} };
    const react = require('react');
    const { Switch, SegmentedControl, SettingsForm, SettingsValueField, SettingsFormModel, settingsTextField } = require('@deepseek-ai/dsh-client-ui-primitives');

    const PLUGIN_ID = 'dsh-plugin-worldsea-console';
    /** 本插件独占的字典命名空间（locale 字典 + 标签页 label）。 */
    const NS = 'settings.worldseaConsole';

    const zh = {
      tab: 'WorldSea 产品域',
      title: '产品域 ↔ dsh 交界配置',
      desc: '这些开关控制应用与 Agent 的行为；改动即时保存。',
      manualGeneration: 'WORLDSEA.md 说明书生成',
      manualGenerationHint: '启动应用（或保存本页设置）时，在工作区根生成一份 WORLDSEA.md 说明书（Agent 可据此了解本项目的约定）；已有同名文件不会被覆盖。',
      agentsPointer: '薄指针 AGENTS.md 生成',
      agentsPointerHint: '启动应用（或保存本页设置）时，在工作区根生成一份很短的指路文件 AGENTS.md——Agent 会自动看到它，并顺着它先去读 WORLDSEA.md；已有 AGENTS.md 不会被覆盖。',
      snapshotExport: 'Schema 快照导出',
      snapshotExportHint: '打开工作台或切换项目时，会把实体类型结构导出到创作数据（worlddata/.worldsea/），供 Agent 写入时校验；关闭后，Agent 的写操作会直接报错（提示先打开工作台）。',
      snapshotAuto: '自动',
      snapshotOff: '关闭',
      dataFace: '插件数据面（worldsea 工具插件）',
      dataFaceHint: 'Agent 侧 worldsea 工具插件的数据位置设置。保存后立即生效，无需重启；两项均可留空（留空即用缺省）。',
      dshHome: 'DSH_HOME 覆盖（dshHome）',
      dshHomeHint: '选填。留空＝应用自动决定的缺省目录（下方已显示）。填写后，Agent 会改从该目录读取会话和项目——若填错（不是应用正在使用的那一个），已有的会话和项目将不可见。',
      dshHomeDefault: '缺省生效值：',
      dshHomePlaceholder: '留空＝用缺省',
      dataRoot: '实体目录兜底（dataRoot）',
      dataRootHint: '选填。只影响「没有工作目录」的调用场景（正常对话都有工作目录，不受影响）：这类调用会从该目录读取创作数据。留空＝这类调用直接报错。',
      dataRootPlaceholder: '例如 D:\\WorldSeaData',
      overridden: '覆盖中',
      reset: '恢复缺省',
      invalidField: '插件不接受这个值',
      save: '保存',
      saving: '保存中…',
      readOnly: '当前部署的插件配置为只读。',
      saveFailed: '保存未被接受；改动已保留，请修正后重试。',
      unavailable: '该配置当前不可用（插件未挂载）。',
      saved: '已保存',
      loadFailed: '读取失败',
      notTauri: '此面板需要桌面壳环境（Tauri IPC 不可用）。',
      loading: '正在读取产品域设置…',
    };
    const en = {
      tab: 'WorldSea Product',
      title: 'Product ↔ dsh boundary settings',
      desc: 'These switches control how the app and the Agent behave; changes are saved immediately.',
      manualGeneration: 'WORLDSEA.md manual generation',
      manualGenerationHint: 'On app startup (or when this page is saved), generates the WORLDSEA.md manual at the workspace root so the Agent can learn the project\'s conventions; an existing file is never overwritten.',
      agentsPointer: 'Thin-pointer AGENTS.md generation',
      agentsPointerHint: 'On app startup (or when this page is saved), generates a short pointer file AGENTS.md at the workspace root — the Agent sees it automatically and reads WORLDSEA.md first; an existing AGENTS.md is never overwritten.',
      snapshotExport: 'Schema snapshot export',
      snapshotExportHint: 'When the workbench opens or the project switches, entity-type schemas are exported to the world data folder (worlddata/.worldsea/) so Agent writes can be validated; when off, Agent writes fail with an error (prompting to open the workbench first).',
      snapshotAuto: 'Auto',
      snapshotOff: 'Off',
      dataFace: 'Plugin data face (worldsea tool plugin)',
      dataFaceHint: 'Where the Agent-side worldsea tool plugin keeps its data. Changes apply immediately (no restart); both fields may stay empty to keep the defaults.',
      dshHome: 'DSH_HOME override (dshHome)',
      dshHomeHint: 'Optional. Empty = the default directory chosen by the app (shown below). If set, the Agent reads sessions and projects from that directory instead — a wrong directory (not the one the app uses) hides your existing sessions and projects.',
      dshHomePlaceholder: 'Empty = use the default',
      dshHomeDefault: 'Effective default: ',
      dataRoot: 'Entity directory fallback (dataRoot)',
      dataRootHint: 'Optional. Only affects calls without a working directory (normal conversations always have one and are unaffected): such calls read world data from this directory. Empty = those calls fail with an error.',
      dataRootPlaceholder: 'e.g. D:\\WorldSeaData',
      overridden: 'Overridden',
      reset: 'Reset to default',
      invalidField: 'The plugin does not accept this value',
      save: 'Save',
      saving: 'Saving…',
      readOnly: 'This deployment stores plugin configuration read-only.',
      saveFailed: 'The save was not accepted; your changes are kept — fix them and retry.',
      unavailable: 'This configuration is unavailable (plugin not mounted).',
      saved: 'Saved',
      loadFailed: 'Failed to load',
      notTauri: 'This panel requires the desktop shell (Tauri IPC unavailable).',
      loading: 'Loading product preferences…',
    };

    /** 客户端 ctx 需要的服务（slots = 模块系统核心；locale 来自 dsh-client-locale；
     *  configForms = 跨插件配置表单句柄——第三组「插件数据面」据此绑定 worldsea 插件的 config）。 */
    const inject = ['slots', 'locale', 'configForms'];

    /** 壳命令调用（与壳注入的 shell_bridge 同链路：__TAURI_INTERNALS__.invoke，受 ACL 白名单管）。 */
    function shellInvoke(command, args) {
      const ipc = globalThis.__TAURI_INTERNALS__;
      if (ipc === undefined || typeof ipc.invoke !== 'function') {
        return Promise.reject(new Error('Tauri IPC unavailable'));
      }
      return ipc.invoke(command, args);
    }

    /** 壳注入的缺省 DSH_HOME（D3-c2b）：未覆盖时把「生效缺省值」显示出来；非壳环境（无该全局）退化为不显示。 */
    function shellDefaultDshHome() {
      const value = globalThis.__WORLDSEA_DSH_HOME__;
      return typeof value === 'string' && value.length > 0 ? value : null;
    }

    const styles = {
      wrap: { maxWidth: 620, padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13, lineHeight: 1.5 },
      title: { fontSize: 14, fontWeight: 600, margin: 0 },
      hint: { color: 'var(--text-tertiary, #888)', fontSize: 12, margin: '2px 0 0' },
      defaultLine: { color: 'var(--text-tertiary, #888)', fontSize: 12, margin: '2px 0 0', wordBreak: 'break-all' },
      section: { display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border, rgba(127,127,127,.2))' },
      row: { display: 'flex', gap: 12, alignItems: 'center' },
      grow: { flex: 1, minWidth: 0 },
      label: { fontWeight: 500 },
      status: { color: 'var(--color-primary, #4a9eff)', fontSize: 12 },
      error: { color: '#e5484d', fontSize: 12 },
    };

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'worldsea-console: dictionaries');
      const t = ctx.locale.bind(NS);
      const h = react.createElement;

      /* 第三组「插件数据面」= 宿主 worldsea 插件的 cordis config（D3-c2，2026-09-30）。
         命名空间 = 该插件在 cordis.patch.yml 里的**条目 id**（worldsea）；字段名 = 其 Config 的键。
         两侧任一漂移即静默断链，故 __tests__/client.spec.ts 有跨文件契约用例（与 patch 行、真 Config 对读）。
         表单能力全取自上游：SettingsFormModel 管暂存/覆盖中判定/修订栅栏，SettingsForm + SettingsValueField 出 UI。 */
      const scope = ctx.configForms.get('worldsea');
      const form = new SettingsFormModel(scope, [settingsTextField('dshHome'), settingsTextField('dataRoot')]);
      const store = form.bind(() => ({ ...form.shell(), dshHome: form.field('dshHome'), dataRoot: form.field('dataRoot') }));
      ctx.effect(() => () => form.dispose(), 'worldsea-console: data-face form');
      /** SettingsForm/字段共用文案（上游 SettingsFormLabels + 各字段的覆盖中/恢复/非法标签）。 */
      const formLabels = () => ({ unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') });

      /** 一行设置：左侧标题 + 说明，右侧控件（Switch）。 */
      function SwitchRow(props) {
        return h('div', { style: styles.row },
          h('div', { style: styles.grow },
            h('div', { style: styles.label }, props.label),
            h('div', { style: styles.hint }, props.hint)),
          h(Switch, { checked: props.checked, onChange: props.onChange }));
      }

      function ConsoleTab(props) {
        const [prefs, setPrefs] = react.useState(null);
        const [error, setError] = react.useState('');
        const [status, setStatus] = react.useState('');
        /* 第三组的状态走框架座位（renderer 把 inject.hooks.dataFace 绑成 useDataFace）：
           组件内不自订阅（dsh 客户端规约：render 读到的一切可变量都必须经框架 hook）。 */
        const face = props.useDataFace((snapshot) => snapshot);
        /* D3-c2b：壳注入的缺省 DSH_HOME——未覆盖时作为「缺省生效值」显示（非壳环境为 null）。 */
        const defaultHome = shellDefaultDshHome();

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
          h('div', { style: styles.section },
            h(SwitchRow, { checked: prefs.manualGeneration, onChange: (v) => patch({ manualGeneration: v }), label: t('manualGeneration'), hint: t('manualGenerationHint') }),
            h(SwitchRow, { checked: prefs.agentsPointer, onChange: (v) => patch({ agentsPointer: v }), label: t('agentsPointer'), hint: t('agentsPointerHint') })),
          h('div', { style: { ...styles.section, alignItems: 'flex-start' } },
            h('div', { style: styles.grow },
              h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
                h('div', { style: styles.label }, t('snapshotExport')),
                h(SegmentedControl, {
                  id: 'worldsea-console-snapshot',
                  value: prefs.snapshotExport,
                  options: [
                    { value: 'auto', label: t('snapshotAuto') },
                    { value: 'off', label: t('snapshotOff') },
                  ],
                  onChange: (v) => patch({ snapshotExport: v }),
                })),
              h('div', { style: styles.hint }, t('snapshotExportHint')),
              status ? h('div', { style: { ...styles.status, marginTop: 4 } }, status) : null)),
          h('div', { style: styles.section },
            h('div', { style: styles.label }, t('dataFace')),
            h('div', { style: styles.hint }, t('dataFaceHint')),
            h(SettingsForm, { labels: formLabels(), state: face, onSave: props.save, onDiscard: props.discard },
              h(SettingsValueField, {
                id: 'worldsea-console-dsh-home',
                label: t('dshHome'),
                hint: t('dshHomeHint'),
                placeholder: t('dshHomePlaceholder'),
                overriddenLabel: t('overridden'),
                resetLabel: t('reset'),
                invalidLabel: t('invalidField'),
                disabled: !face.writable,
                ...face.dshHome,
                onEdit: (text) => { props.edit('dshHome', text); },
                onReset: () => { props.resetField('dshHome'); },
              }),
              defaultHome !== null && face.dshHome && !face.dshHome.overridden
                ? h('p', { style: styles.defaultLine }, `${t('dshHomeDefault')}${defaultHome}`)
                : null,
              h(SettingsValueField, {
                id: 'worldsea-console-data-root',
                label: t('dataRoot'),
                hint: t('dataRootHint'),
                placeholder: t('dataRootPlaceholder'),
                overriddenLabel: t('overridden'),
                resetLabel: t('reset'),
                invalidLabel: t('invalidField'),
                disabled: !face.writable,
                ...face.dataRoot,
                onEdit: (text) => { props.edit('dataRoot', text); },
                onReset: () => { props.resetField('dataRoot'); },
              }))));
      }

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'worldsea-console',
        order: 20,
        label: () => t('tab'),
        locale: NS,
        inject: () => ({ hooks: { dataFace: store }, ...form.actions() }),
      }, ConsoleTab));
    }

    module.exports = { name: PLUGIN_ID, inject, NS, apply };
    return module.exports;
  },
});
