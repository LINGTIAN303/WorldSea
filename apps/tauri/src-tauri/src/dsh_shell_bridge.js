/* worldsea-shell:bridge —— 壳桥：给页面一组「壳能力」（通知 / 外链 / 设置入口 / 日志）。
   注入位置与 transport 同点（index 的 `<head>` 之后）→ 先于全部模块脚本，文档开始前即生效；
   页面在 Tauri 的 is_local_url 白名单内（自定义协议页），故 `__TAURI_INTERNALS__.invoke` 直达壳命令。
   反证开关：壳设 WORLDSEA_NO_SHELL_BRIDGE=1 时不注入（依赖它的功能必须**显式降级**，见 menu.rs 的缺桥提示）。 */
(function () {
  try {
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
    globalThis.__WORLDSEA_SHELL__ = {
      platform: 'worldsea-tauri',
      notify: function (title, body) {
        return invoke('cmd_notify', { title: String(title), body: String(body) });
      },
      openExternal: function (url) {
        return invoke('cmd_shell_open_external', { url: String(url) });
      },
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
