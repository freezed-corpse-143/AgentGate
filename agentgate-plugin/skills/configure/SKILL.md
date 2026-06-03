---
name: configure
description: Configure AgentGate — check status, set default agent, view connected channels.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---
# /agentgate:configure — AgentGate Setup

Manage the AgentGate channel configuration.

Arguments passed: `$ARGUMENTS`

## No args — show status

Read AgentGate state and display:
- Default agent
- Active conversations count
- Connected channels

## `status` — detailed status

Show full system status including agent registry and bus state.
