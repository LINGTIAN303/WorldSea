/* worldsea-shell:boot-watchdog —— 「不白屏」安全网（常驻，非诊断模式也注入）：
   入口脚本/样式加载失败，或等待 WAIT_MS 后 #root 仍为空（应用完全没渲染）时，
   就地显示一张可辨认的错误页（列出失败资源 + 重试按钮）。
   只要 #root 已渲染过，本脚本永不介入——不会干扰正常界面。 */
(function () {
  try {
    var FAILED = [];
    var SHOWN = false;
    var WAIT_MS = 25000;
    function show() {
      if (SHOWN) return;
      var root = document.getElementById('root');
      if (root && root.childElementCount > 0) return;
      var host = document.body || document.documentElement;
      if (!host) return;
      SHOWN = true;
      var box = document.createElement('div');
      box.id = 'worldsea-shell-boot-error';
      box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:#111113;color:#e4e4e7;padding:32px;font:13px/1.7 "Segoe UI","Microsoft YaHei",system-ui');
      var title = document.createElement('div');
      title.setAttribute('style', 'font-size:18px;font-weight:600;margin:0 0 12px');
      title.textContent = 'WorldSea：界面未能启动';
      var detail = document.createElement('pre');
      detail.setAttribute('style', 'white-space:pre-wrap;word-break:break-word;color:#a1a1aa;margin:0 0 16px');
      detail.textContent = '未能通过壳协议加载的资源：\n'
        + (FAILED.length ? FAILED.join('\n') : '（入口脚本未完成，已等待 ' + (WAIT_MS / 1000) + ' 秒）')
        + '\n\n壳日志中检索 [DSH-SHELL] bridge 可看对应状态码；设 WORLDSEA_SHELL_DIAG=1 可把页面 console 一并落进日志。';
      var retry = document.createElement('button');
      retry.textContent = '重试';
      retry.setAttribute('style', 'background:#27272a;color:#e4e4e7;border:1px solid #3f3f46;border-radius:6px;padding:6px 14px;cursor:pointer');
      retry.onclick = function () { location.reload(); };
      box.appendChild(title);
      box.appendChild(detail);
      box.appendChild(retry);
      host.appendChild(box);
    }
    addEventListener('error', function (event) {
      var target = event.target;
      if (!target || !target.tagName) return;
      var tag = target.tagName;
      if (tag !== 'SCRIPT' && tag !== 'LINK') return;
      FAILED.push(String(target.src || target.href || '(inline)'));
      /* 入口脚本失败是致命的，立即出示；样式失败只登记，等超时再判 */
      if (tag === 'SCRIPT') show();
    }, true);
    setTimeout(show, WAIT_MS);
  } catch (error) { /* 安全网自身失败不得影响页面 */ }
})()
