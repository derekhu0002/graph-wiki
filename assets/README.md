# AI 组织资产库（静态）

本仓库是 **AI 组织资产的共建共享中心**，采用 **Git 仓库 + 静态目录文件** 的轻量方案：
无服务依赖、无需数据库、无需外部 API，资产即文件。

## 定位

- **不是** Agent 工作过程中的运行时查询对象。
- **是** 组织资产（AGENT / SKILL / RULE / HOOKS / 知识库）的注册表与发现目录。
- **获取场景**：某项目要开工时，该项目的 Agent 自行或经用户指引，
  从本资产库获取组织资产（加载某 SKILL、套用某 RULE、装配某 HOOKS、引用某知识库）。
- **贡献场景**：某项目在用户指引下，把自有的组织资产贡献到这里，供其他项目复用。

## 目录结构

```
assets/
├── catalog.json       # 资产索引（唯一事实源，登记全部资产元数据）
├── README.md          # 本说明
├── agents/            # AGENT 资产（agent 配置/定义）
├── skills/            # SKILL 资产（技能定义/工作流）
├── rules/             # RULE 资产（跨项目规则/约束）
├── hooks/             # HOOKS 资产（生命周期钩子）
└── knowledge/         # 知识库资产（文档/数据）
```

## 资产条目规范

每项资产在 `catalog.json` 中登记一个条目，资产本体是分类目录下的文件：

```json
{
  "id": "skill-argo",
  "type": "SKILL",
  "name": "ARGO 知识图谱操作技能",
  "version": "1.0.0",
  "path": "skills/argo.md",
  "sourceRepo": "graph-wiki",
  "sourceCommit": "abc123",
  "description": "通过 ARGO MCP 工具读写知识图谱的技能"
}
```

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识（kebab-case，含类型前缀） |
| `type` | AGENT / SKILL / RULE / HOOKS / KNOWLEDGE |
| `name` | 资产名称 |
| `version` | 版本号 |
| `path` | 资产本体在本仓库的路径 |
| `sourceRepo` | 来源项目仓库 |
| `sourceCommit` | 来源 commit（可追溯） |
| `description` | 简短描述 |

## 获取流程（项目开工前）

```bash
# 1. 获取资产库（clone 一次，之后 git pull）
git clone <本仓库地址> ai-assets
# 或作为 submodule 引入：
git submodule add <本仓库地址> ai-assets

# 2. 浏览资产索引
cat ai-assets/catalog.json

# 3. 按需获取资产本体（按 catalog.json 的 path 读取）
cat ai-assets/skills/argo.md
```

## 贡献流程

```bash
# 1. 在对应分类目录添加资产文件（如 skills/my-skill.md）
# 2. 在 catalog.json 追加登记条目（含 version / sourceCommit）
# 3. 提交并推送
git add assets/
git commit -m "feat(assets): register my-skill"
git push
```

## 约定

- 资产本体文件留在本仓库，`catalog.json` 是唯一的索引入口。
- 更新资产时递增 `version` 并记录 `sourceCommit`，保证可追溯。
- 大型/二进制资产不建议直接入库，可在描述中记录外部地址。
