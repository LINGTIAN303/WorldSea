# content-search.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/content-search.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
内容搜索工具

提供跨实体类型的混合搜索（关键词 + 语义），用于 content_search 工具。

搜索模式：
- keyword: 纯关键词匹配（名称、描述、属性）
- semantic: 纯 Embedding 向量语义搜索
- hybrid: 两路合并——关键词和语义结果去重合并，both 匹配优先排序
```

## 注释块 2（原文件第 31-41 行）

```
关键词搜索

根据 scope 参数在实体的 name / description / properties 中匹配关键词。
描述长度超过 120 字符时截断预览。

@param entities 待搜索的实体列表
@param kw 小写的搜索关键词
@param scope 搜索范围: name | description | properties | all
@param limit 返回数量上限
```

## 注释块 3（原文件第 152-160 行）

```
content_search 工具

在项目的所有实体中搜索内容。支持三种模式：
- hybrid: 关键词 + 语义混合（默认）
- keyword: 纯关键词匹配
- semantic: 纯语义搜索

语义搜索需要配置 Embedding API；关键词搜索无需额外配置。
```
