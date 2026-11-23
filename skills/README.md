# Agent skills

This folder ships an agent-facing skill definition for Shihai (识海), the local long-term
memory server.

- `shihai-memory/SKILL.md` — the skill file. YAML frontmatter (`name`, `description`) plus
  instructions telling an agent when to call which memory tool.

## Use with Claude Code

Copy the folder into your skills directory:

```bash
mkdir -p ~/.claude/skills
cp -r skills/shihai-memory ~/.claude/skills/
```

Claude Code will pick it up on the next session. The skill assumes the server is running
(`npm i -g shihai-mcp && shihai start`); it does not start it for you.

## Use with any MCP client

The skill is documentation, not the server itself. Point your MCP client at
`shihai mcp` (stdio) and the agent gets the tools; `SKILL.md` just explains when to use them.
