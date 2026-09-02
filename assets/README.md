# AI 组织资产共建共享

总知识图谱是 **AI 组织资产的共建共享中心**，不是 Agent 工作过程中的查询对象。

它登记 AGENT、SKILL、RULE、HOOKS、知识库等组织资产的 **目录与元数据**（名称/类型/版本/来源项目/来源commit/获取路径），
资产本体文件留在各项目仓库中。图谱负责"发现"和"定位"，各项目仓库负责"存储"。

## 定位与场景

- **不是** Agent 运行时的数据查询/读写对象。
- **是** 组织资产（AGENT/SKILL/RULE/HOOKS/知识库）的注册表与发现目录。
- **获取场景**：当某项目要开工时，该项目的 Agent 可以自己或经用户指引，
  到这个中心获取组织资产（如加载某 SKILL、套用某 RULE、装配某 HOOKS、引用某知识库），
  以引导开工阶段的能力与约束。
- **贡献场景**：某项目在用户指引下，把自有的组织资产登记/贡献到这个中心，
  供其他项目复用。资产本体留在本项目仓库，图谱登记元数据（含来源项目与 commit）。

## 资产类型

| 类型 | 图谱元素 | 说明 |
|---|---|---|
| AGENT | Artifact | Agent 配置/定义（agent 类型、tools、指令） |
| SKILL | Artifact | 技能定义（描述、工作流、指令） |
| RULE | Rule | 跨项目规则/约束（AGENTS.md 规则、治理规则） |
| HOOKS | Artifact | 生命周期钩子脚本 |
| KNOWLEDGE | Business Object | 知识库（文档/数据）引用 |

## 资产元数据

每项资产登记在总图谱的元素上，携带以下元数据属性：

| 属性 | 说明 |
|---|---|
| `assetType` | AGENT/SKILL/RULE/HOOKS/KNOWLEDGE |
| `version` | 资产版本号 |
| `sourceRepo` | 来源项目仓库路径 |
| `sourceCommit` | 来源 commit |
| `assetPath` | 资产本体在来源仓库的路径 |

## 使用方式

总知识图谱通过远端服务 `https://argo.derekworkspacev5.com/mcp` 提供资产目录能力。
有两种使用方式：

### 1. 通过 MCP 工具（Agent 直接使用）

任意项目配置远端 MCP 后，Agent 可用现有 ARGO 工具直接操作资产目录：

- 列出资产：`getArchitectureViewContext` (view_id: `org-asset-catalog-view`)
- 查看资产：`getIntentElementContext` (elementId: 资产 id)
- 登记资产：`addArchitectureElement` (元素 + view_ids: `org-asset-catalog-view`)
- 更新资产：`updateArchitectureElement` (更新 version/sourceCommit 等)

### 2. 通过资产目录 CLI

```bash
# 列出所有资产
node assets/asset-catalog.js list

# 按类型过滤
node assets/asset-catalog.js list --type SKILL

# 查看单个资产
node assets/asset-catalog.js get org-asset-skill-deep-dive

# 登记新资产（AGENT/SKILL/RULE/HOOKS/KNOWLEDGE）
node assets/asset-catalog.js register org-asset-skill-deep-dive \
  --type SKILL --name "深度分析技能" --version 1.0.0 \
  --repo "D:/Projects/foo" --commit abc123 --path "skills/deep-dive.md" \
  --desc "用于代码深度分析的技能"

# 更新资产版本/来源commit
node assets/asset-catalog.js update org-asset-skill-deep-dive --version 1.1.0 --commit abc456
```

> CLI 默认连接 `https://argo.derekworkspacev5.com/mcp`，可用环境变量覆盖：
> `KG_MCP_URL` 指定远端地址；自签名证书时设 `KG_MCP_INSECURE=1`。

## 开工流程建议

```
开工前（获取资产）:
  1. Agent 查询资产目录（list）→ 按需 get 资产元数据
  2. 根据元数据 sourceRepo/sourceCommit/assetPath 获取资产本体
  3. 加载/装配资产（SKILL/RULE/HOOKS/知识库）到本项目工作上下文

收尾或贡献时（贡献资产）:
  1. 资产在项目仓库中开发完成（含版本号）
  2. 用户指引下 register/update 登记资产元数据到总图谱目录
  3. 图谱记录来源 commit，保证可追溯
```
