# 出网收口（`apps/tauri/src-tauri/src/net_egress.rs`）

> 对应代码：`net_egress.rs` + `net_egress_tests.rs`
> 批次：档 3-a（2026-09-22，W3 能力面整顿 · [计划](../../../plans/已完成/2026-09-22-W3档3-抓取能力与出网收口.md)）

## 一、为什么要这一层

档 1 取证时发现：全仓**没有任何出网治理**。出网点各写各的（`search_commands.rs` ureq ×4 Provider、`crates/vendor/memory-center-llm` reqwest、`genai_backend.rs` LLM 主链、`skills_store.rs` 下载 zip、`whisper.rs`、`mcp_client.rs`），无共享 client / UA / 代理层，`is_loopback` / scheme 白名单等关键字全库零命中。

这些点有个共同特征：**目标 URL 是代码写死或来自用户显式配置的服务端点**，风险由用户自己承担。而抓取类工具（`web_fetch`）不同——**URL 来自模型（即来自被抓取网页本身的内容）**，等于把「让程序访问任意地址」的开关交给了外部文本。这正是 SSRF 的标准入口，所以必须在**第一个接受外部 URL 的工具上线之前**把这层建起来，而不是事后补。

## 二、判定口径

### 解析（`parse_http_url`）

零依赖手写（仓库无 `url` / `ipnet`，引第三方 HTML/URL crate 需过治理且这类 crate 质参差）。要点：

| 规则 | 取法 | 为什么 |
|---|---|---|
| 方案 | 仅 `http` / `https`，**无 `://` 一律拒，不补默认方案** | 「猜测式补全」会把 `file:`、裸路径喂进解析器 |
| 凭据 | authority 含 `@` 直接拒 | 防 `http://host@evil/` 形态的主机混淆 |
| 主机名字符集 | 字母数字 + `-_.:`，**含 `%` 即拒** | 百分号可编码 `.`，用来绕过分隔符判断 |
| 片段 | 丢弃（服务端不可见） | 保留只会让缓存键分裂 |
| 根点 | 剥除尾部 `.` | 否则 `example.com` 与 `example.com.` 成两个缓存键 |
| 端口 | 只判合法数值 `1..=65535`，缺省按方案默认 | 「拦常见服务端口」是黑名单思路，漏得多且误伤正当站点 |
| `http://` | **允许但不自动升级 https**，结果带 `insecure: true` | 强制升级（ZCode 口径）会让 http-only 站点直接不可达；改用可见标注 |

### 可达性（`assert_public_target`）

- **IP 字面量**：IPv4 拦 `unspecified / loopback / private / link_local / multicast / broadcast` + `0/8` + `100.64/10`（CGNAT）+ `240/4`；IPv6 拦 `::1 / :: / fc00::/7 / fe80::/10 / ff00::/8`，并对 **`::ffff:` IPv4-mapped、`2002::/16` 6to4、`64:ff9b::/96` DNS64** 三种「把 v4 塞在 v6 里」的形态**还原后复校**。
- **主机名**：`localhost`、`.localhost` / `.local` / `.internal` / `.localdomain` / `.home.arpa` 结尾，以及**无点的裸主机名**（会经 search domain 补全落到内网，本机名也属这类）。

## 三、明确取舍（都写进源码注释）

1. **不做 DNS preflight**。ZCode 一度做了又撤，理由相同：部分网络 1s 内解不完 DNS，会让普通公网 URL 在真实请求前就失败。代价是 **DNS 重绑定（域名解析到内网）拦不住**——这是本层当前最大的已知缺口。
2. **不做站点黑白名单**。本层只回答「能不能碰」，不回答「该不该碰」；域名维度的放行属权限系统（现有 `permission_rules.rs` 只有 command / path 两维，无 host 维），另批裁定。
3. **`Teredo`（`2001::/32`）未做 v4 还原**。该形态内嵌 IPv4 是取反存储，家用网络抓取场景几乎不出现，复杂度不值。
4. **拒绝理由可给用户看**：消息里只带用户自己写下的主机名/字面量，不含任何额外解析结果（避免把探测结果泄给被污染上下文）。

## 四、复校契约（给 3-b 的硬约束）

**每一跳重定向的目标都必须重新过一次 `guard_url`**。`guard_is_idempotent_for_redirect_recheck` 钉住了前提：对同一 URL 复校结果稳定（`to_url()` 再解析回来等价）。

这一步不能省：只校首跳等于把拦截交给站方——`https://public.example/302 → http://169.254.169.254/` 是最经典的 SSRF 跳转链。因此重定向策略是 `manual` + 逐跳复校，而不是交给 HTTP 客户端自动跟随。

## 五、反证记录（2026-09-22，输出留档 `.workbuddy/_inj/`）

| 注入 | 结果 |
|---|---|
| 摘掉 `ipv4_is_public` 私网判定 | `guard_blocks_all_local_and_private_targets` · `blocked_reason_names_the_host_not_internals` · `embedded_ipv4_unwraps_6to4_and_dns64` 三例红（`05_egress变异红.txt`） |
| 摘掉凭据（`@`）校验 | **首版用例仍绿**——`https://user:pw@example.com/` 会因「端口非法：pw@example.com」顺带被拒，只断言错误类别看不出退化（同轮 `05` 里即为假绿） |
| 收紧为**理由级**断言后重注同一变异 | 红，且诊断直指「拒绝理由应含『凭据』，实为『端口非法』」（`06_凭据校验摘除红.txt`） |

**教训**：对「多条规则都能拒同一输入」的校验面，类别级断言不够，须断言**拒绝理由**；否则规则退化会被其他规则掩盖成通过。
