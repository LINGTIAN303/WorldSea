/* worldsea-shell:workspace-notice —— 工作区不可供给时的顶部横幅（C4-b）。
   只在壳探测判定「dsh 的 Windows ACL 沙箱无法供给默认工作区」时注入（文案由注入方带到
   `globalThis.__WORLDSEA_WORKSPACE_NOTICE__`）。「修复工作区权限」按钮调 `cmd_fix_workspace_acl`——
   只在用户点击时执行；授权后 dsh 会在该目录常驻能力 ACE、删除拒绝与 Low 完整性标签（上游设计使然）。
   反证开关：WORLDSEA_NO_WORKSPACE_NOTICE=1（壳侧不注入本脚本）。 */
(function () {
  try {
    var message = globalThis.__WORLDSEA_WORKSPACE_NOTICE__ || '';
    if (!message) return;
    if (document.getElementById('worldsea-workspace-notice')) return;
    var invoke = globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke;
    var box = document.createElement('div');
    box.id = 'worldsea-workspace-notice';
    box.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#3f2f0a;color:#fde68a;'
      + 'border-bottom:1px solid #a16207;padding:10px 16px;font:13px/1.6 "Segoe UI","Microsoft YaHei",system-ui;'
      + 'display:flex;gap:12px;align-items:flex-start');
    var text = document.createElement('div');
    text.setAttribute('style', 'flex:1;white-space:pre-wrap;word-break:break-word');
    text.textContent = message;
    var button = function (label, style) {
      var node = document.createElement('button');
      node.textContent = label;
      node.setAttribute('style', 'background:#78350f;color:#fef3c7;border:1px solid #b45309;border-radius:6px;'
        + 'padding:5px 12px;cursor:pointer;font:inherit;flex:none' + style);
      return node;
    };
    var fix = button('修复工作区权限', '');
    var dismiss = button('忽略', ';background:transparent;color:#fde68a99');
    fix.onclick = function () {
      if (typeof invoke !== 'function') {
        text.textContent = message + '\n（壳桥不可用：请改在命令行执行上面的修复命令）';
        return;
      }
      fix.disabled = true;
      fix.textContent = '修复中…';
      Promise.resolve(invoke('cmd_fix_workspace_acl')).then(function (label) {
        text.textContent = '已执行授权（' + label + '）。若命令仍报沙箱初始化失败，请重启应用后重试；'
          + '完整过程见应用日志 [DSH-SHELL] 工作区行。';
        fix.setAttribute('style', 'display:none');
      }).catch(function (error) {
        text.textContent = '修复失败：' + String((error && error.message) || error) + '\n原提示：' + message;
        fix.disabled = false;
        fix.textContent = '重试';
      });
    };
    dismiss.onclick = function () { box.remove(); };
    box.appendChild(text);
    box.appendChild(fix);
    box.appendChild(dismiss);
    (document.body || document.documentElement).appendChild(box);
  } catch (error) { /* 横幅自身失败不得影响页面 */ }
})()
