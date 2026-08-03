"""MarkItDown 微服务 — 将各类文档转换为 Markdown 格式

接收 base64 编码的文件内容，使用 markitdown 库转换为 Markdown，
通过 FastAPI 提供 HTTP 接口供 worldsmith-server 调用。
"""

import base64
import os
import tempfile

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
from pydantic import BaseModel

# ── 应用初始化 ──────────────────────────────────────────────

app = FastAPI(title="MarkItDown Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MarkItDown 转换器实例
md_converter = MarkItDown()


# ── 请求/响应模型 ──────────────────────────────────────────


class ConvertRequest(BaseModel):
    """转换请求：文件名 + base64 编码的文件内容"""

    filename: str
    content_base64: str


class ConvertResponse(BaseModel):
    """转换响应：文件名 + Markdown 文本 + 长度 + 来源格式"""

    filename: str
    content: str
    length: int
    format: str


# ── 路由 ────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """健康检查端点"""
    return {"status": "ok", "service": "markitdown"}


@app.post("/convert", response_model=ConvertResponse)
async def convert(req: ConvertRequest):
    """将上传的文件转换为 Markdown

    1. 解码 base64 内容
    2. 写入临时文件（保留原始扩展名以供 markitdown 识别格式）
    3. 调用 MarkItDown 转换
    4. 清理临时文件并返回结果
    """
    # 解码 base64
    try:
        raw_bytes = base64.b64decode(req.content_base64)
    except Exception as e:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=f"base64 解码失败: {e}")

    # 提取文件扩展名，用于临时文件命名
    _, ext = os.path.splitext(req.filename)
    if not ext:
        ext = ".bin"

    # 写入临时文件 → 转换 → 清理
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(raw_bytes)
            tmp_path = tmp.name

        result = md_converter.convert(tmp_path)
        markdown_text = result.text_content if result.text_content else ""
        source_format = result.file_extension if result.file_extension else ext.lstrip(".")

        return ConvertResponse(
            filename=req.filename,
            content=markdown_text,
            length=len(markdown_text),
            format=source_format,
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── 启动入口 ────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8102)
