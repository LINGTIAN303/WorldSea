/* worldsea-shell:sse —— 页面的 SSE 订阅钩子（替代 EventSource）。

   为什么需要它：壳的 worldsea:// 自定义协议应答是**一次性缓冲体**
   （`UriSchemeResponder::respond` 只收 `Into<Cow<'static,[u8]>>`，无流式写回通道），
   而 `text/event-stream` 要求边收边吐——故 SSE 改走 Tauri 命令 + 管道流 lane。
   宿主侧靠端点前缀 `sse:` 把该流交给 `readSseResponse`（合成 req/res → dispatch →
   按空行分帧、只取 `data:` 行回推），不走 Gateway 通道。

   注入位置与 stream bridge 同点（index 的 `<head>` 之后、transport 行之前）；
   transport 行从中取 `sse` / `fetch` 装进 `__DSH_TRANSPORT__`（只合并不覆盖）。

   两个对接面（同一底层通道）：

   1. `sse(path, signal) → AsyncIterable<string>` —— 每项是一条 SSE 事件的 `data:` 载荷。
      给「自己解析 JSON」的消费方用。
   2. `fetch(input, init) → Promise<Response>` —— **fetch 兼容形态**，只服务 SSE 路由。
      `response.body` 是**原始 SSE 文本的字节流**（含 `data:` 前缀与空行），
      使 `response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())`
      这类标准管线可直接消费。client-hmr 优先走这条。

   本层不做重连：重连语义由消费方决定（client-hmr 有自己的错误处理）。
   消费方提前退出或 signal abort → 通知壳取消，不泄漏。 */
