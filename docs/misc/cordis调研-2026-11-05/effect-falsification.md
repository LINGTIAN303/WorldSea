# 证伪报告：产品域 cordis `ctx.effect` 是否「不保证 disposal 触发」

> 任务：用户拍板的第①项——先证伪 `registry.ts:22` 的判断，因为它决定后面所有路线的成本。
> 方法：**真跑**，不是读代码。测试 harness 使用与 `apps/tauri/src/world/vendor/cordis/lib/index.js` **字节一致**的产物（SHA256 `627409AFA...31FE8F`，= cordis 4.1.0）。
> 时间：2026-11-05

---

## 一、结论

**`registry.ts:22` 的判断是错的。**

```
/ ** 插件清理函数登记表（拆树时逐个执行；cordis `effect` 在本版本不保证 disposal 触发，故自持）。 * /
```

`ctx.effect` 在这个版本**完全正常**：disposer 会触发、LIFO 顺序正确、异步会被 await、注册式 API 能自动回卷、`provide` 会自动撤销、`inject` 门控正常、provider 生灭能驱动 consumer 启停。

**但它是一个「基于旧版本的过时判断」**，不是凭空臆断——见 §四的版本考古。

---

## 二、六项基础能力实测（全部 PASS）

| # | 测试 | 结果 |
|---|---|---|
| T1 | 父插件卸载 → `ctx.effect` disposer 触发 | ✅ PASS |
| T2 | 多个 disposer 的 LIFO 顺序 | ✅ PASS（注册 A,B,C → 回卷 C,B,A） |
| T3 | 异步 disposer 是否被 `await` | ✅ PASS（`dispose()` resolve 时已完成） |
| T4 | 注册式 API（dsh 模式：`register` 返回 disposer，`ctx.effect` 收走） | ✅ PASS（卸载后 registry 清空） |
| T5 | `inject` 依赖未满足 → 停留 PENDING | ✅ PASS（`applied=false`） |
| T6 | provider 出现 → consumer 自动激活；provider 消失 → consumer 自动停用+回卷 | ✅ PASS |

T6 尤其重要——这是论文所谓的「空间轴」（reactive coeffect）在**产品域现有 vendor 上就能跑通**。

---

## 三、失败模式探查（找出「为什么他们会这么认为」）

跑了 6 个真实世界的坑，只有 **1 个** 是真失败：

| 场景 | 结果 | 说明 |
|---|---|---|
| A `void fiber.dispose()` + 同步 apply | ⚠️ 最终会触发，但不同步 | 不是 bug，是异步语义 |
| B 卸载后在旧 ctx 上 `effect` | ✅ 抛 `INACTIVE_EFFECT` | 有明确报错，不是静默失败 |
| C `async apply` 中 `await` 之后才 `effect` | ✅ 正常 | |
| **D `dispose()` 早于 `apply` 的 `await` 完成** | ❌ **effect 变孤儿，永不触发** | **唯一的真坑** |
| E 父 dispose → 子插件 effect | ✅ 递归触发 | |
| F 装/卸 3 轮循环 | ✅ 零泄漏 | |

### D 的精确条件

```
apply 是 async 且有 await
  ↓
dispose() 在 apply settled 之前被调用
  ↓
apply 后续注册的 effect 落在已退役的 runner 上 → 孤儿
```

### 修复写法（已验证 4 种，3 种可行）

| 方案 | 实测 |
|---|---|
| ① `await fiber` 再 `await fiber.dispose()` | ✅ PASS（`fiber` 是 thenable，await 它即等 settled） |
| ② `apply` 内**先注册 effect 再做慢初始化** | ✅ PASS（注册前置，最稳） |
| ③ `ctx.effect(async function*(){ ...; yield disposer })` | ✅ PASS（iterator 形式天然正确） |
| ④ 只 `await fiber.dispose()` | ❌ FAIL（`dispose()` 不等待未注册的 effect） |

---

## 四、版本考古：为什么这条注释在写的时候可能是对的

| 证据 | 内容 |
|---|---|
| `git log` | `c5ad81f`（2026-09-25，B 批）初次 vendor **4.0.4** |
| `git log` | `75973cc`（2026-11-05，f7）升级为 **4.1.0** |
| `vendor/README.md:6` | 仍写「`@deepseek-ai/cordis@4.0.4`」——**文档未同步** |
| `lib/index.js.4.0.5.bak` | 保留了 4.0.5 的备份（2026-09-25） |
| 字节对比 | 产品域 `lib/index.js` ≡ `dsh/vendor/cordis/lib/index.js`（SHA256 完全一致） |

也就是说：
1. `registry.ts:22` 写于 **2026-09-25**，当时用的是 4.0.4；
2. 2026-11-05 已升级到 4.1.0，但**那句注释没人改**；
3. `vendor/README.md` 的版本号也没跟着改。

**所以这不是"cordis 不行"，而是"注释停留在了旧版本"。** 4.1.0 里 `effect()` 的实现（`lib/index.js:463-560`）是完整正确的。

---

## 五、对本项目的实际影响

### 好消息

1. **第一次跃迁（时间轴）的成本大幅下降**——不是"换内核"，而是"改用法 + 删掉手写 cleanup 层"。
2. `T4` 证明 dsh 那种「`register` 返回 disposer、`ctx.effect` 收走」的模式**在现有 vendor 上直接可用**。
3. `T6` 证明**空间轴也能跑**，前提是先有服务被 provide 出来。

### 需要注意

产品域 42 个插件**全部是同步 apply**（实测 0 个 async apply），所以当前**没有踩 D 坑**。但一旦引入「异步初始化」（从文件/网络加载数据再注册视图），就会触发。这是**未来的雷**，不是现在的病。

### 那句话该怎么改

```
/** 插件清理函数登记表（拆树时逐个执行）。
 *  cordis 4.1.0 的 ctx.effect 本身可靠（disposal 会触发、LIFO、异步 await 均实测通过）；
 *  此处自持的原因是迁移期兼容——插件仍在用 activate 式手写清理，
 *  待迁移到「注册返回 disposer + ctx.effect 收走」后本表可退役。
 *  注意：若插件 apply 变 async，必须 await fiber 后再 dispose，否则 effect 会变孤儿。 */
```

---

## 六、复现方式

```powershell
cd D:\WorldSea\.devtmp\cordis-audit\effect-test
$env:NODE_PATH = "$PWD\node_modules"
node test.mjs    # 六项基础能力
node test2.mjs   # 失败模式探查
node test3.mjs   # 根因定位 + 修复方案
node test4.mjs   # fiber await 语义
node test5.mjs   # 用 tree.ts 精确写法复现
```

harness 里的 cordis 是从产品域 vendor 直接复制的，SHA256 与 `dsh/vendor/cordis/lib/index.js` 一致。
