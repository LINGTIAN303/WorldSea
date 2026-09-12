//! 记忆侧语义检索评测（A2-1 基线 · 需真实 embedding 端点）
//!
//! 文件侧已有评测集（`crates/agent-index/tests/eval_retrieval.rs`）；**记忆侧此前只有
//! 假 Embedder 的单元测试**——真实 embedding 下的召回质量、以及去重阈值 0.92 的标定，
//! 都还没有基线。本测试补这两项，作为记忆侧语义检索的成熟度证据：
//!
//! 1. **召回**：BM25-only vs 混合（BM25 ∪ 向量 → RRF）的 hit@1 / hit@3。
//! 2. **去重阈值校验**：`find_duplicate` 走 embedding 余弦，阈值 = 生产常量
//!    `COSINE_DEDUP_THRESHOLD_DEFAULT`（**2026-09-12 由本评测标定为 0.75**；上一版 0.92
//!    是从「字符二元组 Jaccard」继承的数值，实测使真重复 100% 漏判）。
//!    本测试把标定结果**变成回归断言**：同义改写须全部达阈、同主题新事实与无关须全部不达阈。
//!
//! 运行（默认 `#[ignore]`，端点与 Key 从环境变量读）：
//!
//! ```text
//! SILICONFLOW_API_KEY=sk-xxx cargo test --offline --test eval_semantic -- --ignored --nocapture
//! ```
//!
//! 语料为内置 fixture，模拟 `index_text_of` 的**摘要口径**（标题 | 摘要 | 关键事实）——
//! 与生产索引对象同构；可替换为真实记忆库导出的摘要文本。

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use agent_memory::semantic::{SemanticConfig, SemanticStack};
use memory_center_core::bm25::Bm25Searcher;
use memory_center_core::semantic::{KeywordSearcher, SearchHit};

/// fixture 语料：`(hook_id, memory_id, 摘要口径文本)`——与 `index_text_of` 同构
const CORPUS: &[(&str, &str, &str)] = &[
    (
        "h01",
        "m-考据-星海地理",
        "星海地理 | 星海由星域组成，星域之间以星门相连；星门是上古文明留下的空间通道 \
         | 开启星门消耗大量灵能；潮汐周期会增强或削弱星门稳定性；平潮期穿越最安全；\
         星域内部航运依赖跃迁引擎，但跨不过裂隙地带",
    ),
    (
        "h02",
        "m-考据-古文明遗迹",
        "上古文明遗迹 | 上古文明在星海各处留下遗迹，核心埋有机关阵列，以灵能驱动 \
         | 最著名的是沉钟环，机关会在午夜自行校准星轨；考古公会严禁私自开启遗迹核心；\
         机关失控会引发灵能风暴",
    ),
    (
        "h03",
        "m-设定-灵能体系",
        "灵能修炼体系 | 灵能修炼分九级，从凝息到化神，每三级设一道瓶颈 \
         | 灵能储量决定上限，灵能密度决定发力速度；高阶修行者可外放灵能护体并在真空短暂生存；\
         灵能枯竭会导致昏厥，严重时不可逆转",
    ),
    (
        "h04",
        "m-设定-势力-苍穹会",
        "苍穹会 | 以维护星门秩序为宗旨，总部设在悬空城；会长由长老会推举，任期十二年 \
         | 与自由商会长期争夺星门通行权，双方在第三星域多次冲突；会内设巡天司，\
         负责缉查私自穿越星门的行为",
    ),
    (
        "h05",
        "m-设定-主角-林渡",
        "主角林渡 | 出身矿星，少年时在废弃矿洞捡到一枚残缺的星图碎片，\
         碎片激活了他体内沉睡的灵能，使他在没有师承的情况下踏入凝息境 \
         | 为寻找碎片来历加入远航船队，途中结识巡天司女官；性格固执，认定的事从不回头",
    ),
    (
        "h06",
        "m-剧情-第一卷大纲",
        "第一卷大纲 | 围绕星图碎片展开：林渡在矿星觉醒灵能被巡天司注意，\
         随后卷入苍穹会与自由商会的星门冲突 \
         | 卷末他穿越沉钟环遗迹，发现碎片与上古文明的血脉封印有关，为第二卷的裂隙地带埋下伏笔",
    ),
    (
        "h07",
        "m-笔记-命名规范",
        "命名规范 | 星域名使用双字组合，星门以起止星域命名，人物名用单姓单名，\
         势力名统一以「会 / 盟 / 司」结尾 \
         | 所有专有名词首次出现时须在名词表登记，避免同物异名",
    ),
    (
        "h08",
        "m-设定-自由商会",
        "自由商会 | 以星门通行牟利的商业联合体，与苍穹会长期对抗 \
         | 掌握多条非官方航线；在第三星域设有中转站；成员多为私营船队",
    ),
    (
        "h09",
        "m-考据-跃迁引擎",
        "跃迁引擎技术 | 实现星域内部的快速位移，出力依赖灵能密度 \
         | 无法跨越星门之间的裂隙地带；引擎过载会引燃灵能回路",
    ),
    (
        "h10",
        "m-剧情-第二卷草案",
        "第二卷草案 | 林渡与巡天司女官深入裂隙地带，追查血脉封印的来历 \
         | 苍穹会内部出现分裂，自由商会趁虚而入",
    ),
    (
        "h11",
        "m-设定-考古公会",
        "考古公会 | 负责遗迹登记与保护，独立于苍穹会 \
         | 严禁私自开启遗迹核心；违规者列入黑名单并追缴法器",
    ),
    (
        "h12",
        "m-笔记-时间线",
        "时间线 | 第一卷跨三个月，第二卷紧接其后 \
         | 星门平潮期每四十天一次，是船队集中通行的窗口",
    ),
];

