// CDP 诊断 hook（由 cdp-diag.ps1 读取后通过 Runtime.evaluate 注入）
// 目标：捕获 console 输出到 window.__diagLogs，便于后续一次性读取
window.__diagLogs = [];
const __origLog = console.log.bind(console);
console.log = function () {
  try {
    const parts = Array.prototype.map.call(arguments, function (x) {
      if (typeof x === 'string') return x;
      if (x && x.stack) return x.stack;
      return String(x);
    });
    window.__diagLogs.push(parts.join(' '));
  } catch (e) {}
  __origLog.apply(console, arguments);
};
'hooked'
