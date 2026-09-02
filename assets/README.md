# 图谱资产库

本仓库是 **AI 组织图谱资产的共建共享中心**：以整张 ARCHGRAPH 图谱为单位共享
（elements / relationships / views，ArchiMate 元素与关系类型体系）。

## 定位

- **不是** Agent 工作过程中的运行时查询对象。
- **是** 组织图谱资产（把 AGENT / SKILL / RULE / HOOKS / 知识库等元素
  串成的关系图谱）的注册表与共建共享中心。
- **获取场景**：某项目开工前，Agent 自行或经用户指引，从资产库获取组织图谱资产，
  作为该项目工作上下文/架构基线。
- **贡献场景**：某项目在用户指引下，把自有的组织图谱贡献到这里供其他项目复用。

## 目录结构

```
assets/
├── catalog.json          # 图谱索引（唯一事实源，登记全部图谱元数据）
├── README.md             # 本说明
└── graphs/
    └── <graphId>/
        └── graph.json    # 一张完整的 ARCHGRAPH 图谱
```

## 图谱条目规范

每张图谱在 `catalog.json` 的 `graphs[]` 中登记一个条目：

```json
{
  "id": "graph-collab-demo",
  "name": "AI组织资产协作图谱",
  "version": "1.0.0",
  "path": "graphs/graph-collab-demo/graph.json",
  "sourceRepo": "graph-wiki",
  "sourceCommit": "abc123",
  "description": "示例图谱",
  "stats": { "elements": 3, "relationships": 2, "views": 1 }
}
```

图谱本体遵循 ARCHGRAPH Schema：

```json
{
  "name": "图谱名称",
  "description": "图谱描述",
  "elements": [{ "id": "e1", "name": "元素", "type": "Skill" }],
  "relationships": [{ "id": "r1", "type": "Association", "source_id": "e1", "target_id": "e2", "source_name": "...", "target_name": "...", "statement": "..." }],
  "views": [{ "view_id": "v1", "view_name": "视图", "included_elements": ["e1", "e2"] }]
}
```

## 使用方式

通过远程 MCP 服务（`https://argo.derekworkspacev5.com/mcp`）操作：

```
# 获取
graph_list             → 列出图谱资产
graph_get {id}         → 获取整张图谱

# 贡献（内部自动 ARCHGRAPH schema 校验，不通过则拒收不入库）
graph_submit {id} --graph {...}   → 提交新图谱
graph_update {id} --graph {...}   → 更新图谱
```

提交/更新时自动执行 schema 校验：结构完整性、ArchiMate 类型合法性、
id 唯一、关系端点引用存在、view 成员存在、顶层视图唯一。
校验不通过则返回错误并停止入库。
