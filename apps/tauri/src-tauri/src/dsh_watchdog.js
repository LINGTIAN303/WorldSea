/* worldsea-shell:boot-watchdog —— 「不白屏」安全网（常驻，非诊断模式也注入）：
   入口脚本/样式加载失败，或等待 WAIT_MS 后挂载点仍为空（应用完全没渲染）时，
   就地显示一张可辨认的错误页（列出失败资源 + 重试按钮）。
   只要挂载点已渲染过，本脚本永不介入——不会干扰正常界面。
   挂载点：默认 `#root`（dsh 页）；`globalThis.__WORLDSEA_BOOT_ROOT__` 可改（工作台页 = `#app`，见 dsh_inject）。
   样式（2026-10-01）：吃 dsh 设计令牌（`--dsw-*`，缺省时回退自包含色值）——本页恰在
   dsh 前端异常时才出现，令牌取不到即回退，不得依赖样式表已加载。 */
(function () {
  try {
    var FAILED = [];
    var SHOWN = false;
    var WAIT_MS = 25000;
    var ROOT_ID = (globalThis.__WORLDSEA_BOOT_ROOT__ || 'root');
    function show() {
      if (SHOWN) return;
      var root = document.getElementById(ROOT_ID);
      if (root && root.childElementCount > 0) return;
      var host = document.body || document.documentElement;
      if (!host) return;
      SHOWN = true;
      /* 兜底色值：dsh 样式未加载时按壳的亮暗旗标二选一（令牌在时优先于兜底）。 */
      var dark = globalThis.__WORLDSEA_DARK__ !== false;
      var fallback = dark
        ? { surface: '#111113', label: '#e4e4e7', muted: '#a1a1aa', action: '#27272a', actionLabel: '#e4e4e7' }
        : { surface: '#fafaf9', label: '#1f2328', muted: '#6b7280', action: '#f4f4f5', actionLabel: '#1f2328' };
      var box = document.createElement('div');
      box.id = 'worldsea-shell-boot-error';
      box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:var(--dsw-alias-bg-layer-1,' + fallback.surface + ');color:var(--dsw-alias-label-primary,' + fallback.label + ');padding:32px;font:13px/1.7 var(--dsw-font-family,system-ui,"Segoe UI","Microsoft YaHei",sans-serif)');
      var title = document.createElement('div');
      title.setAttribute('style', 'font-size:18px;font-weight:600;margin:0 0 12px');
      title.textContent = 'WorldSea：界面未能启动';
      var detail = document.createElement('pre');
      detail.setAttribute('style', 'white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-tertiary,' + fallback.muted + ');margin:0 0 16px');
      detail.textContent = '未能通过壳协议加载的资源：\n'
        + (FAILED.length ? FAILED.join('\n') : '（入口脚本未完成，已等待 ' + (WAIT_MS / 1000) + ' 秒）')
        + '\n\n壳日志中检索 [DSH-SHELL] bridge 可看对应状态码；设 WORLDSEA_SHELL_DIAG=1 可把页面 console 一并落进日志。';
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重试';
      retry.setAttribute('style', 'background:var(--dsw-alias-button-primary-fill,' + fallback.action + ');color:var(--dsw-alias-label-primary-foreground,' + fallback.actionLabel + ');border:none;border-radius:var(--dsw-radius-sm,8px);padding:6px 14px;cursor:pointer;font:inherit');
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
    /* 同横幅：dsh 令牌定义在 body 级——错误可能在 head 阶段就已出示（先挂 html），
       body 就绪后把已出示的错误页迁入 body，让令牌（若可加载）生效。 */
    document.addEventListener('DOMContentLoaded', function () {
      var box = document.getElementById('worldsea-shell-boot-error');
      if (box && document.body && box.parentElement !== document.body) document.body.appendChild(box);
    });
  } catch (error) { /* 安全网自身失败不得影响页面 */ }
})()
