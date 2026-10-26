/* worldsea-shell:titlebar —— 壳级窗口栏（C6，2026-09-24）。
   形态来源：旧 `apps/tauri/src/ui/layout/TitleBar.vue` 的 space 变体（随旧 Vue 前端退役）——
   「壳切换控件 + 居中标题 + 窗口控制」；本脚本以**壳侧注入**方式在 dsh 界面之上恢复它。
   注入位置与壳桥同点（index 的 `<head>` 之后）→ 先于全部模块脚本；dsh 界面按官方机制自适配：
   置 `html[data-windows-titlebar]` + `--dsh-windows-titlebar-height`（留白 / 圆角 / 侧栏连色）。
   D1-b（2026-09-24）：切换控件不再走页内占位页——`cmd_shell_space_switch` 交壳做**双窗互斥切换**
   （工作台窗懒建/显示，本窗随之被隐藏），故本窗按钮文案/图标恒为「Agent 空间」，无需翻转。
   （工作台窗不吃本注入：它用旧前端自带的 TitleBar 作窗口栏。）
   反证开关（壳侧控制，本脚本不感知）：`WORLDSEA_NO_TITLEBAR=1` 不注入；`WORLDSEA_FRAMED=1` 回原生边框亦不注入。
   边界：拖拽走 JS 方案（非系统非客户区）→ 无系统 snap。
   G1 收尾（2026-09-30）：**窗口控制键与空间切换键**——Ctrl+M 最小化 / F10 最大化还原 / Ctrl+W 关闭
   （对齐工作台窗 TitleBar.vue 的四键口径）+ Ctrl+Tab 切到工作台（全屏下唯一通路；Ctrl+Tab 自本批接入）。
   相位与让行见下方「窗口控制键」注；F11 维持上方捕获相位专块。
   G1（2026-09-29）：**全屏桥**——F11（捕获相位）→ 壳命令 `toggle-fullscreen`；全屏时隐藏本栏并置
   `html[data-fullscreen]`（dsh 据此把浮层内缩 52px→20px、遮罩 32px→0），退出后全部还原。
   语义与三条触发路径见下方 `applyFullscreen` 处注。
   E9（2026-09-27）：**侧栏开关键捞回**——dsh 在标题栏模式下把该键 fixed 定位到视口左上角
   （`ui-sidebar/SidebarRoot.module.css`：left:12px / top:calc((H-28px)/2) / z-index:30），官方桌面
   该区域是透明系统拖拽区故键可见；本栏是不透明实体栏且 z-index 更高 → 键被完全盖住（用户视角 =
   「侧栏键不见了」）。处置：胶囊右侧留占位槽，把 dsh 键用内联样式钉到槽位并抬升 z-index——
   键仍是 dsh 的（React 状态/tooltip 自洽），不碰 dsh 树。 */
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
    /* 全屏态（G1）：提前声明——`relocateSidebarToggle` 要在本栏隐藏时早退，而它定义在前 */
    var fullscreenOn = false;

    var invoke = function (command, args) { return ipc.invoke(command, args); };
    var windowAction = function (action) { return invoke('cmd_shell_window_action', { action: action }); };
    /** 空间切换（D1-b）：壳侧双窗互斥（工作台窗懒建 → 显示 → 隐藏本窗） */
    var spaceSwitch = function (target) { return invoke('cmd_shell_space_switch', { target: target }); };
    var report = function (message) {
      try { invoke('cmd_shell_bridge_report', { message: 'titlebar: ' + message }); } catch (error) { /* 日志失败不影响窗口栏 */ }
    };

    /* ── 图标：全部内联 SVG（禁 emoji / 禁图标库；chat 取自 ui-kit 图标集，控制按钮照搬旧 TitleBar）── */
    var iconStroke = function (d, size) {
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
    };
    var ICON_CHAT = iconStroke('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z', 14);
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
      'user-select:none;-webkit-user-select:none;}',
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
      '#worldsea-titlebar .wstb-sidebar-slot{position:relative;width:28px;height:24px;margin:0 2px 0 8px;flex-shrink:0;}',
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
      '<span class="wstb-sidebar-slot" aria-hidden="true"></span>' +
      '<div class="wstb-drag"></div>' +
      '<div class="wstb-title"><span>WorldSea — Agent 空间</span></div>' +
      '<div class="wstb-right">' +
      '<button type="button" class="wstb-btn wstb-more" aria-label="更多操作" title="更多操作">' + ICON_MORE + '</button>' +
      '<div class="wstb-controls">' +
      '<button type="button" class="wstb-btn wstb-min" aria-label="最小化" title="最小化">' + ICON_MIN + '</button>' +
      '<button type="button" class="wstb-btn wstb-max" aria-label="最大化" title="最大化/还原">' + ICON_MAX + '</button>' +
      '<button type="button" class="wstb-btn wstb-close" aria-label="关闭" title="关闭">' + ICON_CLOSE + '</button>' +
      '</div></div>';

    var toggleBtn = bar.querySelector('.wstb-toggle');
    var maxBtn = bar.querySelector('.wstb-max');
    var moreBtn = bar.querySelector('.wstb-more');
    var maxIcon = ICON_MAX;

    /* 切换控件 = 「切到工作台」（本窗恒为 Agent 空间）：壳侧建/显示工作台窗并隐藏本窗 */
    toggleBtn.addEventListener('click', function () {
      spaceSwitch('workbench').then(function (target) {
        report('space → ' + target);
      }).catch(function (error) { report('空间切换失败：' + error); });
    });

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
        /* 每次窗口动作都一并带回全屏态（G1）→ F11 / 双击最大化 / 挂载查询共用这一条回传口径 */
        applyFullscreen(!!(result && result.fullscreen === true));
        return result;
      }).catch(function (error) { report('窗口动作失败：' + error); });
    };

    bar.querySelector('.wstb-min').addEventListener('click', function () { void windowAction('minimize').catch(function () {}); });
    maxBtn.addEventListener('click', function () { void syncAfter(windowAction('toggle-maximize')); });
    bar.querySelector('.wstb-close').addEventListener('click', function () { void windowAction('close').catch(function () {}); });

    /* 最大化 / 全屏状态同步：系统手势（Win+↑ / 拖动吸附）改变最大化时 resize 事件兜底 */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeTimer = null;
        windowAction('is-maximized').then(function (result) {
          if (result && typeof result.maximized === 'boolean') syncMaxButton(result.maximized);
          if (result && typeof result.fullscreen === 'boolean') applyFullscreen(result.fullscreen);
        }).catch(function () { /* 查询失败保留当前状态 */ });
      }, 120);
    });

    /* 「⋯」→ 壳侧 popup 菜单（屏幕坐标由壳按窗口位置换算；不 await——弹出是模态循环） */
    moreBtn.addEventListener('click', function () {
      var rect = moreBtn.getBoundingClientRect();
      invoke('cmd_shell_popup_menu', { x: Math.round(rect.left), y: Math.round(rect.bottom + 2) })
        .catch(function (error) { report('popup 菜单失败：' + error); });
    });

    /* ── 侧栏开关键捞回（E9）：见文件头注。
       键的稳定特征 = button[aria-keyshortcuts] 且 class 含 toggle 且 position:fixed
       （dsh 标题栏模式专属定位；其它同名按钮不浮动，不误伤）。
       dsh 键由 React 异步渲染（本脚本挂载时页面模块多半未就绪）→ 重试轮询；
       窗口尺寸 / 页面缩放变化后 getBoundingClientRect 失真 → resize 时重新对齐。 */
    var slot = bar.querySelector('.wstb-sidebar-slot');
    var findSidebarToggle = function () {
      var candidates = document.querySelectorAll('button[aria-keyshortcuts]');
      for (var i = 0; i < candidates.length; i++) {
        var button = candidates[i];
        if (!/toggle/i.test(button.className)) continue;
        if (getComputedStyle(button).position !== 'fixed') continue;
        return button;
      }
      return null;
    };
    var relocateSidebarToggle = function () {
      /* 全屏时本栏隐藏 → 槽位 rect 全零，钉住会把键扔到 (0,0)：直接早退，让 dsh 自己的定位接管 */
      if (fullscreenOn) return false;
      var toggle = findSidebarToggle();
      if (toggle === null) return false;
      var rect = slot.getBoundingClientRect();
      toggle.style.left = Math.round(rect.left) + 'px';
      toggle.style.top = Math.round((HEIGHT - toggle.offsetHeight) / 2) + 'px';
      toggle.style.zIndex = '2147483001';
      return true;
    };
    var toggleRetries = 0;
    var tryRelocateSidebarToggle = function () {
      if (relocateSidebarToggle()) return;
      if (toggleRetries++ < 40) setTimeout(tryRelocateSidebarToggle, 250);
    };
    window.addEventListener('resize', function () { relocateSidebarToggle(); });

    /* ── 全屏桥（G1，2026-09-29）──
       语义取自上游：`html[data-fullscreen]` = 「原生窗口控件已隐藏」（`dsh/apps/desktop/src/
       preload-platform.ts` 注 + `main.ts` 的 enter/leave-full-screen 真源），**与最大化无关**——
       上游最大化时同样保留 32px 内缩，故本栏在最大化下必须留在原位。
       上游 Windows 全屏只重置 `--dsh-frame-overlay-top`(→20px) 与 `--dsh-frame-chrome-top`(→0)，
       **不**重置 `--dsh-windows-titlebar-height` → dsh 自己那条 32px 带仍在（侧栏键回它的原生定位）。
       本栏 z-index 高于 dsh 浮层，所以全屏只能「隐藏本栏 + 置属性」：留着栏又置属性会让浮层
       顶部 12px 被栏盖住（无中间态）。三条触发路径汇聚到 applyFullscreen：
       ① 页面 F11 → 壳命令返回值 ② 菜单（Rust 发起）→ CustomEvent ③ 挂载/resize 查询 → 返回值。 */
    var unpinSidebarToggle = function () {
      var toggle = findSidebarToggle();
      if (toggle === null) return;
      toggle.style.left = '';
      toggle.style.top = '';
      toggle.style.zIndex = '';
    };
    var applyFullscreen = function (on) {
      var next = on === true;
      if (next === fullscreenOn) return;
      fullscreenOn = next;
      /* 上游 preload-platform.ts 同款：置 'true' / 整个属性删掉（不是置 'false'） */
      if (next) root.setAttribute('data-fullscreen', 'true');
      else root.removeAttribute('data-fullscreen');
      /* 必须走内联 display:none——`hidden` 属性会被本栏 author 级的 display:flex 压掉 */
      bar.style.display = next ? 'none' : '';
      if (next) unpinSidebarToggle();
      /* 退全屏要重新钉回槽位；键可能已被 React 重渲染掉 → 重置重试预算走轮询 */
      else { toggleRetries = 0; tryRelocateSidebarToggle(); }
      report(next ? '全屏：窗口栏已隐藏（data-fullscreen 置位）' : '全屏：窗口栏已恢复');
    };

    /* F11 = 全屏切换（浏览器惯例；同仓 `apps/tauri/src/ui/layout/TitleBar.vue` 的窗口控制键先例）。
       能派发到页面是因为 lib.rs 已关 WebView2 浏览器加速键（SetAreBrowserAcceleratorKeysEnabled(false)），
       否则 F11 被 WebView2 壳层吞掉。刻意用**捕获相位**：全屏时本栏已隐藏，F11 是唯一退出通路，
       不能被 dsh 内部某个 stopPropagation 掐断；F11 非文本键，捕获相位不干扰输入。 */
    window.addEventListener('keydown', function (event) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key.toLowerCase() !== 'f11') return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      void syncAfter(windowAction('toggle-fullscreen'));
    }, true);

    /* ── 窗口控制键与空间切换键（G1 收尾，2026-09-30；对齐工作台窗 `TitleBar.vue:139-148` 四键）──
       Ctrl+M 最小化 / F10 最大化还原 / Ctrl+W 关闭 / Ctrl+Tab 切到工作台（F11 在上方捕获相位专块）。
       相位 = **冒泡**（非 F11 那种「唯一退出通路」场景，不抢跑）：dsh 的快捷键 runtime = web
       （`client/dom.ts`：data-platform 缺席 → web），其「关闭页」在 web 档是 **Ctrl+Alt+W**——
       裸 Ctrl+W / F10 / Ctrl+M / Ctrl+Tab 均无上游默认绑定（grep 全树核过）。
       两道让行：① 已被上游处理（defaultPrevented，含 dsh 快捷键系统与 xterm 可能的中止）；
       ② 终端区（`.xterm` 容器内）Ctrl+M＝回车、Ctrl+W＝删词、F10 是 TUI 功能键——一律不抢；
       Ctrl+Tab 无终端语义，终端聚焦时也可切。修饰键门槛照抄 TitleBar.vue：
       Ctrl+M / Ctrl+W＝mod 且无 alt/shift；F10＝不得带任何修饰。IME 组词期全让行。 */
    window.addEventListener('keydown', function (event) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.defaultPrevented) return;
      var mod = event.ctrlKey || event.metaKey;
      var key = event.key.toLowerCase();
      var target = event.target;
      var inTerminal = !!(target && target.closest && target.closest('.xterm'));
      if (inTerminal && (key === 'm' || key === 'w' || key === 'f10')) return;
      switch (key) {
        case 'm':
          if (mod && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            void windowAction('minimize').catch(function () {});
          }
          break;
        case 'f10':
          if (!mod && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            void syncAfter(windowAction('toggle-maximize'));
          }
          break;
        case 'w':
          if (mod && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            void windowAction('close').catch(function () {});
          }
          break;
        case 'tab':
          if (mod && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            spaceSwitch('workbench').then(function (next) {
              report('space → ' + next);
            }).catch(function (error) { report('空间切换失败：' + error); });
          }
          break;
      }
    });

    /* 菜单路径回传：`menu.rs` 的 ID_FULLSCREEN 在 set_fullscreen 成功后派发本事件。
       事件名是壳两侧的共享字面量，`__tests__/titlebar.spec.ts` 有跨文件契约用例守着。
       无监听者（WORLDSEA_NO_TITLEBAR / WORLDSEA_FRAMED 反证开关下本脚本不注入）时派发无害。 */
    window.addEventListener('worldsea:fullscreen', function (event) {
      applyFullscreen(event.detail === true);
    });

    var mount = function () {
      document.head.appendChild(style);
      document.body.appendChild(bar);
      report('窗口栏已挂载（height=' + HEIGHT + ', shell=space）');
      /* 挂载即查两态：全屏中重载页面要直接落全屏形态（对齐上游 main.ts 加载后补发当前态） */
      void syncAfter(windowAction('is-maximized'));
      tryRelocateSidebarToggle();
    };
    /* 挂载时机：注入点在 `<head>` 后——body 可能尚未建立（流式解析）→ 等 DOMContentLoaded；
       body 已就绪则立即挂载（正常加载尾段与 jsdom 测试均命中；不依赖 readyState 的时序语义）。 */
    if (document.body !== null) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  } catch (error) { /* 窗口栏自身失败不得影响页面 */ }
})()