/// 改述型召回查询（与原文少字面重叠）：`(query, 期望 hook_id)`
const RECALL_QUERIES: &[(&str, &str)] = &[
    ("星域之间靠什么往来", "h01"),
    ("什么周期通过最稳妥", "h01"),
    ("哪些古老造物不能随便动", "h02"),
    ("修炼会碰到什么关口", "h03"),
    ("谁在维持通道的秩序", "h04"),
    ("主角是怎么变强的", "h05"),
    ("第一本书讲了什么故事", "h06"),
    ("专有名词该怎么起名与登记", "h07"),
    ("哪个组织靠航线赚钱", "h08"),
    ("公会管什么事", "h11"),
];

/// 去重探针 A：**同义改写**（语义上确属重复，理想情况应 ≥ 阈值被拦下）
const DEDUP_SAME: &[&str] = &[
    "星域与星域之间由星门连通，星门是上古文明的空间通道，开启要动用大量灵能",
    "灵能修为共分九阶，每三阶有一道关卡；储量定上限，密度定出手快慢",
    "苍穹会总部在悬空城，会长由长老会选出、任十二年",
    "命名规则：星域名用两个字，势力名以会盟司结尾，新词要进名词表",
    "自由商会靠星门通行获利，与苍穹会长期对抗",
    "考古公会负责遗迹登记与保护，不许私自开启核心",
];

/// 去重探针 B：**不相关新事实**（语义上与全部记忆无关，应显著低于阈值）
const DEDUP_DIFF: &[&str] = &[
    "今天的晚餐是番茄鸡蛋面",
    "本季度销售额同比增长百分之十二",
    "明天上午十点在三楼会议室开评审会",
    "这台服务器的处理器占用率一直保持在百分之八十五",
    "天气预报说周末有中到大雨并伴有雷电",
    "图书馆新到了一批关于植物的画册",
];

