//! 中文检索评测集（A2 裁定 4：R1 交付时建立，作为 R2 的 A/B 基线）
//!
//! ## 两部分
//!
//! 1. **关键词评测（离线、有断言）**：20 条含文中实词的中文查询，BM25 通道必须命中
//!    目标文件（hit@3 ≥ 90%）。纯本地、零网络——CI/无端点环境可跑。
//! 2. **语义评测（需真实嵌入端点、报告制）**：10 条「改述型」查询（与原文无字面重叠），
//!    对比 BM25-only 与混合检索（BM25+向量）的 hit@3，输出基线报告。
//!    运行方式（默认 `#[ignore]`）：
//!
//!    ```text
//!    # 端点与 Key 从环境变量读（避免把 Key 写进命令历史/仓库）
//!    SILICONFLOW_API_KEY=sk-xxx cargo test --offline --test eval_retrieval -- --ignored --nocapture
//!    ```
//!
//! 语料为内置 fixture（8 份中文文档，覆盖「考据 / 设定 / 剧情 / 代码 / 笔记」五类），
//! 可替换为真实工作区目录以评测你自己的语料。

use std::path::Path;
use std::sync::Arc;

use agent_index::{IndexPolicy, WorkspaceIndex, get_or_open, registry_clear};

/// fixture 语料：`(相对路径, 内容)`
const CORPUS: &[(&str, &str)] = &[
    (
        "考据/星海地理.md",
        "星海由无数星域组成，星域之间以星门相连。星门是上古文明留下的空间通道，\
         开启时需要消耗大量灵能。潮汐现象会周期性地增强或削弱星门的稳定性，\
         因此远航船队通常选择在平潮期穿越。星域内部航运依赖跃迁引擎，\
         但跃迁无法跨越星门之间的裂隙地带。",
    ),
    (
        "考据/古文明遗迹.md",
        "上古文明在星海各处留下了遗迹。遗迹核心通常埋有机关阵列，\
         以灵能为驱动，攻击擅自闯入者。最著名的遗迹是沉钟环，\
         它的机关会在午夜自行校准星轨。考古公会严禁私自开启遗迹核心，\
         因为机关阵列一旦失控会引发灵能风暴。",
    ),
    (
        "设定/灵能体系.md",
        "灵能修炼分为九级，从凝息到化神。每三级设一道瓶颈，突破瓶颈需要机缘与积累。\
         灵能储量决定上限，而灵能密度决定发力速度。高阶修行者可以外放灵能护体，\
         在真空中短暂生存。灵能枯竭会导致修行者昏厥，严重时不可逆转。",
    ),
    (
        "设定/势力-苍穹会.md",
        "苍穹会以维护星门秩序为宗旨，总部设在悬空城。会长由长老会推举产生，\
         任期十二年。苍穹会与自由商会长期争夺星门通行权，双方在第三星域多次冲突。\
         会内设有巡天司，负责缉查私自穿越星门的行为。",
    ),
    (
        "设定/主角-林渡.md",
        "林渡出身矿星，少年时在废弃矿洞里捡到一枚残缺的星图碎片。\
         星图碎片激活了他体内沉睡的灵能，使他在没有师承的情况下自行踏入凝息境。\
         为寻找碎片的来历，他加入远航船队，途中结识了巡天司的女官。\
         他的性格固执，认定的事从不回头。",
    ),
    (
        "剧情/第一卷大纲.md",
        "第一卷围绕「星图碎片」展开：林渡在矿星觉醒灵能，被巡天司注意，\
         随后卷入苍穹会与自由商会的星门冲突。卷末他穿越沉钟环遗迹，\
         发现碎片与上古文明的血脉封印有关，为第二卷的裂隙地带埋下伏笔。",
    ),
    (
        "代码/生成脚本.py",
        "# 世界观数据生成脚本：把星域名录导出为地图配置\n\
         def build_star_map(regions):\n\
         \x20   \"\"\"读取考据目录下的星域条目，输出前端可用的 JSON 配置\"\"\"\n\
         \x20   return [{\"name\": r[\"name\"], \"links\": r.get(\"星门\", [])} for r in regions]\n",
    ),
    (
        "笔记/命名规范.md",
        "命名规范：星域名使用双字组合（如「苍垣」「碧落」），星门以起止星域命名，\
         人物名用单姓单名，势力名统一以「会 / 盟 / 司」结尾。\
         所有专有名词首次出现时须在名词表登记，避免同物异名。",
    ),
];

