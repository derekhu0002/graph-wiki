#!/usr/bin/env bash
# =============================================================================
# Graph Store + ARGO Mirror Engine — one-command installer
#
# Typical flow (NPM form):
#   npm i -g graph-store@<version>
#   graph-store deploy                 # reads deploy/graph-store.env (bundled) or --config
#
# Or from a git checkout:
#   cp deploy/graph-store.env.example deploy/graph-store.env && sudo bash deploy/install-graph-store.sh
#
# Layout:
#   PKG_DIR  = where this package's code lives (mcp/, deploy/)   [GRAPH_STORE_PKG_DIR]
#   DATA_DIR = writable runtime data (assets/, git, mirrors, env) [GRAPH_STORE_DATA_DIR, default /opt/graph-store]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="${GRAPH_STORE_PKG_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DATA_DIR="${GRAPH_STORE_DATA_DIR:-/opt/graph-store}"

# ---- 解析 --config ----
CONFIG_FILE="${GRAPH_STORE_ENV_FILE:-}"
args=("$@")
for i in "${!args[@]}"; do
  if [ "${args[$i]}" = "--config" ] && [ -n "${args[$((i+1))]:-}" ]; then CONFIG_FILE="${args[$((i+1))]}"; fi
done
[ -z "$CONFIG_FILE" ] && [ -f "$PKG_DIR/deploy/graph-store.env" ] && CONFIG_FILE="$PKG_DIR/deploy/graph-store.env"
if [ -n "$CONFIG_FILE" ] && [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$CONFIG_FILE"; set +a
fi

: "${GRAPH_STORE_HOST:=127.0.0.1}"
: "${GRAPH_STORE_PORT:=18792}"
: "${INSTALL_ENGINE:=true}"
: "${MIRROR_HOST:=127.0.0.1}"
: "${MIRROR_PORT:=18801}"
: "${MIRROR_ENGINE_URL:=http://${MIRROR_HOST}:${MIRROR_PORT}}"
: "${NEO4J_IMAGE:=neo4j:5.26-enterprise}"
: "${NEO4J_USER:=neo4j}"
: "${NEO4J_PASSWORD:=}"
: "${NEO4J_HEAP:=1g}"
: "${NEO4J_PAGECACHE:=512m}"
: "${ARGO_NPM_PACKAGE:=archgraph-argo}"
: "${NPM_REGISTRY:=https://registry.npmmirror.com}"
: "${NODE_VERSION:=v22.11.0}"
: "${INSTALL_WEB:=true}"
: "${WEB_HOST:=127.0.0.1}"
: "${WEB_PORT:=18793}"
: "${WEB_BASE:=/archgraph/}"

ARGO_ROOT="${HOME}/.argo"
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
log() { echo -e "\n==> $*"; }

log "PKG_DIR=$PKG_DIR  DATA_DIR=$DATA_DIR"

# ---------------------------------------------------------------------------
# 0. 数据目录（writable）+ 规范化配置
# ---------------------------------------------------------------------------
log "[0] 初始化数据目录 $DATA_DIR"
mkdir -p "$DATA_DIR/assets" "$DATA_DIR/mirrors"
if [ ! -d "$DATA_DIR/.git" ]; then git init -q "$DATA_DIR" 2>/dev/null || true; fi
cat > "$DATA_DIR/graph-store.env" <<EOF
GRAPH_STORE_HOST=${GRAPH_STORE_HOST}
GRAPH_STORE_PORT=${GRAPH_STORE_PORT}
MIRROR_HOST=${MIRROR_HOST}
MIRROR_PORT=${MIRROR_PORT}
MIRROR_ENGINE_URL=${MIRROR_ENGINE_URL}
WEB_HOST=${WEB_HOST}
WEB_PORT=${WEB_PORT}
WEB_BASE=${WEB_BASE}
EOF

# ---------------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "[1] 安装 Node.js $NODE_VERSION ($NPM_REGISTRY)"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/node.tar.xz" "${NPM_REGISTRY}/-/binary/node/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
  tar -xf "$tmp/node.tar.xz" -C /usr/local --strip-components=1
  rm -rf "$tmp"
  NODE_BIN=/usr/local/bin/node
fi
log "[1] node: $($NODE_BIN --version)"

# ---------------------------------------------------------------------------
# 2. ARGO engine + Neo4j + embedding
# ---------------------------------------------------------------------------
if [ "$INSTALL_ENGINE" = "true" ]; then
  log "[2] 安装 ARGO 引擎 ($ARGO_NPM_PACKAGE)"
  npm i -g "$ARGO_NPM_PACKAGE" --registry="$NPM_REGISTRY" >/dev/null
  PKG_ARGO="$(npm root -g)/$ARGO_NPM_PACKAGE/argo"
  mkdir -p "$ARGO_ROOT"
  cp -r "$PKG_ARGO/scripts" "$PKG_ARGO/schema" "$PKG_ARGO/defaults" "$ARGO_ROOT/"
  [ -d "$PKG_ARGO/mcp-bridges" ] && cp -r "$PKG_ARGO/mcp-bridges" "$ARGO_ROOT/"
  cp "$PKG_ARGO/package.json" "$ARGO_ROOT/"
  ( cd "$ARGO_ROOT" && npm install --registry="$NPM_REGISTRY" >/dev/null )

  [ -n "$NEO4J_PASSWORD" ] || { echo "ERROR: 请设置 NEO4J_PASSWORD"; exit 1; }
  [ -n "${QWEN_KEY:-}" ] || { echo "ERROR: 请设置 QWEN_KEY"; exit 1; }

  # 合并式写入 ~/.argo/.env：保留已有键（如 rerank 等），仅设置/覆盖我们负责的键。
  ENV_FILE_ARG="$ARGO_ROOT/.env"
  [ -f "$ENV_FILE_ARG" ] && cp "$ENV_FILE_ARG" "${ENV_FILE_ARG}.bak.$(date +%s)"
  set_kv() {
    local k="$1" v="$2"
    if [ -f "$ENV_FILE_ARG" ] && grep -q "^${k}=" "$ENV_FILE_ARG"; then
      sed -i "s#^${k}=.*#${k}=${v}#" "$ENV_FILE_ARG"
    else
      echo "${k}=${v}" >> "$ENV_FILE_ARG"
    fi
  }
  set_kv ARGO_EMBEDDING_BASE_URL "${ARGO_EMBEDDING_BASE_URL:-}"
  set_kv ARGO_EMBEDDING_MODEL "${ARGO_EMBEDDING_MODEL:-qwen3.7-text-embedding}"
  set_kv ARGO_EMBEDDING_PROVIDER "alibaba-cloud-model-studio-openai-compatible-cn-beijing"
  set_kv ARGO_EMBEDDING_DIMENSIONS "${ARGO_EMBEDDING_DIMENSIONS:-1536}"
  set_kv ARGO_NEO4J_DATABASE_URL "neo4j://127.0.0.1:7687"
  set_kv ARGO_NEO4J_DATABASE_USERNAME "${NEO4J_USER}"
  set_kv ARGO_NEO4J_DATABASE_PASSWORD "${NEO4J_PASSWORD}"
  set_kv QWEN_KEY "${QWEN_KEY}"
  # 语义生命周期：两个 gate 必须同时为 1（或同时关闭），否则 embedding 不执行。
  set_kv ARGO_LIVE_PROVIDER_E2E "1"
  set_kv ARGO_W31_LIVE_MUTATION_VECTOR_E2E "1"
  set_kv ARGO_EMBEDDING_MODEL_VERSION "${ARGO_EMBEDDING_MODEL_VERSION:-}"
  set_kv ARGO_SEMANTIC_HYBRID "${ARGO_SEMANTIC_HYBRID:-0}"
  set_kv ARGO_SEMANTIC_MEMORY_THRESHOLD "${ARGO_SEMANTIC_MEMORY_THRESHOLD:-0.70}"
  # rerank 可选：提供 ARGO_RERANK_API_KEY 才开启，否则关闭（只用 Qwen embedding 检索）。
  if [ -n "${ARGO_RERANK_API_KEY:-}" ]; then
    set_kv ARGO_RERANK_API_KEY "${ARGO_RERANK_API_KEY}"
    set_kv ARGO_RERANK_BASE_URL "${ARGO_RERANK_BASE_URL:-}"
    set_kv ARGO_RERANK_MODEL "${ARGO_RERANK_MODEL:-}"
    set_kv ARGO_RERANK_PROVIDER "${ARGO_RERANK_PROVIDER:-}"
    set_kv ARGO_SEMANTIC_RERANK "1"
  else
    set_kv ARGO_SEMANTIC_RERANK "0"
  fi
  chmod 600 "$ENV_FILE_ARG"

  log "[2] 启动 Neo4j ($NEO4J_IMAGE)"
  mkdir -p /opt/argo-neo4j/data /opt/argo-neo4j/logs
  docker rm -f argo-neo4j >/dev/null 2>&1 || true
  docker run -d --name argo-neo4j --restart unless-stopped \
    -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 \
    -e NEO4J_ACCEPT_LICENSE_AGREEMENT=yes \
    -e NEO4J_AUTH="${NEO4J_USER}/${NEO4J_PASSWORD}" \
    -e NEO4J_server_memory_heap_max__size="${NEO4J_HEAP}" \
    -e NEO4J_server_memory_pagecache_size="${NEO4J_PAGECACHE}" \
    -v /opt/argo-neo4j/data:/data -v /opt/argo-neo4j/logs:/logs \
    "$NEO4J_IMAGE" >/dev/null

  if [ -n "${GITHUB_TOKEN:-}" ]; then
    printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" > "$HOME/.git-credentials"
    chmod 600 "$HOME/.git-credentials"
    git config --global credential.helper store || true
  fi
fi

# ---------------------------------------------------------------------------
# 3. systemd units
# ---------------------------------------------------------------------------
log "[3] 安装 systemd 单元"
install_unit() {
  sed -e "s#__PKG__#${PKG_DIR}#g" \
      -e "s#__DATA__#${DATA_DIR}#g" \
      -e "s#__HOME__#${HOME}#g" \
      -e "s#__NODE__#${NODE_BIN}#g" \
      -e "s#__GRAPH_STORE_HOST__#${GRAPH_STORE_HOST}#g" \
      -e "s#__GRAPH_STORE_PORT__#${GRAPH_STORE_PORT}#g" \
      -e "s#__MIRROR_ENGINE_URL__#${MIRROR_ENGINE_URL}#g" \
      -e "s#__MIRROR_HOST__#${MIRROR_HOST}#g" \
      -e "s#__MIRROR_PORT__#${MIRROR_PORT}#g" \
      -e "s#__WEB_HOST__#${WEB_HOST}#g" \
      -e "s#__WEB_PORT__#${WEB_PORT}#g" \
      -e "s#__WEB_BASE__#${WEB_BASE}#g" \
      "$1" > "/etc/systemd/system/$(basename "$1")"
}
install_unit "$PKG_DIR/deploy/systemd/asset-mcp.service"
install_unit "$PKG_DIR/deploy/systemd/sync-mirrors.service"
install_unit "$PKG_DIR/deploy/systemd/sync-mirrors.timer"
[ "$INSTALL_ENGINE" = "true" ] && install_unit "$PKG_DIR/deploy/systemd/argo-mirror-engine.service"
[ "$INSTALL_WEB" = "true" ] && install_unit "$PKG_DIR/deploy/systemd/graph-store-web.service"
systemctl daemon-reload

log "[3] 启动服务"
# enable --now 不会重启已在运行的服务（改配置后不生效），因此先 enable 再 restart。
enable_restart() { systemctl enable "$1" >/dev/null 2>&1 || true; systemctl restart "$1"; }
if [ "$INSTALL_ENGINE" = "true" ]; then enable_restart argo-mirror-engine; fi
enable_restart asset-mcp
systemctl enable --now sync-mirrors.timer
[ "$INSTALL_WEB" = "true" ] && enable_restart graph-store-web

# ---------------------------------------------------------------------------
# 4. 健康检查
# ---------------------------------------------------------------------------
log "[4] 健康检查"
sleep 2
echo -n "asset-mcp  : "; curl -s --max-time 5 "http://${GRAPH_STORE_HOST}:${GRAPH_STORE_PORT}/health" || echo "(未就绪)"
echo
if [ "$INSTALL_ENGINE" = "true" ]; then
  echo -n "mirror-eng : "; curl -s --max-time 5 "http://${MIRROR_HOST}:${MIRROR_PORT}/health" || echo "(未就绪)"
  echo
fi
if [ "$INSTALL_WEB" = "true" ]; then
  echo -n "web        : "; curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://${WEB_HOST}:${WEB_PORT}${WEB_BASE}" && echo " (${WEB_BASE})"
fi
cat <<EOF

==> 完成。本机监听：
    服务:  http://${GRAPH_STORE_HOST}:${GRAPH_STORE_PORT}/mcp 与 /graph/read
    网站:  http://${WEB_HOST}:${WEB_PORT}${WEB_BASE}
    对外:  由 IT 反代到域名；网站与 /mcp 需**同源**（同一域名下 /archgraph/ 指网站端口，/mcp 指服务端口）。
EOF
