# 贡献指南（Contributing Guide）

> 如何向 ArchGraph 共建共享社区贡献/获取架构子图。

## 参与者角色

- **维护者（Maintainer）**：审核子图质量、维护规范、治理仓库
- **贡献者（Contributor）**：把项目意图图裁剪成子图，`graph_submit` 共享
- **使用者（Consumer）**：`graph_list` / `graph_get` 获取他人子图复用

## 基础设施

| 项 | 地址/说明 |
|---|---|
| 社区图谱库仓库 | https://github.com/derekhu0002/graph-wiki |
| 远程 MCP 服务 | https://argo.derekworkspacev5.com/mcp |
| 本机接入配置 | opencode.json `mcp.graph-mcp` 指向上述 URL |

## 一、获取子图（Consume）

```jsonc
// 你的 Agent 配置了 graph-mcp 后，在会话中调用：
graph_list                        // 看社区有哪些子图
graph_get { id: "abot-overseer-capability-001" }  // 获取整张图
```

获取后可将子图作为：项目开工的架构基线 / 能力设计参考 / 治理模式借鉴。

## 二、贡献子图（Contribute）

### 步骤

1. **裁剪**：从你的项目意图图中，切出一块有独立复用价值的子图
   （能力/角色/治理/业务，见 `SUBGRAPH-SPEC.md`）
2. **校验**：确保通过 ARCHGRAPH schema（服务提交时自动校验，也可本地先自查）
3. **提交**：
   ```jsonc
   // graph_submit
   { id: "myproj-mydomain-capability-001", graph: { ...你的子图... },
     name: "子图名称", version: "1.0.0", description: "复用价值说明",
     sourceRepo: "https://github.com/you/myproject", sourceCommit: "abc123" }
   ```
4. **成功** → 服务自动写入资产库 + git commit，子图对全社区可见

### 更新已有子图

```jsonc
// graph_update（id 不存在会报错提示用 submit）
graph_update { id: "myproj-mydomain-capability-001", graph: { ...新版... }, version: "1.1.0" }
```

## 三、提交规范速查

- id 命名：`<project>-<domain>-<type>-<seq>`（见 `SUBGRAPH-SPEC.md` §3）
- description 说明复用价值
- 类型/关系语义准确（少用 Association 兜底）
- 子图聚焦单一主题，元素 ≤ 15
- 校验不通过 → 服务返回 errors，修正后重试（不会入库脏数据）

## 四、本地开发与自测

```bash
# 本地起服务（需 git 仓库 + assets/）
cd graph-wiki
git config user.name "graph-mcp"
git config user.email "graph-mcp@localhost"
ASSET_REPO_ROOT=$(pwd) ASSET_MCP_PORT=18792 node mcp/asset-mcp-server.js

# 用一个测试子图验证 submit
curl -X POST http://127.0.0.1:18792/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"graph_list","arguments":{}}}'
```

## 五、行为约定

- 只提交你有权共享的内容（自己的项目子图）
- 不提交含敏感/密钥信息的图
- 尊重来源：复用他图时保留 sourceRepo/sourceCommit 引用
- 大范围重构前先与维护者沟通