(function () {
  try {
    /* 幂等：重复注入是 no-op */
    if (globalThis.__WORLDSEA_SSE__ !== undefined) return;
    var invoke = function (command, args) {
      var ipc = globalThis.__TAURI_INTERNALS__;
      if (ipc === undefined || typeof ipc.invoke !== 'function') {
        return Promise.reject(new Error('worldsea sse: tauri ipc unavailable'));
      }
      return ipc.invoke(command, args);
    };

    /* 本页未完成订阅登记——文档卸载（pagehide）时批量取消。
       与 stream bridge 同因：页重载后旧页的 SSE 无人取消会让壳持续向失效 callback 投递。
       窗口隐藏/最小化不触发 pagehide，故不误伤前台长连。 */
    var openIds = {};
    addEventListener('pagehide', function () {
      for (var key in openIds) {
        try { invoke('cmd_sse_close', { id: Number(key) }); } catch (error) { /* 尽力而为 */ }
      }
    });

    /* 最小 Channel：与 @tauri-apps/api 的 Channel 同形（toJSON → `__CHANNEL__:<id>`）。 */
    function makeChannel(onMessage) {
      var ipc = globalThis.__TAURI_INTERNALS__;
      var id = ipc.transformCallback(function (event) {
        if (event && event.end === true) return;
        onMessage(event.message);
      }, false);
      return { toJSON: function () { return '__CHANNEL__:' + id; } };
    }

    /* 一条订阅：异步生成器（首次 next 才真正开流，与 openStream 契约一致）。 */
    async function* run(path, signal) {
      if (signal && signal.aborted === true) {
        throw signal.reason instanceof Error ? signal.reason : new Error('worldsea sse: aborted');
      }
      var queue = [];
      var terminal = false;
      var failed = null;
      var wake = null;
      var id = null;
      function notify() { var w = wake; wake = null; if (w) w(); }
      function take() {
        return new Promise(function (resolve) {
          if (queue.length > 0 || terminal || failed !== null) { resolve(); return; }
          wake = resolve;
        });
      }
      var channel = makeChannel(function (message) {
        if (!message) return;
        if (message.type === 'item') { queue.push(String(message.value)); notify(); return; }
        if (message.type === 'error') {
          var failure = message.failure || {};
          failed = new Error(failure.message ? String(failure.message) : 'worldsea sse: 流失败');
          failed.dshSseFailure = { kind: String(failure.kind || 'carrier'), code: failure.code === undefined ? '' : String(failure.code) };
          terminal = true;
          notify();
          return;
        }
        terminal = true;
        notify();
      });
      try {
        id = await invoke('cmd_sse_open', { path: String(path), channel: channel });
      } catch (error) {
        var openError = new Error('worldsea sse: 打开失败（' + String(error && error.message ? error.message : error) + '）');
        openError.dshSseFailure = { kind: 'carrier', code: '' };
        throw openError;
      }
      openIds[id] = true;
      var onAbort = function () {
        try { invoke('cmd_sse_close', { id: id }); } catch (error) { /* 取消尽力而为 */ }
        failed = signal.reason instanceof Error ? signal.reason : new Error('worldsea sse: aborted');
        terminal = true;
        notify();
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
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
        if (id !== null) delete openIds[id];
        /* 未达终态而退出（消费方提前 return / 抛错）→ 取消宿主侧流 */
        if (!terminal) {
          try { invoke('cmd_sse_close', { id: id }); } catch (error) { /* 尽力而为 */ }
        }
      }
    }

    /* fetch 兼容形态：**只接管 SSE 请求，其余一律交回原生 fetch**。

       为什么必须分流：`__DSH_TRANSPORT__.fetch` 在 dsh 客户端里的类型是 `RpcFetch`
       （见 client/connection 的 `ClientTransportHooks.fetch`），它是**所有一元 RPC 的
       通用请求钩子**——网关方法调用、插件清单、预设列表、市场状态全走它。
       若本函数无条件接管，那些请求会被当成 SSE 去开流，页面立刻大面积 `Failed to fetch`。
       （这正是一次真实回归：无条件接管导致模型/插件/预设/市场全部加载失败。）

       判定依据是请求头 `accept` 含 `text/event-stream`——SSE 的语义标志，
       也是 client-hmr 显式传的（`headers: { accept: 'text/event-stream' }`）。
       其余请求原样转给原生 fetch，行为与未注入本桥时完全一致。

       命中 SSE 时：`response.body` 产**原始 SSE 文本**（把每条 data 载荷重新包成
       `data: <载荷>\n\n`），使 `TextDecoderStream → EventSourceParserStream`
       这条标准管线可直接消费。 */
    function sseFetch(input, init) {
      var headers = (init && init.headers) || {};
      var accept = '';
      /* Headers 实例用 get()；普通对象按 key 找（大小写不敏感） */
      if (headers && typeof headers.get === 'function') {
        accept = String(headers.get('accept') || '');
      } else {
        for (var key in headers) {
          if (String(key).toLowerCase() === 'accept') { accept = String(headers[key] || ''); break; }
        }
      }
      if (accept.indexOf('text/event-stream') < 0) {
        /* 非 SSE：交回页面原生 fetch（不是本桥的职责面） */
        return globalThis.fetch(input, init);
      }

      var url = typeof input === 'string' ? input : (input && input.url ? String(input.url) : '');
      var signal = (init && init.signal) || (input && input.signal) || undefined;
      /* 归一为站内相对路径：HMR 传的是 'plugins/events'（无前导斜杠），壳命令要求 '/...' */
      var path = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '');
      if (path.charAt(0) !== '/') path = '/' + path;
      var body = new ReadableStream({
        async start(controller) {
          try {
            for await (var payload of run(path, signal)) {
              controller.enqueue(new TextEncoder().encode('data: ' + payload + '\n\n'));
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        }
      });
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      }));
    }

    globalThis.__WORLDSEA_SSE__ = {
      version: 1,
      sse: function (path, signal) { return run(path, signal); },
      fetch: sseFetch
    };
  } catch (error) { /* 桥自身失败不得影响页面；transport 行会读不到 sse，客户端据此降级 */ }
})()
