/* worldsea-shell:stream —— 页面的 openStream 钩子（C2 真·无端口）：逻辑流经 Tauri IPC 直达壳的管道客户端。
   注入位置与 transport 同点（index 的 `<head>` 之后、transport 行之前）——transport 行从中取 openStream 装进
   `__DSH_TRANSPORT__`（只合并不覆盖）。页面在 Tauri 的 is_local_url 白名单内（自定义协议页），
   故 `__TAURI_INTERNALS__.invoke` 直达壳命令；下行用与 @tauri-apps/api 的 Channel 同形的 `__CHANNEL__:<id>`。

   对接契约（与 dsh 客户端一致）：
   - 钩子形态 `openStream(endpoint, payload, signal, uplink) → AsyncIterable`（rpc.ts 的 RpcStreamOpen）；
   - 抛出的错误带 `dshRemoteStreamFailure` 标记：`{kind:'remote',code,details}`（网关业务/协议错误，保留语义）
     或 `{kind:'carrier'}`（载体故障）——客户端据此选择重试或显式失败；
   - 消费方提前退出（迭代器 return / signal abort）→ 通知壳取消宿主侧流，不泄漏。
   反证开关：壳设 WORLDSEA_NO_TRANSPORT_INJECT=1 时本脚本不注入（页面退到 WS 路径，流面必须显式降级）。 */
(function () {
  try {
    /* 幂等：重复注入是 no-op */
    if (globalThis.__WORLDSEA_STREAM__ !== undefined) return;
    var invoke = function (command, args) {
      var ipc = globalThis.__TAURI_INTERNALS__;
      if (ipc === undefined || typeof ipc.invoke !== 'function') {
        return Promise.reject(new Error('worldsea stream: tauri ipc unavailable'));
      }
      return ipc.invoke(command, args);
    };

    /* F4（2026-09-30）：本页未完成流登记——文档卸载（pagehide）时批量取消。
       动机（真机取证）：页重载后旧页已开的流无人取消，壳持续向失效 callback id 投递
       （`[TAURI] Couldn't find callback id` 刷屏，且每次刷新叠加一套 workspace/follow、$events、
       session/control）——pagehide 是唯一一次性的机会窗口，且窗口隐藏/最小化不触发它（不误伤流式）。
       尽力而为：invoke 在卸载期仍会被宿主收到；漏掉即退回今日行为（无回归）。 */
    var openIds = {};
    addEventListener('pagehide', function () {
      for (var key in openIds) {
        try { invoke('cmd_stream_cancel', { id: Number(key) }); } catch (error) { /* 尽力而为 */ }
      }
    });

    /* 失败标记：与客户端 normalizeConnectionStream 的读取面逐字一致 */
    function failureOf(failure) {
      var message = failure && failure.message ? String(failure.message) : 'worldsea stream: 流失败';
      var error = new Error(message);
      if (failure && failure.kind === 'remote') {
        error.dshRemoteStreamFailure = {
          kind: 'remote',
          code: String(failure.code === undefined || failure.code === null ? '' : failure.code),
          details: failure.details === undefined || failure.details === null ? {} : failure.details
        };
      } else {
        error.dshRemoteStreamFailure = { kind: 'carrier' };
      }
      return error;
    }

    /* 最小 Channel：与 @tauri-apps/api 的 Channel 同形（toJSON → `__CHANNEL__:<id>`；下行体 {message,index}）。
       本场景的流下行按序到达，无需官方实现的乱序重排与 cleanup 簿记。 */
    function makeChannel(onMessage) {
      var ipc = globalThis.__TAURI_INTERNALS__;
      var id = ipc.transformCallback(function (event) {
        if (event && event.end === true) return;
        onMessage(event.message);
      }, false);
      return { toJSON: function () { return '__CHANNEL__:' + id; } };
    }

    /* 一条逻辑流：异步生成器（首次 next 才真正开流，与 RpcStreamOpen 契约一致）。 */
    async function* run(endpoint, payload, signal, uplink) {
      if (signal && signal.aborted === true) {
        throw signal.reason instanceof Error ? signal.reason : new Error('worldsea stream: aborted');
      }
      var queue = [];
      var terminal = false;
      var failed = null;
      var wake = null;
      var id = null;
      var uplinkStopped = false;
      function notify() { var w = wake; wake = null; if (w) w(); }
      function take() {
        return new Promise(function (resolve) {
          if (queue.length > 0 || terminal || failed !== null) { resolve(); return; }
          wake = resolve;
        });
      }
      var channel = makeChannel(function (message) {
        if (!message) return;
        if (message.type === 'item') { queue.push(message.value); notify(); return; }
        if (message.type === 'error') { failed = failureOf(message.failure); terminal = true; notify(); return; }
        terminal = true;
        notify();
      });
      try {
        id = await invoke('cmd_stream_open', {
          endpoint: String(endpoint),
          payload: payload === undefined ? null : payload,
          channel: channel
        });
      } catch (error) {
        throw failureOf({ kind: 'carrier', message: 'worldsea stream: 打开失败（' + String(error && error.message ? error.message : error) + '）' });
      }
      openIds[id] = true; /* F4：登记未完成流（终态/取消时注销，见 finally） */
      var onAbort = function () {
        try { invoke('cmd_stream_cancel', { id: id }); } catch (error) { /* 取消尽力而为 */ }
        failed = signal.reason instanceof Error ? signal.reason : new Error('worldsea stream: aborted');
        terminal = true;
        notify();
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      var pump = null;
      if (uplink !== undefined && uplink !== null) {
        pump = (async function () {
          try {
            var iterator = uplink[Symbol.asyncIterator]();
            for (;;) {
              var step = await iterator.next();
              if (uplinkStopped) return;
              if (step.done === true) break;
              await invoke('cmd_stream_send', { id: id, value: step.value });
            }
            if (!uplinkStopped) await invoke('cmd_stream_end', { id: id });
          } catch (error) {
            /* 上行失败即失败下行（与 worker 隧道同则） */
            failed = failed === null ? error : failed;
            terminal = true;
            notify();
          }
        })();
      }
      try {
        for (;;) {
          await take();
          while (queue.length > 0) {
            yield queue.shift();
            if (terminal && failed === null && queue.length === 0) return;
          }
          if (failed !== null) throw failed;
          if (terminal) return;
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        uplinkStopped = true;
        if (id !== null) delete openIds[id]; /* F4：离开未完成集（终态或已取消） */
        /* 未达终态而退出（消费方提前 return / 抛错）→ 取消宿主侧流 */
        if (!terminal) {
          try { invoke('cmd_stream_cancel', { id: id }); } catch (error) { /* 尽力而为 */ }
        }
        if (pump !== null) { await pump.catch(function () { /* 上行收尾失败不影响下行终态 */ }); }
      }
    }

    globalThis.__WORLDSEA_STREAM__ = {
      version: 1,
      openStream: function (endpoint, payload, signal, uplink) { return run(endpoint, payload, signal, uplink); }
    };
  } catch (error) { /* 流桥自身失败不得影响页面；transport 行会读不到 openStream，客户端据此降级 */ }
})()
