/* worldsea-shell:titlebar —— 壳级窗口栏（C6，2026-09-24）。
   形态来源：旧 `apps/tauri/src/ui/layout/TitleBar.vue` 的 space 变体（随旧 Vue 前端退役）——
   「壳切换控件 + 居中标题 + 窗口控制」；本脚本以**壳侧注入**方式在 dsh 界面之上恢复它。
   注入位置与壳桥同点（index 的 `<head>` 之后）→ 先于全部模块脚本；dsh 界面按官方机制自适配：
   置 `html[data-windows-titlebar]` + `--dsh-windows-titlebar-height`（留白 / 圆角 / 侧栏连色）。
   反证开关（壳侧控制，本脚本不感知）：`WORLDSEA_NO_TITLEBAR=1` 不注入；`WORLDSEA_FRAMED=1` 回原生边框亦不注入。
   边界：拖拽走 JS 方案（非系统非客户区）→ 无系统 snap；`Ctrl+Tab` 切换键位不进本批。 */
(function () {
  try {
    /* 幂等：重复注入是 no-op（家族惯例，见 dsh_shell_bridge.js） */
    if (globalThis.__WORLDSEA_TITLEBAR__ !== undefined) return;
    /* 无壳能力（浏览器直开等非壳环境）：不注入——没有 IPC 的窗口栏只是摆设 */
    var ipc = globalThis.__TAURI_INTERNALS__;
    if (ipc === undefined || typeof ipc.invoke !== 'function') return;
    globalThis.__WORLDSEA_TITLEBAR__ = true;

    var HEIGHT = 32;
    var root = document.documentElement;
    /* dsh 内置的 Windows 形态适配（官方 preload-windows.ts 同款机制；官方桌面为 40px，本栏取旧 TitleBar 的 32px） */
    root.setAttribute('data-windows-titlebar', '');
    root.style.setProperty('--dsh-windows-titlebar-height', HEIGHT + 'px');

    var invoke = function (command, args) { return ipc.invoke(command, args); };
    var windowAction = function (action) { return invoke('cmd_shell_window_action', { action: action }); };
    var report = function (message) {
      try { invoke('cmd_shell_bridge_report', { message: 'titlebar: ' + message }); } catch (error) { /* 日志失败不影响窗口栏 */ }
    };

    /* ── 图标：全部内联 SVG（禁 emoji / 禁图标库；chat、monitor 取自 ui-kit 图标集，控制按钮照搬旧 TitleBar）── */
    var iconStroke = function (d, size) {
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
    };
    var ICON_CHAT = iconStroke('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z', 14);
    var ICON_MONITOR = iconStroke('M3 4h18v12H3zM8 20h8M12 16v4', 14);
    var ICON_MORE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
    var ICON_MIN = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>';
    var ICON_MAX = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    var ICON_RESTORE = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1"/><path d="M3 3 V1 H9 V7 H7" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    var ICON_CLOSE = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>';

    /* ── 样式：配色全取 dsh 运行时 token（随亮/暗主题），退化值兜底 ── */
    var STYLE = [
      '#worldsea-titlebar{position:fixed;inset:0 0 auto 0;height:' + HEIGHT + 'px;z-index:2147483000;display:flex;align-items:center;',
      'background:var(--dsw-specific-sidebar-fill,#1b1b1c);color:var(--dsw-alias-label-secondary,#9aa0a6);',
      'font-family:var(--dsw-font-family,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:12px;line-height:1;',
      'user-select:none;-webkit-user-select:none;border-bottom:1px solid rgba(127,127,127,.22);}',
      '#worldsea-titlebar .wstb-toggle{position:relative;display:inline-flex;align-items:center;gap:6px;height:24px;margin:0 2px 0 8px;padding:0 10px;',
      'border:none;border-radius:999px;background:rgba(127,127,127,.16);color:var(--dsw-alias-label-primary,#e6e9ee);',
      'font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;',
      'transition:background .15s ease;}',
      '#worldsea-titlebar .wstb-toggle:hover{background:rgba(127,127,127,.28);}',
      '#worldsea-titlebar .wstb-toggle .wstb-toggle-icon{display:inline-flex;align-items:center;}',
      '#worldsea-titlebar .wstb-title{position:absolute;left:50%;transform:translateX(-50%);top:0;height:100%;',
      'display:flex;align-items:center;max-width:40%;overflow:hidden;pointer-events:none;}',
      '#worldsea-titlebar .wstb-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#9aa0a6);}',
      '#worldsea-titlebar .wstb-drag{flex:1;height:100%;}',
      '#worldsea-titlebar .wstb-right{display:flex;align-items:center;height:100%;flex-shrink:0;}',
      '#worldsea-titlebar .wstb-btn{display:inline-flex;align-items:center;justify-content:center;height:100%;',
      'border:none;background:transparent;color:inherit;cursor:pointer;font:inherit;}',
      '#worldsea-titlebar .wstb-more{width:36px;}',
      '#worldsea-titlebar .wstb-more:hover{background:rgba(127,127,127,.18);color:var(--dsw-alias-label-primary,#e6e9ee);}',
      '#worldsea-titlebar .wstb-controls{display:flex;height:100%;}',
      '#worldsea-titlebar .wstb-controls .wstb-btn{width:44px;}',
      '#worldsea-titlebar .wstb-controls .wstb-btn:hover{background:rgba(127,127,127,.18);color:var(--dsw-alias-label-primary,#e6e9ee);}',
      '#worldsea-titlebar .wstb-close:hover{background:#d13438;color:#fff;}',
      '#worldsea-workbench{position:fixed;inset:' + HEIGHT + 'px 0 0 0;z-index:2147482000;display:none;align-items:center;justify-content:center;',
      'background:var(--dsw-alias-bg-base,#131316);color:var(--dsw-alias-label-primary,#e6e9ee);',
      'font-family:var(--dsw-font-family,system-ui,-apple-system,"Segoe UI",sans-serif);}',
      '#worldsea-workbench.wstb-open{display:flex;}',
      '#worldsea-workbench .wstb-wb-inner{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:24px;}',
      '#worldsea-workbench .wstb-wb-brand{font-size:26px;font-weight:700;letter-spacing:.06em;}',
      '#worldsea-workbench .wstb-wb-sub{font-size:14px;color:var(--dsw-alias-label-secondary,#9aa0a6);}',
      '#worldsea-workbench .wstb-wb-note{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0a6);opacity:.75;margin:0;}',
      '#worldsea-workbench .wstb-wb-back{margin-top:8px;height:28px;padding:0 14px;border:1px solid rgba(127,127,127,.35);',
      'border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;}',
      '#worldsea-workbench .wstb-wb-back:hover{background:rgba(127,127,127,.16);}',
    ].join('');

    var style = document.createElement('style');
    style.id = 'worldsea-titlebar-style';
    style.textContent = STYLE;

    var bar = document.createElement('div');
    bar.id = 'worldsea-titlebar';
    bar.innerHTML =
      '<button type="button" class="wstb-toggle" aria-label="切换到工作台" title="切换到工作台">' +
      '<span class="wstb-toggle-icon">' + ICON_CHAT + '</span>' +
      '<span class="wstb-toggle-label">Agent 空间</span></button>' +
      '<div class="wstb-drag"></div>' +
      '<div class="wstb-title"><span>WorldSea — Agent 空间</span></div>' +
      '<div class="wstb-right">' +
      '<button type="button" class="wstb-btn wstb-more" aria-label="更多操作" title="更多操作">' + ICON_MORE + '</button>' +
      '<div class="wstb-controls">' +
      '<button type="button" class="wstb-btn wstb-min" aria-label="最小化" title="最小化">' + ICON_MIN + '</button>' +
      '<button type="button" class="wstb-btn wstb-max" aria-label="最大化" title="最大化/还原">' + ICON_MAX + '</button>' +
      '<button type="button" class="wstb-btn wstb-close" aria-label="关闭" title="关闭">' + ICON_CLOSE + '</button>' +
      '</div></div>';

    var workbench = document.createElement('div');
    workbench.id = 'worldsea-workbench';
    workbench.innerHTML =
      '<div class="wstb-wb-inner">' +
      '<div class="wstb-wb-brand">WorldSea</div>' +
      '<div class="wstb-wb-sub">工作台 · 产品域即将落位</div>' +
      '<p class="wstb-wb-note">世界观创作视图（27 芽）将在后续批次接入此处，Agent 空间会话保持运行。</p>' +
      '<button type="button" class="wstb-wb-back">返回 Agent 空间</button>' +
      '</div>';

    var toggleBtn = bar.querySelector('.wstb-toggle');
    var toggleIcon = bar.querySelector('.wstb-toggle-icon');
    var toggleLabel = bar.querySelector('.wstb-toggle-label');
    var titleSpan = bar.querySelector('.wstb-title span');
    var maxBtn = bar.querySelector('.wstb-max');
    var moreBtn = bar.querySelector('.wstb-more');
    var maxIcon = ICON_MAX;
    var shell = 'space';

    var setShell = function (next) {
      shell = next;
      var inSpace = shell === 'space';
      toggleLabel.textContent = inSpace ? 'Agent 空间' : '工作台';
      toggleIcon.innerHTML = inSpace ? ICON_CHAT : ICON_MONITOR;
      var hint = inSpace ? '切换到工作台' : '返回 Agent 空间';
      toggleBtn.setAttribute('aria-label', hint);
      toggleBtn.setAttribute('title', hint);
      titleSpan.textContent = inSpace ? 'WorldSea — Agent 空间' : 'WorldSea — 工作台';
      workbench.classList.toggle('wstb-open', !inSpace);
      report('shell → ' + (inSpace ? 'Agent 空间' : '工作台（占位页）'));
    };

    toggleBtn.addEventListener('click', function () { setShell(shell === 'space' ? 'workbench' : 'space'); });
    workbench.querySelector('.wstb-wb-back').addEventListener('click', function () { setShell('space'); });

    /* ── 拖拽 / 双击（Tauri 生态惯例：detail===2 走最大化，否则起拖）──
       空白区按下即起拖：按钮区不参与（closest('button')）；标题用了 pointer-events:none 但 target 仍可能是 bar 自身 */
    bar.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      var target = event.target;
      if (target && target.closest && target.closest('button')) return;
      event.preventDefault();
      if (event.detail === 2) { void syncAfter(windowAction('toggle-maximize')); return; }
      windowAction('start-drag').catch(function (error) { report('start-drag 失败：' + error); });
    });

    var syncMaxButton = function (maximized) {
      maxIcon = maximized ? ICON_RESTORE : ICON_MAX;
      maxBtn.innerHTML = maxIcon;
      maxBtn.setAttribute('aria-label', maximized ? '还原' : '最大化');
    };
    var syncAfter = function (promise) {
      return promise.then(function (result) {
        var maximized = result && result.maximized === true;
        syncMaxButton(maximized);
        return result;
      }).catch(function (error) { report('窗口动作失败：' + error); });
    };

    bar.querySelector('.wstb-min').addEventListener('click', function () { void windowAction('minimize').catch(function () {}); });
    maxBtn.addEventListener('click', function () { void syncAfter(windowAction('toggle-maximize')); });
    bar.querySelector('.wstb-close').addEventListener('click', function () { void windowAction('close').catch(function () {}); });

    /* 最大化状态同步：系统手势（Win+↑ / 拖动吸附）改变最大化时 resize 事件兜底 */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeTimer = null;
        windowAction('is-maximized').then(function (result) {
          if (result && typeof result.maximized === 'boolean') syncMaxButton(result.maximized);
        }).catch(function () { /* 查询失败保留当前图标 */ });
      }, 120);
    });

    /* 「⋯」→ 壳侧 popup 菜单（屏幕坐标由壳按窗口位置换算；不 await——弹出是模态循环） */
    moreBtn.addEventListener('click', function () {
      var rect = moreBtn.getBoundingClientRect();
      invoke('cmd_shell_popup_menu', { x: Math.round(rect.left), y: Math.round(rect.bottom + 2) })
        .catch(function (error) { report('popup 菜单失败：' + error); });
    });

    var mount = function () {
      document.head.appendChild(style);
      document.body.appendChild(bar);
      document.body.appendChild(workbench);
      report('窗口栏已挂载（height=' + HEIGHT + ', shell=space）');
      windowAction('is-maximized').then(function (result) {
        if (result && result.maximized === true) syncMaxButton(true);
      }).catch(function () { /* 初始态查询失败保留默认图标 */ });
    };
    /* 挂载时机：注入点在 `<head>` 后——body 可能尚未建立（流式解析）→ 等 DOMContentLoaded；
       body 已就绪则立即挂载（正常加载尾段与 jsdom 测试均命中；不依赖 readyState 的时序语义）。 */
    if (document.body !== null) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  } catch (error) { /* 窗口栏自身失败不得影响页面 */ }
})()
