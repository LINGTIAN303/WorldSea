/* worldsea-shell:bridge —— 壳桥：给页面一组「壳能力」（通知 / 外链 / 设置入口 / 日志）。
   注入位置与 transport 同点（index 的 `<head>` 之后）→ 先于全部模块脚本，文档开始前即生效；
   页面在 Tauri 的 is_local_url 白名单内（自定义协议页），故 `__TAURI_INTERNALS__.invoke` 直达壳命令。
   反证开关：壳设 WORLDSEA_NO_SHELL_BRIDGE=1 时不注入（依赖它的功能必须**显式降级**，见 menu.rs 的缺桥提示）。 */
(function () {
  try {
    /* 幂等：重复注入是 no-op——否则监听器与 window.open 覆盖会叠加（每次求值都多一层） */
    if (globalThis.__WORLDSEA_SHELL__ !== undefined) return;
    var invoke = function (command, args) {
      var ipc = globalThis.__TAURI_INTERNALS__;
      if (ipc === undefined || typeof ipc.invoke !== 'function') {
        return Promise.reject(new Error('worldsea shell: tauri ipc unavailable'));
      }
      return ipc.invoke(command, args);
    };
    var report = function (message) {
      try {
        return invoke('cmd_shell_bridge_report', { message: String(message) });
      } catch (error) {
        return Promise.reject(error);
      }
    };
    /* dsh 客户端目前只有 zh / en 两套文案；设置入口是侧栏底部的文字控件，按可见文案定位 */
    var SETTINGS_LABELS = ['设置', 'Settings'];
    var openExternal = function (url) {
      return invoke('cmd_shell_open_external', { url: String(url) });
    };

    /* ── 外链守卫（镜像 dsh 官方 Electron 桌面版的导航定义，apps/desktop/src/main.ts:218/281）──
       · `window.open` / `target=_blank`：一律**不出应用内新窗**；http(s)/mailto → 系统浏览器
       · 页面内导航：只放行本页同源；其余 http(s) → 系统浏览器（等价官方 `will-navigate`）
       官方同款：`setWindowOpenHandler` 恒 `{action:'deny'}` + `shell.openExternal`；
       `will-navigate` 放行 `dsh-app:` 与**同源** http，其余 preventDefault + openExternal。
       已知不覆盖（与官方同级或更低风险，登记在案）：程序化 `location` 赋值（dsh 客户端现无此用法）、
       WebView2 原生右键菜单的「新窗口打开」——需要时用 WebView2 NavigationStarting 钩子补齐。 */
    var APP_ORIGIN = location.origin;
    var externallyOpenable = function (protocol) {
      return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
    };
    var guardLink = function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (anchor === null) return;
      var destination;
      try {
        destination = new URL(anchor.href, location.href);
      } catch (error) {
        return;
      }
      if (destination.protocol !== 'mailto:' && destination.origin === APP_ORIGIN) return;
      event.preventDefault();
      if (externallyOpenable(destination.protocol)) {
        openExternal(destination.href);
        report('external link → 系统浏览器：' + destination.href);
      } else {
        report('已拦截非 http(s)/mailto 导航：' + destination.href);
      }
    };
    document.addEventListener('click', guardLink, true);
    document.addEventListener('auxclick', guardLink, true);
    /* 预开窗桩（about:blank 专属）：dsh 的账号登录先开一个空标签页拿到句柄，等授权 URL 到位后
       对其 `location.replace(...)` 导航。壳里标签页由系统浏览器托管，页面侧拿不到真句柄；返回 null 会让
       那次导航整段跳过（表现为「登录点了没有反应，只能手工复制链接」）。故这里交一个桩：`location.replace`
       即交给系统浏览器外开，`close` 为无操作，`closed` 恒 false（调用方在成功/失败时会顺手关窗）。
       只认 about:blank —— 带真实地址的 window.open 仍走下面的外开且返回 null，不放大逃逸面。 */
    var preopenedShell = function () {
      var handle = {
        closed: false,
        opener: null,
        location: {
          replace: function (target) {
            var href = null;
            try { href = new URL(String(target), location.href).href } catch (error) { href = null }
            if (href !== null) {
              openExternal(href);
              report('login popup → 系统浏览器：' + href);
            } else {
              report('已拦截登录窗导航：' + String(target));
            }
          },
        },
        close: function () { report('登录窗已结束（系统浏览器侧由用户关闭）') },
        focus: function () {},
      };
      return handle;
    };
    globalThis.open = function (url) {
      // `about:blank`（忽略大小写与前后空白）＝ 预开窗语义，见上方 preopenedShell 注释
      var raw = String(url === undefined || url === null ? '' : url).trim().toLowerCase();
      if (raw === 'about:blank' || raw === '') return preopenedShell();
      var destination = null;
      try {
        destination = new URL(String(url), location.href);
      } catch (error) { /* 非 URL 形态 → 走下面的拒绝分支 */ }
      if (destination !== null && externallyOpenable(destination.protocol)) {
        openExternal(destination.href);
        report('window.open → 系统浏览器：' + destination.href);
      } else {
        report('已拦截 window.open：' + String(url));
      }
      return null;
    };

    globalThis.__WORLDSEA_SHELL__ = {
      platform: 'worldsea-tauri',
      notify: function (title, body) {
        return invoke('cmd_notify', { title: String(title), body: String(body) });
      },
      openExternal: openExternal,
      report: report,
      openSettings: function () {
        var candidates = document.querySelectorAll('button,[role="button"],a');
        for (var i = 0; i < candidates.length; i++) {
          /* 侧栏宽/窄两态：窄态只有图标，但触发按钮带 aria-label（ui-settings-general 的 SettingsRoot），故优先读它 */
          var el = candidates[i];
          var label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
          if (SETTINGS_LABELS.indexOf(label) !== -1) {
            el.click();
            report('openSettings: clicked ' + label);
            return true;
          }
        }
        report('openSettings: 未找到设置入口（dsh DOM 变更？）');
        return false;
      }
    };
    report('shell bridge ready（platform=worldsea-tauri, ipc=' + (globalThis.__TAURI_INTERNALS__ ? 'ok' : 'missing') + '）');
  } catch (error) { /* 壳桥自身失败不得影响页面 */ }
})()
