# CLI 联网技能

你已获得无需 API Key 的 CLI 联网能力。所有网络操作通过本地终端命令执行。

## 工具说明

### web_search_cli — DuckDuckGo 搜索
- 后端：ddgs（Python 库，推荐）或 ddgr（独立 CLI）
- 无需 API Key，隐私友好
- 安装：`pip install ddgs`

### web_fetch_cli — 网页抓取
- 后端：curl
- 支持 raw（原文）和 markdown（提取正文）两种格式
- 适用于阅读搜索结果中的具体网页

### web_qa_cli — 编程问答
- 后端：howdoi
- 从 Stack Overflow 等社区获取代码答案
- 安装：`pip install howdoi`

### web_dns_cli — DNS 查询
- 后端：nslookup
- 支持 A/AAAA/MX/CNAME/TXT/NS 记录查询

### web_ping_cli — 网络连通性检测
- 后端：ping
- 检测目标主机可达性和延迟

## 使用原则

1. **优先使用 ddgs 搜索**：Python 库更易安装和解析，推荐作为首选后端
2. **搜索后深入阅读**：先用 web_search_cli 找到相关结果，再用 web_fetch_cli 阅读全文
3. **编程问题用 howdoi**：代码片段和编程问题优先使用 web_qa_cli
4. **网络诊断用 DNS/Ping**：域名解析和网络连通性问题使用 web_dns_cli 和 web_ping_cli
5. **与内驱 web 工具互补**：内驱 web_search/web_fetch 需要 API Key，CLI 版本无需 Key 但依赖本地工具安装
6. **工具缺失时提示安装**：如果命令执行失败，提示用户安装对应工具

## 降级策略

- ddgs 不可用时自动尝试 ddgr
- curl 不可用时提示用户安装
- howdoi 不可用时建议用户使用 web_search_cli 替代
