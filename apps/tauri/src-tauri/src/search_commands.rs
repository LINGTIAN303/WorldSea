//! B3 搜索 Provider 抽象 + 降级链
//!
//! 借鉴 OpenWorld 的「多 Provider + 降级」设计，适配桌面单用户：
//! - `SearchProvider` trait：统一的搜索接口（同步阻塞，由调用方做线程池隔离）
//! - 内置 Provider：Tavily / Bing / SerpAPI（需 API Key）+ DuckDuckGo（免 Key 兜底）
//! - `SearchProviderChain`：按「有 Key 的 Provider 优先 → 免 Key 兜底」顺序逐个尝试，
//!   任一 Provider 出错（认证/限流/网络）或返回空结果即降级到下一个，全部失败返回末位错误。
//! - `WebSearchTool`：实现 `agent-runtime::tool::Tool`，注册进 Rust `ToolBus`，供 LLM 调用。
//!
//! 数据源为各搜索 API；API Key 经 `set_search_config` 命令运行时注入（缺省仅 DuckDuckGo）。

use std::sync::{Arc, RwLock};
use std::time::Duration;

use agent_runtime::tool::{Tool, ToolError};
use async_trait::async_trait;

// ─── 搜索配置 ──────────────────────────────────────────────

/// 搜索 Provider 的 API Key 配置（桌面单用户，全部可选）
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SearchConfig {
    pub tavily_key: Option<String>,
    pub bing_key: Option<String>,
    pub serpapi_key: Option<String>,
}

// ─── 搜索结果类型 ──────────────────────────────────────────

/// 单条搜索结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// 搜索响应（序列化给 LLM）
#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub answer: String,
    pub results: Vec<SearchResult>,
    /// 实际命中的 Provider id
    pub engine: String,
}

// ─── SearchProvider trait ──────────────────────────────────

/// 搜索 Provider 抽象 — 统一搜索语义，供降级链编排。
///
/// 方法为**同步阻塞**（底层走 ureq 阻塞 API），调用方（`WebSearchTool::execute`）
/// 用 `tokio::task::spawn_blocking` 隔离到阻塞线程池，避免阻塞 tokio worker。
pub trait SearchProvider: Send + Sync {
    /// Provider 唯一标识（如 `tavily` / `duckduckgo`）
    fn id(&self) -> &str;

    /// 显示名（错误信息 / 日志用）
    fn display_name(&self) -> &str;

    /// 执行搜索。成功返回 `SearchResponse`（可能为空结果，由调用方决定是否降级）；
    /// 失败返回 `String` 错误说明（认证 / 限流 / 网络等，触发降级）。
    fn search(
        &self,
        query: &str,
        max_results: usize,
        api_key: Option<&str>,
    ) -> Result<SearchResponse, String>;
}

// ─── 降级链 ────────────────────────────────────────────────

/// 搜索 Provider 降级链 — 持有配置，按「有 Key 优先、免 Key 兜底」顺序逐个尝试。
///
/// 配置用 `std::sync::RwLock` 存储，可在阻塞线程（`spawn_blocking`）内安全读取，
/// 运行时经 `set_config` 更新（Tauri 命令调用）。
pub struct SearchProviderChain {
    config: RwLock<SearchConfig>,
}

impl SearchProviderChain {
    pub fn new(config: SearchConfig) -> Self {
        Self {
            config: RwLock::new(config),
        }
    }

    /// 运行时更新搜索配置（Tauri 命令 `set_search_config` 调用）
    pub fn set_config(&self, config: SearchConfig) {
        if let Ok(mut guard) = self.config.write() {
            *guard = config;
        }
    }

    /// 当前配置快照
    pub fn config(&self) -> SearchConfig {
        self.config.read().map(|g| g.clone()).unwrap_or_default()
    }

    /// 按当前配置构建「尝试顺序」：有 Key 的 Provider 在前，免 Key 的 DuckDuckGo 兜底在后。
    fn ordered_providers(&self, cfg: &SearchConfig) -> Vec<(Arc<dyn SearchProvider>, Option<String>)> {
        let mut list: Vec<(Arc<dyn SearchProvider>, Option<String>)> = Vec::new();
        if let Some(k) = cfg.tavily_key.clone().filter(|k| !k.is_empty()) {
            list.push((Arc::new(TavilyProvider), Some(k)));
        }
        if let Some(k) = cfg.bing_key.clone().filter(|k| !k.is_empty()) {
            list.push((Arc::new(BingProvider), Some(k)));
        }
        if let Some(k) = cfg.serpapi_key.clone().filter(|k| !k.is_empty()) {
            list.push((Arc::new(SerpApiProvider), Some(k)));
        }
        // 免 Key 兜底始终在最后
        list.push((Arc::new(DuckDuckGoProvider), None));
        list
    }

