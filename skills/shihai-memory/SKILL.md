---
name: shihai-memory
description: Long-term memory for the user across sessions. Use when the user says "remember this", "do you remember", asks about something discussed in a past conversation, or when the user's preferences, history, or personal context would change your answer. Stores memories locally on the user's machine; nothing leaves it.
---

# 识海 / Shihai — long-term memory for any AI

A local memory store the agent can write to and read from. Each memory is a node with a
date, a title, the original words, and optional emotional metadata. Nothing is uploaded;
the store lives in the user's home directory and the embedding model ships inside the
package (22.9 MB, quantized, offline).

## Install (once, on the user's machine)

```bash
npm i -g shihai-mcp
shihai start          # starts the local server on http://127.0.0.1:7788
```

Requirements: Node.js 20 or newer. If `npm` is missing, install Node first.

Verify it works:

```bash
shihai version        # prints the version, e.g. 0.5.4
```

## Connect this agent

**As an MCP server (preferred).** Add to the client config:

```json
{
  "mcpServers": {
    "shihai": {
      "command": "node",
      "args": ["<install-root>/bin/shibai.mjs", "mcp"]
    }
  }
}
```

`<install-root>` is where npm installed the package. Run `npm root -g` to find it, then
append `/shihai-mcp`.

**As an HTTP endpoint (OpenAI-compatible proxy).**

```bash
shihai proxy          # listens on http://127.0.0.1:7789/v1
```

Point the client's base URL at that address to get memory injection without MCP.

## When to call which tool

| Situation | Tool |
| --- | --- |
| User asks you to remember something | `memory_add` |
| User asks "do you remember …" or references the past | `memory_search` (query = what they said, verbatim) |
| You need the most recent memories | `memory_list` |
| User corrects a fact you stored before | `memory_annotate` or `memory_doubt` |
| User confirms a memory is right | `memory_confirm` |
| You need to know when something happened | `memory_date` |
| Before answering about "how many", "what's in it" | `memory_count` |
| User says "forget this" | `memory_archive` |

Search first, never guess. If `memory_search` returns nothing, say so — do not invent a
memory.

## Behaviour rules

1. Search before answering any question about the past. A memory you did not look up does
   not exist.
2. Store the user's own words when possible, plus a short title. One memory = one event.
3. Never write to the user's store during tests or demos; use a scratch sea.
4. Dates matter. If the user says "yesterday" or "last week", resolve it and pass an
   explicit date.

## What it is not

- Not a chat log. It stores distilled memories, not transcripts.
- Not cloud. Nothing leaves the machine; no account, no key, no telemetry.
- Not a persona. It remembers facts and preferences; it does not imitate the user.

## Links

- Source: https://github.com/susu-the-heroine/dsh-consciousness
- npm: https://www.npmjs.com/package/shihai-mcp
- 中文说明 in the package: `README.md`
