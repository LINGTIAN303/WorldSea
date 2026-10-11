/* worldsea-shell:diag —— 仅当壳以 WORLDSEA_SHELL_DIAG=1 启动时注入：
   把页面 console 的 error/warn、未捕获异常与资源加载失败 POST 到壳的 /__diag，落进 [DSH-SHELL] 日志。 */
(function () {
  try {
    var send = function (kind, text) {
      try {
        fetch('/__diag', { method: 'POST', body: kind + ': ' + text }).catch(function () {});
      } catch (error) { /* 诊断通道自身失败不影响页面 */ }
    };
    ['error', 'warn'].forEach(function (name) {
      var original = console[name] ? console[name].bind(console) : function () {};
      console[name] = function () {
        var parts = Array.prototype.slice.call(arguments).map(function (value) {
          try {
            return typeof value === 'string' ? value : (value && value.stack) || JSON.stringify(value);
          } catch (error) { return String(value); }
        });
        send(name, parts.join(' '));
        original.apply(null, arguments);
      };
    });
    addEventListener('error', function (event) {
      if (event.target && event.target.tagName) {
        send('resource.error', String(event.target.src || event.target.href || '(inline)'));
        return;
      }
      send('window.error', event.message + ' @' + event.filename + ':' + event.lineno);
    }, true);
    addEventListener('unhandledrejection', function (event) {
      send('unhandledrejection', String((event.reason && event.reason.stack) || event.reason));
    });
    addEventListener('DOMContentLoaded', function () {
      send('info', 'location=' + location.href + ' transport=' + (globalThis.__DSH_TRANSPORT__ ? 'set' : 'missing'));
    });
  } catch (error) { /* noop */ }
})()