/// 从环境变量组装真实端点配置（与文件侧评测同一命名，便于共用同一把 Key）
fn config_from_env() -> SemanticConfig {
    let api_key = std::env::var("SILICONFLOW_API_KEY")
        .or_else(|_| std::env::var("WORLDSEA_EMBEDDING_API_KEY"))
        .expect("需设置 SILICONFLOW_API_KEY（或 WORLDSEA_EMBEDDING_API_KEY）");
    SemanticConfig {
        api_url: std::env::var("WORLDSEA_EMBEDDING_API_URL")
            .unwrap_or_else(|_| "https://api.siliconflow.cn/v1/embeddings".into()),
        api_key,
        model: std::env::var("WORLDSEA_EMBEDDING_MODEL")
            .unwrap_or_else(|_| "BAAI/bge-m3".into()),
        dim: 1024,
        timeout_secs: 30,
    }
}

/// 前 k 条内是否命中期望 hook
fn hit_at(hits: &[SearchHit], expect: &str, k: usize) -> bool {
    hits.iter().take(k).any(|h| h.hook_id == expect)
}

/// 中位数（空集返回 NaN）
fn median(mut xs: Vec<f32>) -> f32 {
    if xs.is_empty() {
        return f32::NAN;
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = xs.len();
    if n % 2 == 1 {
        xs[n / 2]
    } else {
        (xs[n / 2 - 1] + xs[n / 2]) / 2.0
    }
}

/// 去重探针 C：**同主题新事实**（语义相关但与任何已存记忆**不是同一事实**）
///
/// **这一类是阈值的关键约束**：只测「同义」与「完全无关」会得出很宽的可分带，
/// 但真实误判风险恰恰来自「聊同一个设定、说的是另一件事」——阈值若低于这簇的上界，
/// 就会把不同的记忆错误合并。
const DEDUP_RELATED: &[&str] = &[
    "船队编制里设有专门的潮汐观测员",
    "高阶修行者之间可以互相传功",
    "星图碎片一共有七枚",
    "苍穹会的会长制度曾因内战中断过一次",
    "遗迹核心的法器在黑市上私下流通",
    "命名规范每两年修订一次",
];

/// 批量做去重探针，返回 `(最近 hook, 余弦)` —— **与传入的 probes 按序一一对应**
async fn probe_all(
    stack: &SemanticStack,
    allow: &HashSet<String>,
    probes: &[&str],
) -> Vec<(String, f32)> {
    let mut out: Vec<(String, f32)> = Vec::new();
    for &p in probes {
        match stack.find_similar(p, 5, allow).await {
            Some((hook, cos)) => out.push((hook, cos)),
            None => println!("  向量化失败（跳过）：{p}"),
        }
    }
    out
}

async fn build_stack(dir: &Path, cfg: &SemanticConfig) -> Arc<SemanticStack> {
    let stack = SemanticStack::build(dir.join("memory_vec.db"), cfg.clone()).unwrap();
    let docs: Vec<(String, String, String)> = CORPUS
        .iter()
        .map(|(h, m, t)| (h.to_string(), m.to_string(), t.to_string()))
        .collect();
    let stats = stack.rebuild(&docs).await;
    println!(
        "[记忆语义评测] 索引状态: 关键词 {} 条 · 向量 {} 条 · 维度 {}",
        stats.keyword_len, stats.vector_len, stats.dim
    );
    println!("[记忆语义评测] 语料 {} 条（摘要口径）", CORPUS.len());
    assert_eq!(
        stats.vector_len,
        CORPUS.len(),
        "向量未补齐（{} / {}）——检查端点与 Key",
        stats.vector_len,
        CORPUS.len()
    );
    stack
}

/// 记忆侧语义基线（报告制 + 关键契约断言；需真实端点，默认忽略）
#[tokio::test]
#[ignore = "需要真实 embedding 端点：SILICONFLOW_API_KEY=sk-xxx cargo test --test eval_semantic -- --ignored --nocapture"]
async fn memory_semantic_baseline_report() {
    let cfg = config_from_env();
    let dir = tempfile::tempdir().unwrap();
    let stack = build_stack(dir.path(), &cfg).await;

    let allow: HashSet<String> = CORPUS.iter().map(|(h, _, _)| h.to_string()).collect();

    // ── 1. 召回：BM25-only 对照 vs 混合 ──────────────────────────────
    let keyword_only = Bm25Searcher::new();
    for (h, m, t) in CORPUS {
        keyword_only.index(h, m, t);
    }

    let (mut kw1, mut kw3, mut hy1, mut hy3) = (0usize, 0usize, 0usize, 0usize);
    for (q, expect) in RECALL_QUERIES {
        let kw = keyword_only.search(q, 3);
        let hy = stack.search(q, 3, &allow).await;
        let (k1, k3) = (hit_at(&kw, expect, 1), hit_at(&kw, expect, 3));
        let (h1, h3) = (hit_at(&hy, expect, 1), hit_at(&hy, expect, 3));
        kw1 += k1 as usize;
        kw3 += k3 as usize;
        hy1 += h1 as usize;
        hy3 += h3 as usize;
        println!(
            "  {q} → {expect} | 关键词: top1={} top3={} | 混合: top1={} top3={}",
            if k1 { "命中" } else { "未中" },
            if k3 { "命中" } else { "未中" },
            if h1 { "命中" } else { "未中" },
            if h3 { "命中" } else { "未中" },
        );
    }
    let n = RECALL_QUERIES.len();
    println!(
        "[记忆语义评测] 改述召回 —— 关键词基线 top1 {kw1}/{n} top3 {kw3}/{n} \
         vs 混合检索 top1 {hy1}/{n} top3 {hy3}/{n}"
    );
    // 契约：混合通道不得弱于关键词（RRF 任一路失败即降级，不应产生回退损失）
    assert!(
        hy3 >= kw3,
        "混合检索 top3 不应弱于关键词基线（{hy3} < {kw3}）——检查向量通道是否补齐或融合是否被改坏"
    );

    // ── 2. 去重阈值校验（阈值取**生产常量**，不是测试内自定值）──────────
    // 三类探针缺一不可：
    //   A 同义改写     —— 应判**重复**：须**全部**达阈（否则漏判真重复）
    //   B 同主题新事实 —— 应判**不重复**：须**全部**不达阈（真正的约束）
    //   C 完全无关     —— 应判不重复：须全部不达阈
    // 只测 A/C 会高估可分性（两簇之间天然有大空隙），真实误判风险来自 B。
    const DEDUP_THRESHOLD: f32 = agent_runtime::memory::COSINE_DEDUP_THRESHOLD_DEFAULT;
    let same = probe_all(&stack, &allow, DEDUP_SAME).await;
    let related = probe_all(&stack, &allow, DEDUP_RELATED).await;
    let diff = probe_all(&stack, &allow, DEDUP_DIFF).await;

    println!("[记忆语义评测] 去重标定（当前阈值 {DEDUP_THRESHOLD}）");
    let print_class = |name: &str, probes: &[&str], got: &[(String, f32)]| {
        println!("  ── {name}");
        for (i, (hook, cos)) in got.iter().enumerate() {
            println!("    {cos:.4}  最近={hook}  ← {}", probes[i]);
        }
    };
    print_class("同义改写（应判重复）", DEDUP_SAME, &same);
    print_class("同主题新事实（应判不重复）", DEDUP_RELATED, &related);
    print_class("完全无关（应判不重复）", DEDUP_DIFF, &diff);

    let cos_of = |v: &[(String, f32)]| -> Vec<f32> { v.iter().map(|(_, c)| *c).collect() };
    let (same_cos, rel_cos, diff_cos) = (cos_of(&same), cos_of(&related), cos_of(&diff));
    let min_of = |v: &[f32]| v.iter().cloned().fold(f32::INFINITY, f32::min);
    let max_of = |v: &[f32]| v.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let (same_min, rel_max, diff_max) = (min_of(&same_cos), max_of(&rel_cos), max_of(&diff_cos));
    let ge = |v: &[f32]| v.iter().filter(|c| **c >= DEDUP_THRESHOLD).count();

    println!(
        "[记忆语义评测] 同义改写     min {same_min:.4} / 中位 {:.4} / ≥阈值 {}/{}",
        median(same_cos.clone()),
        ge(&same_cos),
        DEDUP_SAME.len()
    );
    println!(
        "[记忆语义评测] 同主题新事实 max {rel_max:.4} / 中位 {:.4} / ≥阈值 {}/{}",
        median(rel_cos.clone()),
        ge(&rel_cos),
        DEDUP_RELATED.len()
    );
    println!(
        "[记忆语义评测] 完全无关     max {diff_max:.4} / 中位 {:.4} / ≥阈值 {}/{}",
        median(diff_cos.clone()),
        ge(&diff_cos),
        DEDUP_DIFF.len()
    );
    println!(
        "[记忆语义评测] 真实可分带：同义下界 {same_min:.4} vs 同主题上界 {rel_max:.4} → 余量 {:.4}",
        same_min - rel_max
    );
    println!(
        "[记忆语义评测] 当前阈值 {DEDUP_THRESHOLD} 的判读：{}",
        if same_min >= DEDUP_THRESHOLD {
            "位于同义簇之内（不漏判）"
        } else {
            "**高于**同义簇下界 → 真重复会被判为不重复（阈值偏高）"
        }
    );
    if same_min > rel_max {
        println!(
            "[记忆语义评测] 单阈值可分的区间为 ({rel_max:.4}, {same_min:.4}) —— 取靠下界、留安全余量的一侧"
        );
    } else {
        println!(
            "[记忆语义评测] ⚠ 单阈值**不可分**：同义下界 ≤ 同主题上界 → 仅靠余弦阈值无法同时\
             做到「不漏判」与「不误并」，需要更强的判别信号（实体/关键词重叠、重排模型）"
        );
    }

    // 契约一：同义改写必须整体位于「完全不相关」之上——这是语义通道可用的底线
    assert!(
        same_min > diff_max,
        "同义改写与完全不相关事实的余弦分布重叠（同义最小 {same_min:.4} ≤ 无关最大 {diff_max:.4}）\
         ——语义通道无法支撑任何阈值判定"
    );
    // 契约二：同义改写必须整体位于「同主题新事实」之上——单阈值去重的可行性前提。
    // 若此断言失败，说明**阈值本身不是可调参数**，去重设计需要换判别方式（见上面的打印结论）。
    assert!(
        same_min > rel_max,
        "同义改写（最小 {same_min:.4}）未整体高于同主题新事实（最大 {rel_max:.4}）\
         ——单阈值去重不可行，需改判别方式而非调阈值"
    );
    // 契约三（**阈值回归**）：当前生产阈值必须同时满足「不漏判」与「不误并」。
    // 这三条是标定结果的守卫：任何一侧被破坏，都说明阈值（或向量模型）需要重标定。
    assert_eq!(
        ge(&same_cos),
        DEDUP_SAME.len(),
        "同义改写应**全部**达到去重阈值 {DEDUP_THRESHOLD}（否则写前去重漏判真重复；\
         实际未达 {}/{}，最小 {same_min:.4}）",
        DEDUP_SAME.len() - ge(&same_cos),
        DEDUP_SAME.len()
    );
    assert_eq!(
        ge(&rel_cos),
        0,
        "同主题新事实**不应**达到去重阈值 {DEDUP_THRESHOLD}（否则会把不同事实误并为重复；\
         实际越界 {}/{}，最大 {rel_max:.4}）",
        ge(&rel_cos),
        DEDUP_RELATED.len()
    );
    assert_eq!(
        ge(&diff_cos),
        0,
        "完全无关内容不应达到去重阈值 {DEDUP_THRESHOLD}（实际越界 {}）",
        ge(&diff_cos)
    );
}