/// 关键词评测（与原文有字面重叠）：`(query, 期望文件)`
const KEYWORD_QUERIES: &[(&str, &str)] = &[
    ("星门", "考据/星海地理.md"),
    ("潮汐 星门", "考据/星海地理.md"),
    ("跃迁引擎", "考据/星海地理.md"),
    ("机关阵列", "考据/古文明遗迹.md"),
    ("沉钟环", "考据/古文明遗迹.md"),
    ("灵能风暴", "考据/古文明遗迹.md"),
    ("瓶颈 灵能", "设定/灵能体系.md"),
    ("凝息 化神", "设定/灵能体系.md"),
    ("灵能密度", "设定/灵能体系.md"),
    ("苍穹会", "设定/势力-苍穹会.md"),
    ("悬空城", "设定/势力-苍穹会.md"),
    ("巡天司", "设定/势力-苍穹会.md"),
    ("自由商会", "设定/势力-苍穹会.md"),
    ("星图碎片", "设定/主角-林渡.md"),
    ("矿星", "设定/主角-林渡.md"),
    ("第一卷", "剧情/第一卷大纲.md"),
    ("血脉封印", "剧情/第一卷大纲.md"),
    ("build_star_map", "代码/生成脚本.py"),
    ("命名规范", "笔记/命名规范.md"),
    ("名词表", "笔记/命名规范.md"),
];

/// 语义评测（改述查询，与原文少字面重叠）：`(query, 期望文件)`
const SEMANTIC_QUERIES: &[(&str, &str)] = &[
    ("怎么在星海之间远距离通行", "考据/星海地理.md"),
    ("什么样的周期会让航行更安全", "考据/星海地理.md"),
    ("有哪些不能随便碰的古老造物", "考据/古文明遗迹.md"),
    ("修行者力量提升会遇到什么坎", "设定/灵能体系.md"),
    ("谁负责维持通道秩序", "设定/势力-苍穹会.md"),
    ("主角是怎么变强的", "设定/主角-林渡.md"),
    ("第一本书讲了个什么故事", "剧情/第一卷大纲.md"),
    ("导出地图配置的脚本在哪", "代码/生成脚本.py"),
    ("专有名词该怎么起名与登记", "笔记/命名规范.md"),
    ("两个势力在争什么", "设定/势力-苍穹会.md"),
];

async fn build_fixture_index(root: &Path) -> Arc<WorkspaceIndex> {
    registry_clear().await;
    let ws = root.join("ws");
    for (rel, content) in CORPUS {
        let p = ws.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
    }
    let idx = get_or_open(
        &root.join("index"),
        &ws,
        IndexPolicy::default(),
        None, // 离线：纯 BM25
    )
    .await
    .unwrap();
    idx.sync().unwrap();
    // 关键词通道显式播种（生产由后台预热完成；测试要确定性就绪）
    idx.build_keyword_blocking().unwrap();
    idx
}

/// hit@3：前三条命中任一期望文件即算命中
async fn hit(idx: &Arc<WorkspaceIndex>, query: &str, expect: &str, top_k: usize) -> bool {
    idx.search(query, top_k, None, None)
        .await
        .iter()
        .any(|h| h.path == expect)
}

#[tokio::test]
async fn keyword_eval_hits_at_3() {
    let dir = tempfile::tempdir().unwrap();
    let idx = build_fixture_index(dir.path()).await;
    assert!(idx.stats().files == CORPUS.len(), "fixture 应全部入索引");

    let mut hits = 0usize;
    let mut misses: Vec<(&str, &str)> = Vec::new();
    for (query, expect) in KEYWORD_QUERIES {
        if hit(&idx, query, expect, 3).await {
            hits += 1;
        } else {
            misses.push((query, expect));
        }
    }
    let rate = hits as f64 / KEYWORD_QUERIES.len() as f64;
    println!(
        "[关键词评测] hit@3 = {hits}/{} = {:.0}%",
        KEYWORD_QUERIES.len(),
        rate * 100.0
    );
    assert!(
        rate >= 0.90,
        "关键词 hit@3 应 ≥ 90%，实际 {hits}/{}；未命中: {misses:?}",
        KEYWORD_QUERIES.len()
    );
}