    /// 同步执行搜索（阻塞）。由调用方（`WebSearchTool`）做线程池隔离。
    ///
    /// 逐个 Provider 尝试：出错（认证/限流/网络）或返回空结果 → 降级到下一个；
    /// 首个返回非空结果的 Provider 即命中。全部失败返回末位错误。
    pub fn search_sync(&self, query: &str, max_results: usize) -> Result<SearchResponse, String> {
        let cfg = self.config();
        let providers = self.ordered_providers(&cfg);
        search_with_order(&providers, query, max_results)
    }
}

/// 按给定顺序执行降级搜索（可独立测试）。
///
/// 语义：错误或空结果 → 降级到下一个；首个非空结果命中；全部失败返回末位错误。
fn search_with_order(
    providers: &[(Arc<dyn SearchProvider>, Option<String>)],
    query: &str,
    max_results: usize,
) -> Result<SearchResponse, String> {
    let mut last_err = String::from("无可用搜索 Provider");
    for (provider, key) in providers {
        match provider.search(query, max_results, key.as_deref()) {
            Ok(resp) if !resp.results.is_empty() => return Ok(resp),
            Ok(_) => {
                last_err = format!("{} 无结果", provider.display_name());
                continue;
            }
            Err(e) => {
                last_err = format!("{} 失败: {e}", provider.display_name());
                continue;
            }
        }
    }
    Err(last_err)
}

// ─── WebSearchTool（Tool 实现） ─────────────────────────────

/// `web_search` 工具 — 联网搜索，经降级链执行。
pub struct WebSearchTool {
    chain: Arc<SearchProviderChain>,
}

impl WebSearchTool {
    pub fn new(chain: Arc<SearchProviderChain>) -> Self {
        Self { chain }
    }
}

#[async_trait]
impl Tool for WebSearchTool {
    fn name(&self) -> &str {
        "web_search"
    }

    fn description(&self) -> &str {
        "搜索互联网获取最新信息。返回搜索结果摘要列表（标题+摘要+URL）。\
         使用场景：查找参考资料、历史事实、文化背景、灵感素材。自动在多个搜索 \
         Provider 间降级（Tavily/Bing/SerpAPI 需 API Key，DuckDuckGo 免 Key 兜底）。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索查询关键词"
                },
                "max_results": {
                    "type": "number",
                    "description": "返回结果数量上限，默认 5"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::ArgsParse("缺少 query 参数".into()))?;
        let max_results = args
            .get("max_results")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(5)
            .clamp(1, 20);

        let chain = Arc::clone(&self.chain);
        let resp = tokio::task::spawn_blocking(move || chain.search_sync(&query, max_results))
            .await
            .map_err(|e| ToolError::Execution(format!("搜索任务失败: {e}")))?;

        match resp {
            Ok(resp) => Ok(serde_json::to_value(resp)
                .map_err(|e| ToolError::Execution(format!("序列化搜索结果失败: {e}")))?),
            Err(e) => Err(ToolError::Execution(e)),
        }
    }
}

// ─── Provider 工厂 ─────────────────────────────────────────

/// 构造 B3 搜索工具集合（注册进 Rust ToolBus 用）。当前仅 `web_search`。
pub fn search_tools(chain: Arc<SearchProviderChain>) -> Vec<Arc<dyn Tool>> {
    vec![Arc::new(WebSearchTool::new(chain))]
}

/// Tauri 命令：运行时更新搜索 Provider 配置（API Key）。
///
/// 传入的 `config` 中非空字段写入链；缺省（全 None）时仅 DuckDuckGo 免 Key 兜底。
#[tauri::command]
pub async fn set_search_config(
    state: tauri::State<'_, Arc<SearchProviderChain>>,
    config: SearchConfig,
) -> Result<(), String> {
    state.set_config(config);
    Ok(())
}

// ─── 各 Provider 实现 ──────────────────────────────────────

/// Tavily 搜索（POST JSON，需 API Key）
struct TavilyProvider;

