#!/bin/bash
# =============================================================================
# 联邦注册中心 registry.json 持续同步脚本（服务器 <-> GitHub 主仓）
#
# 背景：
#   - GitHub 主仓（https://github.com/derekhu0002/graph-wiki.git）是唯一事实源。
#   - 服务器 /opt/graph-wiki/assets/registry/registry.json 是运行时状态：
#     registry_register / registry_deregister / registry_authorize 工具写入并
#     在服务器本地 git 自动 commit（见 asset-mcp-server.js 的 gitCommit），
#     但服务器本身无 GitHub 凭据、不 push。
#   - 本脚本在「持有 GitHub push 凭据」的机器（开发机 / CI）上运行，把两者对齐。
#
# 用法（在 graph-wiki 仓库根目录，或通过 REPO_DIR 指定本地克隆）:
#   bash mcp/registry-sync.sh push   # 服务器 -> GitHub（回补 / 持续同步，幂等）
#   bash mcp/registry-sync.sh pull   # GitHub -> 服务器（多设备 pull 对齐）
#
# 环境变量:
#   SSH_HOST     服务器地址（默认 root@120.24.114.13）
#   REMOTE_DIR   服务器 graph-wiki 目录（默认 /opt/graph-wiki）
#   REPO_DIR     本地 graph-wiki 克隆路径（默认脚本所在仓库根）
#
# 定时触发（推荐，在凭据机 crontab 里，幂等、无变化自动跳过）:
#   */5 * * * * cd /path/to/graph-wiki && bash mcp/registry-sync.sh push >> /var/log/registry-sync.log 2>&1
#
# 可选升级（服务器侧真正的「触发式 push」）:
#   给服务器配置 GitHub 只写 deploy key 后，把 asset-mcp-server.js 的 gitCommit
#   追加一步 git push origin main 即可；本脚本仍作为无凭据场景下的兜底。
# =============================================================================
set -euo pipefail

SSH_HOST="${SSH_HOST:-root@120.24.114.13}"
REMOTE_DIR="${REMOTE_DIR:-/opt/graph-wiki}"
REMOTE_REGISTRY="$REMOTE_DIR/assets/registry/registry.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LOCAL_REGISTRY="$REPO_DIR/assets/registry/registry.json"

MODE="${1:-push}"
case "$MODE" in
  push|pull) ;;
  *) echo "用法: bash mcp/registry-sync.sh [push|pull]" >&2; exit 2 ;;
esac

# 1. 本地仓库先与 GitHub 对齐（消分歧：有分叉则 rebase）
echo "==> 对齐本地仓库与 GitHub 主仓"
git -C "$REPO_DIR" fetch origin --prune
git -C "$REPO_DIR" pull --rebase origin main

if [ "$MODE" = "push" ]; then
  # 2a. 服务器 -> GitHub
  echo "==> [push] 服务器 -> GitHub"
  scp -o BatchMode=yes "$SSH_HOST:$REMOTE_REGISTRY" "$LOCAL_REGISTRY"
  git -C "$REPO_DIR" add assets/registry/registry.json
  if git -C "$REPO_DIR" diff --cached --quiet; then
    echo "    无变化，跳过提交"
    exit 0
  fi
  git -C "$REPO_DIR" commit -m "feat(registry): sync live registry state from server"
  git -C "$REPO_DIR" push origin main
  echo "    已推送: $(git -C "$REPO_DIR" rev-parse HEAD)"
else
  # 2b. GitHub -> 服务器（多设备 pull 对齐）
  echo "==> [pull] GitHub -> 服务器"
  if [ ! -f "$LOCAL_REGISTRY" ]; then
    echo "本地 registry.json 不存在，中止" >&2
    exit 1
  fi
  scp -o BatchMode=yes "$LOCAL_REGISTRY" "$SSH_HOST:$REMOTE_REGISTRY"
  # 服务器本地 git 补一笔 commit 保持其本地历史一致（失败不阻断）
  ssh -o BatchMode=yes "$SSH_HOST" \
    "cd '$REMOTE_DIR' && git add assets/registry/registry.json && { git diff --cached --quiet || git commit -m 'chore(registry): pull from GitHub main'; }" || true
  echo "    已同步到服务器"
fi
