/**
 * dsh-plugin-worldsea-console — WorldSea 产品域管理面（客户端半侧）。
 *
 * 形态：**手写闭包工厂产物**（对齐 dsh client 约定：`window.__ModuleLoader__.load({id, factory})`，
 * external 经 loader 模块表 `require` 取——种子表含 `react` / `react/jsx-runtime` /
 * `@deepseek-ai/dsh-client-ui-primitives` 等，见 dsh/packages/client/web/src/platform.ts
 * `PLATFORM_MODULES`）。**零构建链**：本文件直接入库，dsh 追版零影响。
 * UI 组件对齐 dsh 原生（ui-primitives 的 Switch / SegmentedControl / Tag / 图标——与设置分区同质感）。
 *
 * 职责（2026-10-07 调整，原 D3-c 单 Tab 形态拆为两处）：
 * ① `settings.plugins.tab`「WorldSea 插件」标签页：WorldSea 插件集中清单（卡片风格对齐
 *    「插件列表」页）——worldsea 工具插件卡片**可展开**，详情含条目/模块信息与**插件数据面**
 *    配置表单（dshHome / dataRoot；worldsea 预设化后数据面真源在本插件，configForms 绑定
 *    本插件命名空间 `worldsea-console` + 上游 SettingsForm/SettingsFormModel，写盘落 profile
 *    补丁层；未覆盖时显示壳注入的缺省生效值 `__WORLDSEA_DSH_HOME__`）；
 * ② `settings.section`「WorldSea 产品域」独立设置分区：产品域 ↔ dsh 交界配置（说明书与指针 /
 *    快照策略）；
 * ③ `/entity` 快捷指令（2026-10-07 纯插件形态）：**客户端贡献位**（commandUi.register）——
 *    图标 + 中文名「实体」+ 英文别名 entity + 短提示原生支持、全预设可用；行为 = 壳 IPC
 *    `cmd_product_briefing` 取事实面 → `shell.overlay` Modal 弹卡（只读，不触发模型轮次）。
 * 壳命令经 `__TAURI_INTERNALS__.invoke`（ACL = worldsea-shell.toml，两窗共用）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-worldsea-console',
  factory: (require) => {
    const module = { exports: {} };
    const react = require('react');
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');
    const {
      Switch, SegmentedControl, Tag, IconChevronDownOutlineRegular, IconGlobeOutlineRegular, Modal,
      SettingsForm, SettingsValueField, SettingsFormModel, settingsTextField,
    } = require('@deepseek-ai/dsh-client-ui-primitives');

    const PLUGIN_ID = 'dsh-plugin-worldsea-console';
    /** 本插件独占的字典命名空间（locale 字典 + 标签页/分区 label）。 */
    const NS = 'settings.worldseaConsole';

    const zh = {
      nav: 'WorldSea 产品域',
      tab: 'WorldSea 插件',
      /* —— 独立分区「WorldSea 产品域」：交界配置 —— */
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
      saved: '已保存',
      loadFailed: '读取失败',
      notTauri: '此页面需要桌面壳环境（Tauri IPC 不可用）。',
      loading: '正在读取产品域设置…',
      /* —— 「WorldSea 插件」标签页：插件集中清单 —— */
      pluginsTitle: 'WorldSea 插件',
      pluginsDesc: 'WorldSea 的内置插件集中在此；点开卡片查看详情与配置。',
      statusLoading: '挂载中',
      statusUnavailable: '未挂载',
      toolPluginTitle: 'worldsea',
      toolPluginDesc: '产品域工具集：12 条 world_* 工具，让 Agent 直接读写工作台创作数据（实体 / 关系 / schema）。',
      consolePluginTitle: 'worldsea-console',
      consolePluginDesc: '产品域管理面：本插件清单与「WorldSea 产品域」交界配置页都由它提供。',
      entryLabel: '条目',
      moduleLabel: '模块',
      toolsFactLabel: '工具',
      toolsFactValue: '12 条 world_* 工具（world_project_* / world_schema_get / world_entity_* / world_relation_*）',
      presetFactLabel: '能力面',
      presetFactValue: '「产品域模式」预设专属——其余预设的会话里这些工具不可见',
      entityMenuLabel: '实体',
      entityMenuHint: '创作数据概况与实体工作提示',
      briefingTitle: '实体工作就绪卡',
      briefingLoading: '正在读取创作数据概况…',
      briefingNoProject: '无默认项目（在工作台切换项目后即成为默认）',
      briefingProjectLine: '当前项目',
      briefingSnapshotMissing: '尚未导出（先打开一次工作台）',
      briefingSnapshotNoProject: '不可用（无当前项目）',
      briefingSnapshotLine: 'schema 快照',
      briefingTimeUnknown: '时间未知',
      briefingTypeUnit: '个类型',
      briefingTypeNone: '无',
      briefingEntities: '实体',
      briefingRelations: '关系',
      briefingDataUninitialized: '数据目录未初始化（先打开一次工作台）',
      briefingDataNoProject: '不可用（无当前项目）',
      briefingDataLine: '数据概况',
      briefingClose: '关闭',
      briefingHint: '提示：创作数据的读写由 world_* 工具执行——这些工具仅「产品域模式」预设的会话挂载；本概况在任何模式下都可查看。',
      dataFace: '插件数据面',
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
    };
    const en = {
      nav: 'WorldSea Product',
      tab: 'WorldSea Plugins',
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
      saved: 'Saved',
      loadFailed: 'Failed to load',
      notTauri: 'This page requires the desktop shell (Tauri IPC unavailable).',
      loading: 'Loading product preferences…',
      pluginsTitle: 'WorldSea Plugins',
      pluginsDesc: 'All WorldSea built-in plugins in one place; open a card for details and configuration.',
      statusLoading: 'Mounting',
      statusUnavailable: 'Unmounted',
      toolPluginTitle: 'worldsea',
      toolPluginDesc: 'Product-domain toolset: 12 world_* tools letting the Agent read and write workbench creation data (entities / relations / schemas) directly.',
      consolePluginTitle: 'worldsea-console',
      consolePluginDesc: 'Product-domain management face: provides this plugin list and the "WorldSea Product" boundary settings page.',
      entryLabel: 'Entry',
      moduleLabel: 'Module',
      toolsFactLabel: 'Tools',
      toolsFactValue: '12 world_* tools (world_project_* / world_schema_get / world_entity_* / world_relation_* )',
      presetFactLabel: 'Capability plane',
      presetFactValue: 'Exclusive to the "Product Domain" preset — these tools are absent from sessions on other presets',
      entityMenuLabel: 'Entities',
      entityMenuHint: 'Creation data overview and entity-work tips',
      briefingTitle: 'Entity briefing',
      briefingLoading: 'Reading creation data…',
      briefingNoProject: 'No default project (it becomes the default once you switch projects in the workbench)',
      briefingProjectLine: 'Current project',
      briefingSnapshotMissing: 'not exported yet (open the workbench once)',
      briefingSnapshotNoProject: 'unavailable (no current project)',
      briefingSnapshotLine: 'Schema snapshot',
      briefingTimeUnknown: 'time unknown',
      briefingTypeUnit: 'types',
      briefingTypeNone: 'none',
      briefingEntities: 'Entities',
      briefingRelations: 'relations',
      briefingDataUninitialized: 'data directory not initialized (open the workbench once)',
      briefingDataNoProject: 'unavailable (no current project)',
      briefingDataLine: 'Data overview',
      briefingClose: 'Close',
      briefingHint: 'Note: creation reads/writes are performed by world_* tools, mounted only in "Product Domain" preset sessions; this overview is viewable in any mode.',
      dataFace: 'Plugin data face',
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
    };

    /** 客户端 ctx 需要的服务（slots = 模块系统核心；locale 来自 dsh-client-locale；
     *  configForms = 跨插件配置表单句柄——工具插件卡片的数据面配置据此绑定；
     *  commandUi = 指令面——/entity 快捷指令**客户端贡献位**（图标/中文名/短提示原生支持，
     *  全预设可用，零 dsh 改动；行为走壳 IPC `cmd_product_briefing` + shell.overlay 弹卡）。 */
    const inject = ['slots', 'locale', 'configForms', 'commandUi'];

    /** 壳命令调用（与壳注入的 shell_bridge 同链路：__TAURI_INTERNALS__.invoke，受 ACL 白名单管）。 */
    function shellInvoke(command, args) {
      const ipc = globalThis.__TAURI_INTERNALS__;
      if (ipc === undefined || typeof ipc.invoke !== 'function') {
        return Promise.reject(new Error('Tauri IPC unavailable'));
      }
      return ipc.invoke(command, args);
    }

    /** 壳注入的缺省 DSH_HOME：未覆盖时把「生效缺省值」显示出来；非壳环境（无该全局）退化为不显示。 */
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
      sectionLast: { display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' },
      row: { display: 'flex', gap: 12, alignItems: 'center' },
      grow: { flex: 1, minWidth: 0 },
      label: { fontWeight: 500 },
      status: { color: 'var(--color-primary, #4a9eff)', fontSize: 12 },
      error: { color: '#e5484d', fontSize: 12 },
      /* 插件卡片清单（对齐「插件列表」页的卡片形态） */
      list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
      card: { border: '1px solid var(--border, rgba(127,127,127,.25))', borderRadius: 10, overflow: 'hidden' },
      cardButton: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%', boxSizing: 'border-box', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' },
      cardMain: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
      cardTitle: { fontSize: 13, fontWeight: 600 },
      cardTrailing: { display: 'flex', alignItems: 'center', gap: 6 },
      cardDesc: { color: 'var(--text-tertiary, #888)', fontSize: 12 },
      cardDetails: { display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px 12px', borderTop: '1px solid var(--border, rgba(127,127,127,.2))' },
      chevronBox: (open) => ({ display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }),
      details: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 },
      detailRow: { display: 'flex', gap: 8 },
      detailTerm: { color: 'var(--text-tertiary, #888)', minWidth: 40 },
      detailDesc: { margin: 0, wordBreak: 'break-all' },
      configBlock: { display: 'flex', flexDirection: 'column', gap: 6 },
      briefingText: { margin: 0, whiteSpace: 'pre-wrap', font: 'inherit', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-all' },
    };

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'worldsea-console: dictionaries');
      const t = ctx.locale.bind(NS);
      const h = react.createElement;

      /** `/entity` 贡献位的就绪卡弹层状态桥（SnapshotStore：action 线程 set，overlay 组件经框架座位订阅）。 */
      const briefingStore = createSnapshotStore(null);

      /** 就绪卡异步流：壳 IPC 取事实面 → loading/ready/error 三态。Rust 侧只出结构化事实，文案在此组装。 */
      async function openEntityBriefing() {
        briefingStore.set({ phase: 'loading' });
        try {
          const data = await shellInvoke('cmd_product_briefing', {});
          briefingStore.set({ phase: 'ready', data });
        } catch (error) {
          briefingStore.set({ phase: 'error', message: String(error) });
        }
      }

      /** 事实面 → 卡片文案（逐段 fail-soft：kind 码映射降级语，卡片整体总能出）。 */
      function briefingLines(data) {
        const lines = [];
        lines.push(`${t('briefingProjectLine')}：${
          data.project?.kind === 'ok'
            ? `${data.project.title}（${data.project.path}）`
            : t('briefingNoProject')}`);
        lines.push(`${t('briefingSnapshotLine')}：${
          data.snapshot?.kind === 'ok'
            ? `${data.snapshot.generatedAt ?? t('briefingTimeUnknown')} · ${String(data.snapshot.typeKeys?.length ?? 0)} ${t('briefingTypeUnit')}（${data.snapshot.typeKeys?.join('、') || t('briefingTypeNone')}）`
            : data.snapshot?.kind === 'missing' ? t('briefingSnapshotMissing') : t('briefingSnapshotNoProject')}`);
        lines.push(`${t('briefingDataLine')}：${
          data.data?.kind === 'ok'
            ? `${t('briefingEntities')} ${data.data.entityCount}（${data.data.typeCount} ${t('briefingTypeUnit')}） · ${t('briefingRelations')} ${data.data.relationCount}`
            : data.data?.kind === 'uninitialized' ? t('briefingDataUninitialized') : t('briefingDataNoProject')}`);
        lines.push(t('briefingHint'));
        return lines.join('\n');
      }

      /** shell.overlay 弹层组件：订阅就绪卡状态桥，Modal 呈现（只读；不触发模型轮次）。 */
      function EntityBriefingOverlay(props) {
        const state = props.useBriefing((value) => value);
        const open = state !== null;
        return h(Modal, { open, onClose: () => { briefingStore.set(null); }, title: t('briefingTitle'), closeLabel: t('briefingClose') },
          state?.phase === 'loading' ? h('p', { style: styles.hint }, t('briefingLoading'))
            : state?.phase === 'error' ? h('p', { style: styles.error }, `${t('loadFailed')}：${state.message}`)
              : state?.phase === 'ready' ? h('pre', { style: styles.briefingText }, briefingLines(state.data))
                : null);
      }

      // `/entity` 快捷指令（2026-10-07 走查后定稿纯插件形态）：**客户端贡献位**（commandUi.register）
      // 承载菜单行与行为——图标/中文名/短提示原生支持（label ≠ 注册名时渲染层自动补英文别名），
      // 注册在客户端即全预设可用，零 dsh 改动。行为 = 壳 IPC 取事实面 → Modal 弹卡（只读，
      // 不触发模型轮次；Agent 侧行为仍由工具面指引段管）。同名宿主指令已撤（贡献位与宿主目录冲突）。
      ctx.effect(() => {
        try {
          return ctx.commandUi?.register?.({
            name: 'entity',
            label: () => t('entityMenuLabel'),
            description: () => t('entityMenuHint'),
            icon: IconGlobeOutlineRegular,
            available: () => true,
            ui: { kind: 'action', run: () => { void openEntityBriefing(); } },
          }) ?? (() => {});
        } catch (error) {
          console.warn('[worldsea-console] /entity 贡献位注册失败（其余面不受影响）：', error);
          return () => {};
        }
      }, 'worldsea-console: entity contribution');

      // 就绪卡弹层的根级挂载（shell.overlay 列表槽；对齐 ui-chat 配额提示先例——弹层生命期
      // 独立于设置面板是否打开）。
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'worldsea-entity-briefing', locale: NS,
        inject: () => ({ hooks: { briefing: briefingStore } }),
      }, EntityBriefingOverlay));

      /* 工具插件卡片的数据面配置 = console 插件（本插件）的 cordis config（2026-10-07 预设化换绑）。
         命名空间 = **本插件**在 cordis.patch.yml 里的**条目 id**（worldsea-console）——worldsea 工具插件
         挪进「产品域模式」预设后不再是顶层装载行，其 config 退出设置面枚举（configEditor.entries()
         只认顶层行），故数据面真源移到本插件；字段名 = Config 的键（dshHome/dataRoot）。
         两侧任一漂移即静默断链，故 __tests__/client.spec.ts 有跨文件契约用例（与 patch 行、真 Config 对读）。
         表单能力全取自上游：SettingsFormModel 管暂存/覆盖中判定/修订栅栏，SettingsForm + SettingsValueField 出 UI。 */
      const scope = ctx.configForms.get('worldsea-console');
      const form = new SettingsFormModel(scope, [settingsTextField('dshHome'), settingsTextField('dataRoot')]);
      const store = form.bind(() => ({
        ...form.shell(),
        pluginStatus: scope.getSnapshot().status,
        dshHome: form.field('dshHome'),
        dataRoot: form.field('dataRoot'),
      }));
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

      /** 卡片尾随状态：运行中不带标签（对齐插件列表页的干净行）；其余状态出 Tag。 */
      function StatusTag(props) {
        if (props.status === 'ready') return null;
        return h(Tag, { tone: props.status === 'unavailable' ? 'warning' : 'info' },
          props.status === 'unavailable' ? t('statusUnavailable') : t('statusLoading'));
      }

      /** WorldSea 插件清单数据（静态：两插件与本报同仓同节奏，文案走字典）。 */
      const PLUGINS = [
        {
          id: 'worldsea',
          titleKey: 'toolPluginTitle',
          descKey: 'toolPluginDesc',
          moduleName: 'dsh-plugin-worldsea',
          withConfig: true,
        },
        {
          id: 'worldsea-console',
          titleKey: 'consolePluginTitle',
          descKey: 'consolePluginDesc',
          moduleName: 'dsh-plugin-worldsea-console',
          withConfig: false,
        },
      ];

      /** 「WorldSea 插件」标签页：集中清单 + 工具插件卡片内嵌数据面配置表单。 */
      function PluginsTab(props) {
        const [expanded, setExpanded] = react.useState(null);
        /* 数据面状态走框架座位（renderer 把 inject.hooks.dataFace 绑成 useDataFace）：
           组件内不自订阅（dsh 客户端规约：render 读到的一切可变量都必须经框架 hook）。 */
        const face = props.useDataFace((snapshot) => snapshot);
        /* 壳注入的缺省 DSH_HOME——未覆盖时作为「缺省生效值」显示（非壳环境为 null）。 */
        const defaultHome = shellDefaultDshHome();

        /** 插件卡片的详情事实行。 */
        function facts(plugin) {
          const rows = [
            [t('entryLabel'), plugin.id],
            [t('moduleLabel'), plugin.moduleName],
          ];
          if (plugin.withConfig) rows.push([t('toolsFactLabel'), t('toolsFactValue')], [t('presetFactLabel'), t('presetFactValue')]);
          return rows;
        }

        /** 数据面配置表单（仅 worldsea 工具插件卡片）。 */
        function dataFaceForm() {
          return h('div', { style: styles.configBlock },
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
              })));
        }

        function PluginCard(plugin) {
          const open = expanded === plugin.id;
          return h('li', { key: plugin.id, style: styles.card, 'data-plugin-entry': plugin.id },
            h('button', {
              type: 'button', style: styles.cardButton,
              'aria-expanded': open, 'aria-controls': `worldsea-plugin-details-${plugin.id}`,
              onClick: () => { setExpanded((current) => current === plugin.id ? null : plugin.id); },
            },
            h('span', { style: styles.cardMain },
              h('strong', { style: styles.cardTitle }, t(plugin.titleKey)),
              h('span', { style: styles.cardTrailing },
                plugin.id === 'worldsea' ? h(StatusTag, { status: face.pluginStatus }) : null,
                h('span', { style: styles.chevronBox(open) },
                  h(IconChevronDownOutlineRegular, { size: 12, 'aria-hidden': true })))),
            h('span', { style: styles.cardDesc }, t(plugin.descKey))),
            open ? h('div', { id: `worldsea-plugin-details-${plugin.id}`, style: styles.cardDetails },
              h('dl', { style: styles.details },
                facts(plugin).map(([term, value]) => h('div', { key: term, style: styles.detailRow },
                  h('dt', { style: styles.detailTerm }, term),
                  h('dd', { style: styles.detailDesc }, value)))),
              plugin.withConfig ? dataFaceForm() : null) : null);
        }

        return h('div', { style: styles.wrap },
          h('h3', { style: styles.title }, t('pluginsTitle')),
          h('p', { style: styles.hint }, t('pluginsDesc')),
          h('ul', { style: styles.list }, PLUGINS.map(PluginCard)));
      }

      /** 「WorldSea 产品域」独立分区：交界配置（说明书与指针 + 快照策略）。 */
      function ProductDomainSection() {
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
          h('div', { style: styles.section },
            h(SwitchRow, { checked: prefs.manualGeneration, onChange: (v) => patch({ manualGeneration: v }), label: t('manualGeneration'), hint: t('manualGenerationHint') }),
            h(SwitchRow, { checked: prefs.agentsPointer, onChange: (v) => patch({ agentsPointer: v }), label: t('agentsPointer'), hint: t('agentsPointerHint') })),
          h('div', { style: styles.sectionLast },
            h('div', { style: { ...styles.row, alignItems: 'flex-start' } },
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
                status ? h('div', { style: { ...styles.status, marginTop: 4 } }, status) : null))));
      }

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'worldsea-console',
        order: 20,
        label: () => t('tab'),
        locale: NS,
        inject: () => ({ hooks: { dataFace: store }, ...form.actions() }),
      }, PluginsTab));

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'worldsea-product',
        order: 25,
        label: () => t('nav'),
        locale: NS,
      }, ProductDomainSection));
    }

    module.exports = { name: PLUGIN_ID, inject, NS, apply };
    return module.exports;
  },
});