impl SearchProvider for TavilyProvider {
    fn id(&self) -> &str {
        "tavily"
    }
    fn display_name(&self) -> &str {
        "Tavily"
    }
    fn search(
        &self,
        query: &str,
        max_results: usize,
        api_key: Option<&str>,
    ) -> Result<SearchResponse, String> {
        let key = api_key.ok_or_else(|| "Tavily 缺少 API Key".to_string())?;
        let body = serde_json::json!({
            "api_key": key,
            "query": query,
            "max_results": max_results.clamp(1, 20),
            "include_answer": true,
            "search_depth": "basic"
        });
        let resp = ureq::post("https://api.tavily.com/search")
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(15))
            .send_json(body)
            .map_err(|e| format!("Tavily 请求失败: {e}"))?;
        let data: serde_json::Value = resp
            .into_json()
            .map_err(|e| format!("Tavily 响应解析失败: {e}"))?;
        let results = parse_result_array(
            data.get("results").and_then(|v| v.as_array()),
            "title",
            "url",
            "content",
        );
        Ok(SearchResponse {
            query: query.to_string(),
            answer: data.get("answer").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            results,
            engine: self.id().to_string(),
        })
    }
}

/// Bing 搜索（GET，Ocp-Apim-Subscription-Key 头鉴权，需 API Key）
struct BingProvider;

impl SearchProvider for BingProvider {
    fn id(&self) -> &str {
        "bing"
    }
    fn display_name(&self) -> &str {
        "Bing"
    }
    fn search(
        &self,
        query: &str,
        max_results: usize,
        api_key: Option<&str>,
    ) -> Result<SearchResponse, String> {
        let key = api_key.ok_or_else(|| "Bing 缺少 API Key".to_string())?;
        let url = format!(
            "https://api.bing.microsoft.com/v7.0/search?q={}&count={}",
            urlencode(query),
            max_results.clamp(1, 20)
        );
        let resp = ureq::get(&url)
            .set("Ocp-Apim-Subscription-Key", key)
            .timeout(Duration::from_secs(15))
            .call()
            .map_err(|e| format!("Bing 请求失败: {e}"))?;
        let data: serde_json::Value = resp
            .into_json()
            .map_err(|e| format!("Bing 响应解析失败: {e}"))?;
        let results = parse_result_array(
            data.get("webPages")
                .and_then(|v| v.get("value"))
                .and_then(|v| v.as_array()),
            "name",
            "url",
            "snippet",
        );
        Ok(SearchResponse {
            query: query.to_string(),
            answer: String::new(),
            results,
            engine: self.id().to_string(),
        })
    }
}

/// SerpAPI 搜索（GET，api_key 为查询参数，需 API Key）
struct SerpApiProvider;

