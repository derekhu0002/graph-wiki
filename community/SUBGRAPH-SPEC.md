# 架构子图规范（Community Subgraph Specification）

> ArchGraph 共建共享社区的子图命名与质量约定。
> 硬性校验由服务 graph_submit/graph_update 自动执行；本规范补充人工约定。

## 1. 什么是子图

**子图（subgraph）** = 从某项目完整意图图中裁剪出的一块，具备**独立复用价值**，
由 elements + relationships + views 组成，遵循 ARCHGRAPH 图谱 Schema。

一张子图不应是"整个项目图"，而应是"可独立理解的一块"。

## 2. 子图类型与适用

| 类型 | 特征元素 | 复用价值 | 命名域后缀 |
|---|---|---|---|
| 能力子图 | Business Actor + Capability | 一个 Agent/角色的核心能力画像 | `capability` |
| 角色子图 | Business Actor/Role + 职责关系 | 角色如何委派/协作/验收 | `role` |
| 治理子图 | Rule/Principle/Process + 门禁 | 可复用的规则/流程/质量门禁模式 | `governance` |
| 业务子图 | 业务域元素 + 技术关联 | 某业务域的结构与选型 | `business` |
| 协作子图 | 多 Actor/角色 + 协作流 | 跨角色的协作/委派模式 | `collab` |

## 3. 命名规范

### 3.1 id 命名

```
<project>-<domain>-<type>-<seq>
   │        │       │       └── 3 位数字序号（001 起）
   │        │       └────────── 子图类型域（capability/role/governance/business/collab）
   │        └────────────────── 领域（overseer/vision/insight/...）
   └─────────────────────────── 贡献项目短名（abot/archgraph/graphwiki/...）
```

**示例：**
- `abot-overseer-capability-001` — aBot 项目总管能力子图 ✅（已入库）
- `archgraph-argo-governance-001` — archgraph 的 ARGO 治理子图
- `graphwiki-assets-business-001` — graph-wiki 资产域业务子图

### 3.2 元素 id 命名

`<类型短名>-<语义>-<seq>` 或项目内既有 id，要求：
- 全小写 kebab-case
- 语义化（cap-memory, proj-overseer-001, tech-insight-process-001）
- 元素 id 在整个图谱库内尽力避免冲突（跨子图允许同名，因属于不同图）

## 4. 内容质量约定（人工）

1. **description 必须有**，且说明"复用价值"（为什么别人要取这张图）
2. **类型语义准确**：
   - 用 `Business Actor`（人/Agent）、`Capability`（能力）、`Business Process`（流程）、
     `Rule`（规则）、`Skill`、`Artifact` 等，别都用 Grouping/Business Object 兜底
3. **关系语义准确**：
   - `Assignment`（Actor 履行角色/执行行为）
   - `Realization`（实现/落实）
   - `Serving`（服务提供）
   - `Association`（一般关联）尽量少用，能表达就用具体关系
   - statement 格式：`源 --(关系)--> 目标`
4. **克制**：子图聚焦一个主题，元素建议 ≤ 15；大图拆多个子图
5. **views**：至少 1 个视图，表达该子图的主视角

## 5. 硬性校验（服务自动执行，不通过拒收）

`graph_submit` / `graph_update` 提交时自动检查：

- [ ] name / description 非空
- [ ] elements / relationships / views 为数组
- [ ] 元素含 id/name/type；type ∈ 64 个 ArchiMate 元素类型
- [ ] 元素 id 不重复
- [ ] 关系含 id/type/source_id/target_id/source_name/target_name/statement
- [ ] type ∈ 11 个 ArchiMate 关系类型
- [ ] 关系 source_id / target_id 指向存在的元素
- [ ] view 含 view_id/view_name；included_elements 引用存在；parent_element_id 存在
- [ ] 顶层视图（无 parent）最多 1 个

## 6. 示例子图骨架

```json
{
  "name": "项目总管能力子图",
  "description": "项目总管的核心能力画像，含记忆/协调/验收/洞察/工程。",
  "elements": [
    { "id": "overseer-001", "name": "项目总管", "type": "Business Actor", "description": "..." },
    { "id": "cap-accept", "name": "验收把关", "type": "Capability", "description": "..." }
  ],
  "relationships": [
    { "id": "r1", "type": "Association",
      "source_id": "overseer-001", "target_id": "cap-accept",
      "source_name": "项目总管", "target_name": "验收把关",
      "statement": "项目总管 --(Association)--> 验收把关" }
  ],
  "views": [
    { "view_id": "v1", "view_name": "能力视图",
      "included_elements": ["overseer-001", "cap-accept"] }
  ]
}
```

## 7. 提交建议

1. 本地先 `graph_get` 类似子图学习结构
2. 裁剪你的意图图成独立子图
3. 用 `graph_submit` 提交（自动校验）
4. 校验不通过 → 按返回 errors 修正后重试
