#!/bin/bash
# AgentGate tmux session launcher
# Usage: ./tmux_agent.sh <agent-id> [bridge-port]

AGENT_ID="${1:-default}"
SESSION_NAME="agent-${AGENT_ID}"

export AGENTGATE_DEFAULT_AGENT="$AGENT_ID"
export AGENTGATE_BRIDGE_PORT="${2:-0}"
export AGENTGATE_DIR="$HOME/.agentgate"

echo "============================================"
echo " AgentGate Session: ${SESSION_NAME}"
echo " Agent ID:         ${AGENTGATE_DEFAULT_AGENT}"
echo " Bridge Port:      ${AGENTGATE_BRIDGE_PORT}"
echo " Config Dir:       ${AGENTGATE_DIR}"
echo "============================================"
echo ""

# Launch Claude with plugin-dir
exec claude \
  --plugin-dir /home/jiujiu/projects/AgentGate \
  --allowedTools "mcp__agentgate__*" \
  --append-system-prompt "You are ${AGENT_ID}. Use send_message to communicate with other agents."
