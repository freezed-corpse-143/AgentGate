#Requires -Version 7.0
# ──────────────────────────────────────────────────────────
# AgentGate MCP Server — 注册到 Claude Code (user scope)
# 用法: .\install.ps1 [[-AgentId] <string>]
# ──────────────────────────────────────────────────────────

param(
  [Parameter(Position = 0)]
  [string]$AgentId = $env:AGENTGATE_DEFAULT_AGENT
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$McpServer = Join-Path $ScriptDir "dist" "mcp_server.js"

if (-not (Test-Path $McpServer)) {
  Write-Error "未找到 $McpServer"
  Write-Error "请确保在 AgentGate 项目根目录运行此脚本。"
  exit 1
}

if (-not $AgentId) {
  $AgentId = "default"
}

Write-Host "[AgentGate] 注册 MCP Server 到 Claude Code (user scope)..." -ForegroundColor Cyan
Write-Host "   Server: $McpServer"
Write-Host "   Agent ID: $AgentId"

# Windows 路径需要反斜杠转义？不需要 — claude CLI 自己处理
claude mcp add agentscope --scope user -- `
  node "$McpServer" `
  --agent-id "$AgentId"

Write-Host ""
Write-Host "[AgentGate] ✅ 完成！已在 ~/.claude.json 中添加 agentscope 服务。" -ForegroundColor Green
Write-Host "   启动 Claude Code 后即可通过 MCP 工具与 AgentGate 交互。"