impl SearchProvider for SerpApiProvider {
    fn id(&self) -> &str {
        "serpapi"
    }
    fn display_name(&self) -> &str {
        "SerpAPI"
    }
    fn search(
        &self,
        query: &str,
        max_results: usize,
        api_key: Option<&str>,
    ) -> Result<SearchResponse, String> {
        let key = api_key.ok_or_else(|| "SerpAPI 缺少 API Key".to_string())?;
        let url = format!(
            "https://serpapi.com/search.json?q={}&api_key={}&num={}",
            urlencode(query),
            key,
            max_results.clamp(1, 20)
        );
        let resp = ureq::get(&url)
            .timeout(Duration::from_secs(15))
            .call()
            .map_err(|e| format!("SerpAPI 请求失败: {e}"))?;
        let data: serde_json::Value = resp
            .into_json()
            .map_err(|e| format!("SerpAPI 响应解析失败: {e}"))?;
        let results = parse_result_array(
            data.get("organic_results").and_then(|v| v.as_array()),
            "title",
            "link",
            "snippet",
        );
        Ok(SearchResponse {
            query: query.to_string(),
            answer: data
                .get("answer_box")
                .and_then(|v| v.get("snippet"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            results,
            engine: self.id().to_string(),
        })
    }
}

/// DuckDuckGo HTML 搜索（免 API Key，降级兜底）
struct DuckDuckGoProvider;

impl SearchProvider for DuckDuckGoProvider {
    fn id(&self) -> &str {
        "duckduckgo"
    }
    fn display_name(&self) -> &str {
        "DuckDuckGo"
    }
    fn search(
        &self,
        query: &str,
        max_results: usize,
        _api_key: Option<&str>,
    ) -> Result<SearchResponse, String> {
        let url = format!("https://html.duckduckgo.com/html/?q={}", urlencode(query));
        let resp = ureq::get(&url)
            .set(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .timeout(Duration::from_secs(15))
            .call()
            .map_err(|e| format!("DuckDuckGo 请求失败: {e}"))?;
        let html = resp
            .into_string()
            .map_err(|e| format!("DuckDuckGo 响应读取失败: {e}"))?;
        let results = parse_duckduckgo_html(&html, max_results.clamp(1, 20));
        Ok(SearchResponse {
            query: query.to_string(),
            answer: String::new(),
            results,
            engine: self.id().to_string(),
        })
    }
}

// ─── 通用辅助 ──────────────────────────────────────────────

/// 从 JSON 结果数组提取 title/url/snippet 三元组（Tavily/Bing/SerpAPI 共用）
fn parse_result_array(arr: Option<&Vec<serde_json::Value>>, title_k: &str, url_k: &str, snip_k: &str) -> Vec<SearchResult> {
    arr.map(|list| {
        list.iter()
            .map(|r| SearchResult {
                title: r.get(title_k).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                url: r.get(url_k).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                snippet: r
                    .get(snip_k)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .chars()
                    .take(300)
                    .collect(),
            })
            .collect()
    })
    .unwrap_or_default()
}

/// 解析 DuckDuckGo HTML 搜索结果（无正则依赖，字符串扫描）。
/// 提取 `class="result__a"` 链接（href + title）与紧随的 `class="result__snippet"` 摘要。
fn parse_duckduckgo_html(html: &str, max_results: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut rest = html;
    for _ in 0..max_results {
        let marker = "class=\"result__a\"";
        let Some(rel) = rest.find(marker) else {
            break;
        };

        // 提取 href（marker 同标签内需回找 <a 起点的 href）
        let anchor_start = rest[..rel].rfind("<a").unwrap_or(rel);
        let seg_from_anchor = &rest[anchor_start..];
        let href = extract_attr(seg_from_anchor, "href=");
        // 标题：第一个 `>` 之后到 `</a>`
        let title = extract_after_tag(seg_from_anchor).unwrap_or_default();
        // 摘要：marker 之后到 `</a>`
        let snippet = extract_snippet(&rest[rel..]);

        results.push(SearchResult {
            title: strip_html(&title).trim().to_string(),
            url: resolve_ddg_url(&href),
            snippet: strip_html(&snippet).trim().chars().take(300).collect(),
        });

        // 跳过本结果块：定位到摘要 `</a>` 之后，避免重复解析同一段
        let after_marker = &rest[rel..];
        let Some(snip_marker) = after_marker.find("class=\"result__snippet\"") else {
            break;
        };
        let snip_abs = rel + snip_marker;
        let Some(close_rel) = rest[snip_abs..].find("</a>") else {
            break;
        };
        rest = &rest[snip_abs + close_rel + "</a>".len()..];
    }
    results
}

/// 提取 `key="value"` 属性值（`key` 后紧跟 `"..."`）
fn extract_attr(seg: &str, key: &str) -> String {
    let Some(idx) = seg.find(key) else {
        return String::new();
    };
    let after = &seg[idx + key.len()..];
    let Some(open) = after.find('"') else {
        return String::new();
    };
    let rest = &after[open + 1..];
    match rest.find('"') {
        Some(close) => rest[..close].to_string(),
        None => rest.to_string(),
    }
}

/// 提取 `<a ...>` 标签内第一个 `>` 之后到 `</a>` 的文本
fn extract_after_tag(seg: &str) -> Option<String> {
    let gt = seg.find('>')?;
    let body = &seg[gt + 1..];
    let end = body.find("</a>")?;
    Some(body[..end].to_string())
}

/// 提取 `class="result__snippet"` 后 `>` 到 `</a>` 的摘要文本
fn extract_snippet(seg: &str) -> String {
    let marker = "class=\"result__snippet\"";
    let Some(idx) = seg.find(marker) else {
        return String::new();
    };
    let after = &seg[idx + marker.len()..];
    let Some(gt) = after.find('>') else {
        return String::new();
    };
    let body = &after[gt + 1..];
    match body.find("</a>") {
        Some(close) => body[..close].to_string(),
        None => body.to_string(),
    }
}

/// 去除 HTML 标签（保留实体原样，够用即可）
fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for c in input.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            out.push(c);
        }
    }
    out
}

/// 解析 DuckDuckGo 跳转 URL：取 `uddg=` 参数值并 percent-decode，无则原样返回
fn resolve_ddg_url(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    if let Some(idx) = raw.find("uddg=") {
        let val = &raw[idx + 5..];
        let end = val.find('&').unwrap_or(val.len());
        return percent_decode(&val[..end]);
    }
    raw.to_string()
}

