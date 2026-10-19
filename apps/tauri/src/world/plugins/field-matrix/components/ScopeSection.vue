<template>
  <h2>口径与维护</h2>
  <div class="scope-grid">
    <div class="scope-card">
      <h3>运行时边界</h3>
      <ul>
        <li>字段来自运行时注册表，包含项目级 schema 覆盖与用户 <code>customFields</code>。</li>
        <li>关系类型是实体之间的边，不是实体字段，单独成区。</li>
        <li>静态文档是生成时快照，与运行时数据可能不同。</li>
      </ul>
    </div>
    <div class="scope-card">
      <h3>字段合并</h3>
      <ul>
        <li>先按 Trait 声明顺序展开字段，再应用 <code>fieldOverrides</code>，最后追加 <code>ownFields</code>。</li>
        <li>同 key 时 <code>ownFields</code> 覆盖 Trait 字段。</li>
        <li><code>title</code> 落地为顶层 <code>name</code>；<code>description</code> / <code>tags</code> / <code>coverImage</code> 也落顶层。</li>
      </ul>
    </div>
    <div class="scope-card">
      <h3>刷新</h3>
      <p>字段变更随 <code>fieldRegistry.version</code> 重算；视图增删随 <code>pluginAPI.onViewChange</code> 重算。</p>
    </div>
    <div class="scope-card">
      <h3>数据源</h3>
      <ul>
        <li><code>entitySchemaRegistryV2</code> / <code>traitRegistry</code></li>
        <li><code>facetRegistry</code> / <code>fieldRegistry</code></li>
        <li><code>relationshipRegistry</code> / <code>pluginAPI</code></li>
      </ul>
    </div>
  </div>
  <p class="section-note">大纲芽正在另一条施工线推进；其字段以 <code>apps/tauri/src/world/plugins/outline/index.ts</code> 当前代码为准。</p>
</template>
