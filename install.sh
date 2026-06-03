#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# AgentGate MCP Server — 注册到 Claude Code (user scope)
# 用法: ./install.sh [--agent-id <id>]
# ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER="$SCRIPT_DIR/dist/mcp_server.js"

if [ ! -f "$MCP_SERVER" ]; then
  echo "[ERROR] 未找到 $MCP_SERVER"
  echo "        请确保在 AgentGate 项目根目录运行此脚本。"
  exit 1
fi

AGENT_ID="${1:-${AGENTGATE_DEFAULT_AGENT:-default}}"

echo "[AgentGate] 注册 MCP Server 到 Claude Code (user scope)..."
echo "   Server: $MCP_SERVER"
echo "   Agent ID: $AGENT_ID"

claude mcp add agentgate --scope user -- \
  node "$MCP_SERVER" \
  --agent-id "$AGENT_ID"

echo ""
echo "[AgentGate] ✅ 完成！已在 ~/.claude.json 中添加 agentgate 服务。"
echo "   启动 Claude Code 后即可通过 MCP 工具与 AgentGate 交互。"
