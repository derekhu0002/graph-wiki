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
: "${ARGO_ROOT:=$HOME/.argo}"
: "${ARGO_VERSION:=}"
: "${NPM_REGISTRY:=https://registry.npmmirror.com}"
: "${NODE_VERSION:=v22.11.0}"
: "${INSTALL_WEB:=true}"
: "${WEB_HOST:=127.0.0.1}"
: "${WEB_PORT:=18793}"
: "${WEB_BASE:=/archgraph/}"

NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
log() { echo -e "\n==> $*"; }

log "PKG_DIR=$PKG_DIR  DATA_DIR=$DATA_DIR"

# ---------------------------------------------------------------------------
# 0. 数据目录（writable）+ 规范化配置
# ---------------------------------------------------------------------------
log "[0] 初始化数据目录 $DATA_DIR"
mkdir -p "$DATA_DIR/assets" "$DATA_DIR/mirrors" "$DATA_DIR/logs"
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
ARGO_ROOT=${ARGO_ROOT}
ARGO_NPM_PACKAGE=${ARGO_NPM_PACKAGE}
ARGO_VERSION=${ARGO_VERSION}
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

  # 引擎配置（Neo4j 凭据 / embedding / QWEN_KEY / gates / rerank）归 **ARGO 自己的 ~/.argo/.env**，
  # 由 ARGO 引擎直接消费；Graph Store 的 env 只承载服务拓扑（host/port/engine URL/log dir），不承载引擎密钥。
  # 安装器在此仅为 provision 本机 Neo4j 容器读取/生成所需密码，并对显式提供的引擎配置做合并写入。
  ENV_FILE_ARG="$ARGO_ROOT/.env"
  [ -f "$ENV_FILE_ARG" ] && cp "$ENV_FILE_ARG" "${ENV_FILE_ARG}.bak.$(date +%s)"
  argo_env_get() { [ -f "$ENV_FILE_ARG" ] && sed -n "s/^$1=//p" "$ENV_FILE_ARG" | tail -n1; }
  set_kv() {
    local k="$1" v="$2"
    [ -z "$v" ] && return   # 空值不写（避免把已有值清空/写坏）
    if [ -f "$ENV_FILE_ARG" ] && grep -q "^${k}=" "$ENV_FILE_ARG"; then
      sed -i "s#^${k}=.*#${k}=${v}#" "$ENV_FILE_ARG"
    else
      echo "${k}=${v}" >> "$ENV_FILE_ARG"
    fi
  }

  # Neo4j 密码：显式 env > ~/.argo/.env > 生成随机（写回 ARGO env，供容器与引擎一致使用）。
  NEO4J_PASSWORD="${NEO4J_PASSWORD:-$(argo_env_get ARGO_NEO4J_DATABASE_PASSWORD)}"
  if [ -z "$NEO4J_PASSWORD" ]; then
    NEO4J_PASSWORD="$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "NOTE: 已在 $ENV_FILE_ARG 生成 Neo4j 密码（ARGO 引擎配置；Graph Store env 无需保存）"
  fi
  set_kv ARGO_NEO4J_DATABASE_URL "neo4j://127.0.0.1:7687"
  set_kv ARGO_NEO4J_DATABASE_USERNAME "${NEO4J_USER}"
  set_kv ARGO_NEO4J_DATABASE_PASSWORD "${NEO4J_PASSWORD}"

  # embedding / 语义生命周期：仅当显式提供或 ARGO env 已有配置时维护；缺失只提示，不报错、不阻塞部署。
  if [ -n "${QWEN_KEY:-}" ] || [ -n "$(argo_env_get QWEN_KEY)" ]; then
    set_kv ARGO_EMBEDDING_BASE_URL "${ARGO_EMBEDDING_BASE_URL:-$(argo_env_get ARGO_EMBEDDING_BASE_URL)}"
    set_kv ARGO_EMBEDDING_MODEL "${ARGO_EMBEDDING_MODEL:-$(argo_env_get ARGO_EMBEDDING_MODEL)}"
    set_kv ARGO_EMBEDDING_PROVIDER "alibaba-cloud-model-studio-openai-compatible-cn-beijing"
    set_kv ARGO_EMBEDDING_DIMENSIONS "${ARGO_EMBEDDING_DIMENSIONS:-$(argo_env_get ARGO_EMBEDDING_DIMENSIONS)}"
    set_kv QWEN_KEY "${QWEN_KEY:-}"
    # 语义生命周期：两个 gate 必须同时为 1（或同时关闭），否则 embedding 不执行。
    set_kv ARGO_LIVE_PROVIDER_E2E "1"
    set_kv ARGO_W31_LIVE_MUTATION_VECTOR_E2E "1"
    set_kv ARGO_EMBEDDING_MODEL_VERSION "${ARGO_EMBEDDING_MODEL_VERSION:-$(argo_env_get ARGO_EMBEDDING_MODEL_VERSION)}"
    set_kv ARGO_SEMANTIC_HYBRID "${ARGO_SEMANTIC_HYBRID:-$(argo_env_get ARGO_SEMANTIC_HYBRID)}"
    set_kv ARGO_SEMANTIC_MEMORY_THRESHOLD "${ARGO_SEMANTIC_MEMORY_THRESHOLD:-$(argo_env_get ARGO_SEMANTIC_MEMORY_THRESHOLD)}"
    # rerank：显式提供或 ARGO env 已有 key 才开启；两者皆无才关闭。
    if [ -n "${ARGO_RERANK_API_KEY:-}" ]; then
      set_kv ARGO_RERANK_API_KEY "${ARGO_RERANK_API_KEY}"
      set_kv ARGO_RERANK_BASE_URL "${ARGO_RERANK_BASE_URL:-$(argo_env_get ARGO_RERANK_BASE_URL)}"
      set_kv ARGO_RERANK_MODEL "${ARGO_RERANK_MODEL:-$(argo_env_get ARGO_RERANK_MODEL)}"
      set_kv ARGO_RERANK_PROVIDER "${ARGO_RERANK_PROVIDER:-$(argo_env_get ARGO_RERANK_PROVIDER)}"
      set_kv ARGO_SEMANTIC_RERANK "1"
    elif [ -z "$(argo_env_get ARGO_RERANK_API_KEY)" ]; then
      set_kv ARGO_SEMANTIC_RERANK "0"
    fi
  else
    echo "NOTE: 未检测到 embedding 配置（QWEN_KEY）。引擎可运行，但语义检索不可用；"
    echo "      请在 ~/.argo/.env 配置 ARGO 引擎侧参数（graph-store.env 不需要这些密钥）。"
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
      -e "s#__ARGO_ROOT__#${ARGO_ROOT}#g" \
      -e "s#__ARGO_NPM_PACKAGE__#${ARGO_NPM_PACKAGE}#g" \
      -e "s#__ARGO_VERSION__#${ARGO_VERSION}#g" \
      -e "s#__WEB_HOST__#${WEB_HOST}#g" \
      -e "s#__WEB_PORT__#${WEB_PORT}#g" \
      -e "s#__WEB_BASE__#${WEB_BASE}#g" \
      "$1" > "/etc/systemd/system/$(basename "$1")"
}
install_unit "$PKG_DIR/deploy/systemd/asset-mcp.service"
install_unit "$PKG_DIR/deploy/systemd/sync-mirrors.service"
install_unit "$PKG_DIR/deploy/systemd/sync-mirrors.timer"
install_unit "$PKG_DIR/deploy/systemd/graph-store-patrol.service"
install_unit "$PKG_DIR/deploy/systemd/graph-store-patrol.timer"
[ "$INSTALL_ENGINE" = "true" ] && install_unit "$PKG_DIR/deploy/systemd/argo-mirror-engine.service"
[ "$INSTALL_WEB" = "true" ] && install_unit "$PKG_DIR/deploy/systemd/graph-store-web.service"
systemctl daemon-reload

log "[3] 启动服务"
# enable --now 不会重启已在运行的服务（改配置后不生效），因此先 enable 再 restart。
enable_restart() { systemctl enable "$1" >/dev/null 2>&1 || true; systemctl restart "$1"; }
if [ "$INSTALL_ENGINE" = "true" ]; then enable_restart argo-mirror-engine; fi
enable_restart asset-mcp
systemctl enable --now sync-mirrors.timer
systemctl enable --now graph-store-patrol.timer
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
