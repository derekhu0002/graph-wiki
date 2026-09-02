# ARGO 知识图谱操作技能

通过 ARGO MCP 工具读写意图知识图谱的技能。适用于需要读写架构知识图谱的 Agent。

## 能力

- 语义查询图谱（`getSystemArchitecture`）
- 获取元素上下文（`getIntentElementContext`）
- 图谱变更（add/update/remove 元素、关系、视图）
- 图谱校验与验收测试

## 使用要点

1. 查询图谱时始终提供 `query.purpose` + `query.intent`。
2. 变更前用 `previewSystemArchitectureMutation` 预览，再 `applySystemArchitectureMutation`。
3. 变更完成后 git 提交并登记 commit id。

## 来源

- 版本: 1.0.0
- 仓库: graph-wiki
- 提交: 见 catalog.json
