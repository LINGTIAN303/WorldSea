"""Crawl4AI 微服务 — 基于 FastAPI 的网页抓取服务

提供网页内容抓取能力，支持 markdown / fit_markdown / cleaned_html 三种输出格式，
并支持批量抓取、并发控制、单 URL 超时和逐条状态返回。
由 worldsmith-server 通过 PythonBridge 调用。
"""

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from crawl4ai import AsyncWebCrawler

app = FastAPI(title="Crawl4AI Service")

# 允许所有来源的跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CrawlRequest(BaseModel):
    """单个抓取请求体"""

    url: str = Field(..., description="目标网页 URL")
    max_length: int = Field(default=8000, description="内容最大长度，超出则截断")
    output_format: str = Field(default="markdown", description="输出格式：markdown / fit_markdown / cleaned_html")
    timeout: int = Field(default=30, description="单个 URL 抓取超时秒数")


class CrawlBatchRequest(BaseModel):
    """批量抓取请求体"""

    urls: list[str] = Field(..., description="目标网页 URL 列表")
    max_length: int = Field(default=8000, description="每条内容最大长度，超出则截断")
    output_format: str = Field(default="markdown", description="输出格式：markdown / fit_markdown / cleaned_html")
    concurrency: int = Field(default=2, ge=1, le=5, description="最大并发数（1-5）")
    timeout: int = Field(default=30, description="单个 URL 抓取超时秒数")


class CrawlResult(BaseModel):
    """单条抓取结果"""

    url: str
    status: str = Field(..., description="success / error")
    content: str = ""
    length: int = 0
    truncated: bool = False
    format: str = "markdown"
    error: str = ""
    attempts: int = 1


class CrawlResponse(BaseModel):
    """单个抓取响应体"""

    url: str
    status: str
    content: str
    length: int
    truncated: bool
    format: str
    error: str = ""
    attempts: int = 1


class CrawlBatchResponse(BaseModel):
    """批量抓取响应体"""

    total: int
    successful: int
    failed: int
    results: list[CrawlResult]


# 输出格式到 crawl4ai 结果字段的映射
FORMAT_MAP = {
    "markdown": "markdown",
    "fit_markdown": "fit_markdown",
    "cleaned_html": "cleaned_html",
}

# 全局 crawler 实例，避免每次请求创建/销毁浏览器
_crawler: AsyncWebCrawler | None = None


async def get_crawler() -> AsyncWebCrawler:
    """获取或创建全局 AsyncWebCrawler 实例"""
    global _crawler
    if _crawler is None:
        _crawler = AsyncWebCrawler()
        await _crawler.start()
    return _crawler


async def close_crawler() -> None:
    """关闭全局 crawler 资源"""
    global _crawler
    if _crawler is not None:
        await _crawler.close()
        _crawler = None


@app.on_event("shutdown")
async def shutdown_crawler():
    """服务关闭时清理 crawler 资源"""
    await close_crawler()


@app.get("/health")
async def health():
    """健康检查端点"""
    return {"status": "ok", "service": "crawl4ai"}


async def _crawl_one(
    url: str,
    max_length: int,
    output_format: str,
    timeout: int,
    retries: int = 1,
) -> CrawlResult:
    """内部：抓取单个 URL，支持超时和重试。"""
    field_name = FORMAT_MAP.get(output_format)
    if field_name is None:
        field_name = "markdown"
        output_format = "markdown"

    crawler = await get_crawler()
    last_error = ""

    for attempt in range(1, retries + 2):
        try:
            result = await asyncio.wait_for(
                crawler.arun(url=url),
                timeout=timeout,
            )
            content = getattr(result, field_name, None) or ""
            truncated = len(content) > max_length
            if truncated:
                content = content[:max_length]

            return CrawlResult(
                url=url,
                status="success",
                content=content,
                length=len(content),
                truncated=truncated,
                format=output_format,
                attempts=attempt,
            )
        except asyncio.TimeoutError:
            last_error = f"抓取超时（{timeout}s）"
        except Exception as e:  # noqa: BLE001
            last_error = str(e) or "未知错误"

    return CrawlResult(
        url=url,
        status="error",
        content="",
        length=0,
        truncated=False,
        format=output_format,
        error=last_error,
        attempts=retries + 1,
    )


@app.post("/crawl", response_model=CrawlResponse)
async def crawl(req: CrawlRequest):
    """抓取指定 URL 的网页内容。

    根据 output_format 提取对应字段，超出 max_length 时截断并标记 truncated。
    增加 status / error / attempts 字段以暴露执行状态。
    """
    result = await _crawl_one(req.url, req.max_length, req.output_format, req.timeout)
    return CrawlResponse(
        url=result.url,
        status=result.status,
        content=result.content,
        length=result.length,
        truncated=result.truncated,
        format=result.format,
        error=result.error,
        attempts=result.attempts,
    )


@app.post("/crawl/batch", response_model=CrawlBatchResponse)
async def crawl_batch(req: CrawlBatchRequest):
    """批量抓取多个 URL。

    使用 Semaphore 控制并发，逐条返回成功/失败状态，失败不会导致整体失败。
    """
    semaphore = asyncio.Semaphore(req.concurrency)

    async def _run_one(url: str) -> CrawlResult:
        async with semaphore:
            return await _crawl_one(url, req.max_length, req.output_format, req.timeout)

    results = await asyncio.gather(*[_run_one(url) for url in req.urls])
    successful = sum(1 for r in results if r.status == "success")
    failed = len(results) - successful

    return CrawlBatchResponse(
        total=len(results),
        successful=successful,
        failed=failed,
        results=results,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8101)
