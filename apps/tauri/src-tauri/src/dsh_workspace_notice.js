/* worldsea-shell:workspace-notice —— 工作区不可供给时的顶部横幅（C4-b；样式按 dsh 原生令牌改造，2026-10-01）。
   只在壳探测判定「dsh 的 Windows ACL 沙箱无法供给默认工作区」时注入（文案由注入方带到
   `globalThis.__WORLDSEA_WORKSPACE_NOTICE__`）。「修复工作区权限」按钮调 `cmd_fix_workspace_acl`——
   只在用户点击时执行；**G3（2026-10-01）起为可回滚修复**（先备份后授权，恢复命令落
   `<工作区>/.acl-recovery/restore-command.txt`；授权后 dsh 会在该目录常驻能力 ACE、
   删除拒绝与 Low 完整性标签——上游设计使然）。
   样式：吃 dsh 设计令牌（`--dsw-*`，缺省时回退自包含色值）；横幅顶部让位壳级窗口栏
   （`--dsh-windows-titlebar-height`，兜底 32px；全屏时窗口栏隐藏 → `html[data-fullscreen]` 归零）。
   反证开关：WORLDSEA_NO_WORKSPACE_NOTICE=1（壳侧不注入本脚本）。 */
(function () {
  try {
    var message = globalThis.__WORLDSEA_WORKSPACE_NOTICE__ || '';
    if (!message) return;
    if (document.getElementById('worldsea-workspace-notice')) return;
    var invoke = globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke;
    /* 兜底色值：dsh 样式未加载时按壳的亮暗旗标二选一（令牌在时优先于兜底）。 */
    var dark = globalThis.__WORLDSEA_DARK__ !== false;
    var fallback = dark
      ? { surface: '#3f2f0a', label: '#fde68a' }
      : { surface: '#fef3c7', label: '#78350f' };
    var style = document.createElement('style');
    style.id = 'worldsea-workspace-notice-style';
    style.textContent = [
      '#worldsea-workspace-notice{position:fixed;left:0;right:0;z-index:2147483000;',
      'top:var(--dsh-windows-titlebar-height,32px);',
      'background:var(--dsw-alias-state-warn-tertiary,' + fallback.surface + ');',
      'color:var(--dsw-alias-state-warn-label,' + fallback.label + ');',
      'border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary,#f59e0b) 40%, transparent);',
      'padding:10px 16px;font:13px/1.6 var(--dsw-font-family,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif);',
      'display:flex;gap:12px;align-items:flex-start}',
      'html[data-fullscreen] #worldsea-workspace-notice{top:0}',
      '#worldsea-workspace-notice .wsn-text{flex:1;white-space:pre-wrap;word-break:break-word}',
      '#worldsea-workspace-notice .wsn-btn{flex:none;height:28px;padding:0 10px;border:none;cursor:pointer;',
      'border-radius:var(--dsw-radius-sm,8px);font:inherit;font-size:12px;line-height:18px}',
      '#worldsea-workspace-notice .wsn-fix{background:var(--dsw-alias-button-primary-fill,#78350f);',
      'color:var(--dsw-alias-label-primary-foreground,#fef3c7)}',
      '#worldsea-workspace-notice .wsn-fix:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#92400e)}',
      '#worldsea-workspace-notice .wsn-fix:disabled{cursor:not-allowed;opacity:.4}',
      '#worldsea-workspace-notice .wsn-dismiss{background:transparent;color:inherit;opacity:.75}',
      '#worldsea-workspace-notice .wsn-dismiss:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
    ].join('');
    (document.head || document.documentElement).appendChild(style);
    var box = document.createElement('div');
    box.id = 'worldsea-workspace-notice';
    var text = document.createElement('div');
    text.className = 'wsn-text';
    text.textContent = message;
    var button = function (className, label) {
      var node = document.createElement('button');
      node.type = 'button';
      node.className = 'wsn-btn ' + className;
      node.textContent = label;
      return node;
    };
    var fix = button('wsn-fix', '修复工作区权限');
    var dismiss = button('wsn-dismiss', '忽略');
    fix.onclick = function () {
      if (typeof invoke !== 'function') {
        text.textContent = message + '\n（壳桥不可用：请改在命令行执行上面的修复命令）';
        return;
      }
      fix.disabled = true;
      fix.textContent = '修复中…';
      /* G3（2026-10-01）：可回滚修复——回执 { mode, label, recoveryDir, note }（note 已含恢复指引） */
      Promise.resolve(invoke('cmd_fix_workspace_acl')).then(function (result) {
        var label = (result && result.label) || '';
        var note = (result && result.note) || '';
        text.textContent = '已修复（' + label + '）。' + note;
        fix.style.display = 'none';
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
    /* 必须挂进 body：警告色等 dsh 令牌定义在 body 级（本脚本在 head 阶段注入时 body 尚不存在——
       先挂 html 保可见，body 就绪后迁入；否则 var() 取不到令牌，全落兜底色）。 */
    var mount = function () {
      var host = document.body || document.documentElement;
      if (host && box.parentElement !== host) host.appendChild(box);
    };
    mount();
    document.addEventListener('DOMContentLoaded', mount);
  } catch (error) { /* 横幅自身失败不得影响页面 */ }
})()