/// percent-decode（仅处理 %XX，UTF-8 字节序列）
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() + 1 && i + 2 < bytes.len() + 1 {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// URL 编码（保留常见安全字符）
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试用 Mock Provider：可配置返回成功/失败/空
    struct MockProvider {
        id: &'static str,
        name: &'static str,
        behavior: MockBehavior,
    }
    enum MockBehavior {
        Ok,
        Empty,
        Err,
    }
    impl SearchProvider for MockProvider {
        fn id(&self) -> &str {
            self.id
        }
        fn display_name(&self) -> &str {
            self.name
        }
        fn search(
            &self,
            query: &str,
            _max_results: usize,
            _api_key: Option<&str>,
        ) -> Result<SearchResponse, String> {
            match &self.behavior {
                MockBehavior::Ok => Ok(SearchResponse {
                    query: query.to_string(),
                    answer: String::new(),
                    results: vec![SearchResult {
                        title: "t".into(),
                        url: "u".into(),
                        snippet: "s".into(),
                    }],
                    engine: self.id.to_string(),
                }),
                MockBehavior::Empty => Ok(SearchResponse {
                    query: query.to_string(),
                    answer: String::new(),
                    results: vec![],
                    engine: self.id.to_string(),
                }),
                MockBehavior::Err => Err(format!("{} 模拟失败", self.id)),
            }
        }
    }

    fn mock(id: &'static str, needs_key: bool, behavior: MockBehavior) -> (Arc<dyn SearchProvider>, Option<String>) {
        (Arc::new(MockProvider { id, name: id, behavior }), if needs_key { Some("k".into()) } else { None })
    }

    #[test]
    fn fallback_returns_first_success() {
        let providers = vec![mock("a", true, MockBehavior::Ok), mock("b", true, MockBehavior::Ok)];
        let resp = search_with_order(&providers, "q", 5).unwrap();
        assert_eq!(resp.engine, "a", "应命中第一个成功的 Provider");
    }

    #[test]
    fn fallback_skips_error_to_next() {
        let providers = vec![mock("a", true, MockBehavior::Err), mock("b", true, MockBehavior::Ok)];
        let resp = search_with_order(&providers, "q", 5).unwrap();
        assert_eq!(resp.engine, "b", "a 失败应降级到 b");
    }

    #[test]
    fn fallback_skips_empty_to_next() {
        let providers = vec![mock("a", true, MockBehavior::Empty), mock("b", true, MockBehavior::Ok)];
        let resp = search_with_order(&providers, "q", 5).unwrap();
        assert_eq!(resp.engine, "b", "a 空结果应降级到 b");
    }

    #[test]
    fn fallback_all_fail_returns_last_error() {
        let providers = vec![mock("a", true, MockBehavior::Err), mock("b", true, MockBehavior::Err)];
        let err = search_with_order(&providers, "q", 5).unwrap_err();
        assert!(err.contains("b"), "末位错误应包含 b: {err}");
    }

    #[test]
    fn chain_default_uses_duckduckgo_when_no_key() {
        let chain = SearchProviderChain::new(SearchConfig::default());
        // 无 Key：仅 DuckDuckGo（此处不真联网，仅验证 ordered_providers 顺序）
        let cfg = chain.config();
        let providers = chain.ordered_providers(&cfg);
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].0.id(), "duckduckgo");
    }

    #[test]
    fn chain_config_sets_and_reads() {
        let chain = SearchProviderChain::new(SearchConfig::default());
        chain.set_config(SearchConfig {
            tavily_key: Some("t".into()),
            ..Default::default()
        });
        let cfg = chain.config();
        assert_eq!(cfg.tavily_key.as_deref(), Some("t"));
        let providers = chain.ordered_providers(&cfg);
        assert_eq!(providers.len(), 2, "tavily + duckduckgo");
        assert_eq!(providers[0].0.id(), "tavily");
        assert_eq!(providers[1].0.id(), "duckduckgo");
    }

    #[tokio::test]
    async fn tool_execute_missing_query_returns_args_error() {
        let chain = Arc::new(SearchProviderChain::new(SearchConfig::default()));
        let tool = WebSearchTool::new(chain);
        let result = tool.execute(serde_json::json!({})).await;
        assert!(matches!(result, Err(ToolError::ArgsParse(_))));
    }

    #[test]
    fn parse_ddg_html_extracts_results() {
        let html = r#"<div class="result">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&amp;rut=1">样例标题 <b>加粗</b></a>
            <a class="result__snippet">这是摘要</a>
        </div>"#;
        let results = parse_duckduckgo_html(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "样例标题 加粗");
        assert_eq!(results[0].snippet, "这是摘要");
        assert_eq!(results[0].url, "https://example.com");
    }

    #[test]
    fn strip_html_removes_tags() {
        assert_eq!(strip_html("<b>hi</b> &amp; <i>world</i>"), "hi &amp; world");
    }

    #[test]
    fn urlencode_and_decode_roundtrip() {
        let enc = urlencode("你好 world");
        assert_eq!(percent_decode(&enc), "你好 world");
    }
}