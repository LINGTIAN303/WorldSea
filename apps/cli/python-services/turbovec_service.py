"""
TurboVec 向量检索微服务
基于 turbovec 库的 IdMapIndex 提供向量添加、搜索、删除功能
端口: 8103
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List
from turbovec import IdMapIndex
import numpy as np

app = FastAPI(title="TurboVec 向量检索服务")

# 允许所有来源的跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 内存中的索引集合：集合名 → IdMapIndex
indexes: Dict[str, IdMapIndex] = {}
# 记录每个集合的创建参数，防止维度不一致
index_params: Dict[str, dict] = {}


def get_or_create_index(collection: str, dim: int, bit_width: int) -> IdMapIndex:
    """获取已有索引，不存在则创建新的 IdMapIndex

    如果集合已存在但 dim/bit_width 不匹配，抛出 ValueError 防止静默出错。
    """
    if collection in indexes:
        existing = index_params[collection]
        if existing["dim"] != dim or existing["bit_width"] != bit_width:
            raise ValueError(
                f"集合 '{collection}' 已存在 (dim={existing['dim']}, bit_width={existing['bit_width']}), "
                f"与请求参数 (dim={dim}, bit_width={bit_width}) 不匹配"
            )
        return indexes[collection]
    idx = IdMapIndex(dim=dim, bit_width=bit_width)
    indexes[collection] = idx
    index_params[collection] = {"dim": dim, "bit_width": bit_width}
    return idx


# ── 请求体模型 ──────────────────────────────────────────


class AddRequest(BaseModel):
    """添加向量请求体"""
    collection: str
    ids: List[int]
    vectors: List[List[float]]
    dim: int = 1536
    bit_width: int = 4


class SearchRequest(BaseModel):
    """搜索向量请求体"""
    collection: str
    query_vector: List[float]
    top_k: int = 10
    dim: int = 1536
    bit_width: int = 4


class DeleteRequest(BaseModel):
    """删除向量请求体"""
    collection: str
    ids: List[int]


# ── 路由 ────────────────────────────────────────────────


@app.get("/health")
async def health():
    """健康检查，返回服务状态及已加载的索引集合名列表"""
    return {
        "status": "ok",
        "service": "turbovec",
        "collections": list(indexes.keys()),
    }


@app.post("/add")
async def add(req: AddRequest):
    """向指定集合添加向量"""
    try:
        idx = get_or_create_index(req.collection, req.dim, req.bit_width)
    except ValueError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))
    vecs = np.array(req.vectors, dtype=np.float32)
    idx.add(req.ids, vecs)
    return {"status": "ok", "count": len(req.ids)}


@app.post("/search")
async def search(req: SearchRequest):
    """在指定集合中搜索最相似的向量"""
    try:
        idx = get_or_create_index(req.collection, req.dim, req.bit_width)
    except ValueError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))
    query = np.array([req.query_vector], dtype=np.float32)
    ids, scores = idx.search(query, req.top_k)
    results = [
        {"id": int(id_), "score": float(score)}
        for id_, score in zip(ids[0], scores[0])
    ]
    return {"results": results}


@app.post("/delete")
async def delete(req: DeleteRequest):
    """从指定集合中删除向量"""
    if req.collection not in indexes:
        return {"status": "ok", "deleted": 0}
    idx = indexes[req.collection]
    idx.delete(req.ids)
    return {"status": "ok", "deleted": len(req.ids)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8103)