/// 语义评测（报告制；需真实端点，默认忽略）
#[tokio::test]
#[ignore = "需要真实 embedding 端点：SILICONFLOW_API_KEY=sk-xxx cargo test --test eval_retrieval -- --ignored --nocapture"]
async fn semantic_eval_report() {
    let api_key = std::env::var("SILICONFLOW_API_KEY")
        .or_else(|_| std::env::var("WORLDSEA_EMBEDDING_API_KEY"))
        .expect("需设置 SILICONFLOW_API_KEY（或 WORLDSEA_EMBEDDING_API_KEY）");
    let semantic = agent_memory::semantic::SemanticConfig {
        api_url: std::env::var("WORLDSEA_EMBEDDING_API_URL")
            .unwrap_or_else(|_| "https://api.siliconflow.cn/v1/embeddings".into()),
        api_key,
        model: std::env::var("WORLDSEA_EMBEDDING_MODEL")
            .unwrap_or_else(|_| "BAAI/bge-m3".into()),
        dim: 1024,
        timeout_secs: 30,
    };

    let dir = tempfile::tempdir().unwrap();
    registry_clear().await;
    let ws = dir.path().join("ws");
    for (rel, content) in CORPUS {
        let p = ws.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
    }

    // 基线：纯关键词实例（独立索引根，无嵌入器）
    let kw_idx = get_or_open(
        &dir.path().join("index-kw"),
        &ws,
        IndexPolicy::default(),
        None,
    )
    .await
    .unwrap();
    kw_idx.sync().unwrap();
    kw_idx.build_keyword_blocking().unwrap(); // 关键词通道显式播种（生产由后台预热完成）
    let mut kw_hits = 0usize;
    for (query, expect) in SEMANTIC_QUERIES {
        if hit(&kw_idx, query, expect, 3).await {
            kw_hits += 1;
        }
    }

    // 实验组：混合检索实例（同语料，启用嵌入器）
    let hy_idx = get_or_open(
        &dir.path().join("index-hy"),
        &ws,
        IndexPolicy::default(),
        Some(semantic),
    )
    .await
    .unwrap();
    hy_idx.sync().unwrap();
    hy_idx.build_keyword_blocking().unwrap(); // 关键词通道显式播种（生产由后台预热完成）
    let _ = hy_idx.search("预热", 1, None, None).await; // 触发后台补向量
    for _ in 0..300 {
        if hy_idx.stats().vectors >= hy_idx.stats().chunks {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let stats = hy_idx.stats();
    println!("[语义评测] 索引状态: {stats:?}");
    assert!(stats.vectors > 0, "向量未补齐，无法评测（检查端点/Key）");

    let mut hy_hits = 0usize;
    for (query, expect) in SEMANTIC_QUERIES {
        let hy_ok = hit(&hy_idx, query, expect, 3).await;
        let kw_ok = hit(&kw_idx, query, expect, 3).await;
        if hy_ok {
            hy_hits += 1;
        }
        println!(
            "  {query} → {expect} | 关键词:{} 混合:{}",
            if kw_ok { "命中" } else { "未中" },
            if hy_ok { "命中" } else { "未中" }
        );
    }
    println!(
        "[语义评测] 改述查询 hit@3 —— 关键词基线 {kw_hits}/{} vs 混合检索 {hy_hits}/{}",
        SEMANTIC_QUERIES.len(),
        SEMANTIC_QUERIES.len()
    );
    // 回归护栏（2026-09-12 基线）：混合通道不得比关键词基线更差。
    // RRF 融合只要有一条通道失败就会降级为另一条；此断言把「融合无回退损失」
    // 从「报告里的一句话」变成可执行的契约——R2 各增强项（语法分块 / Reranker）
    // 改动后重跑此测试即可发现质量回退。
    assert!(
        hy_hits >= kw_hits,
        "混合检索不应弱于关键词基线（关键词 {kw_hits}/{}，混合 {hy_hits}/{}）——\
         检查向量通道是否补齐（端点/Key）或融合是否被改坏",
        SEMANTIC_QUERIES.len(),
        SEMANTIC_QUERIES.len()
    );
}
