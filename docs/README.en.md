# 识海 (Sea of Memory) — a long-term memory layer for LLM agents

> Chinese-first. Zero runtime dependencies. Everything stays on your machine.

Large language models forget: when the context window closes, the conversation is gone.
The model does not lack understanding — it lacks **yesterday**.

识海 is a memory layer built as a plugin for [DSH (DeepSeek Harness)](https://www.dsh.so).
It stores memories as points that carry **time, emotion, strength, relations and edges** in one
data model, then injects the few that matter into the next conversation.

## What it does

- **Write** — a memory is a point with a title, a body, a timestamp, an emotional polarity and a
  strength value. Writing goes through one pipeline: lock → dedupe → link edges → conflict check →
  atomic write → backup.
- **Forget** — nothing is deleted. Points decay: untouched memories sink, and rise again when
  recalled or re-linked. Decay parameters are tunable at runtime (no restart).
- **Recall** — hybrid retrieval: literal / pinyin fallback / entity normalisation / FTS / vectors /
  relation edges, then re-ranking by freshness, emotion and strength.
- **Relations** — who promised what, and how a relationship is doing, are stored as their own
  entities rather than as plain facts.
- **Many seas** — each workspace, window or project can have its own isolated sea.
- **Visual** — a star-map page (canvas) renders the sea: points, edges, emotion colours.

## Install

It is a DSH plugin: put the package under your DSH profile and enable it.

```bash
# from a packed tarball
dsh plugin add ./dsh-consciousness2-0.4.8.tgz
```

Requires Node.js only. No Python, no database server. Optional: an ONNX embedding model pack
(`-embed` build) for the vector layer; without it, retrieval still works and says so.

## Local HTTP API (for other programs)

Other programs can query the same memory without DSH:

```bash
node bin/sea-api.mjs --port 8765          # read-only, token required
node bin/sea-api.mjs --port 8765 --allow-write
```

- Binds `127.0.0.1` only.
- A bearer token is generated on first run at `~/.dsh/consciousness-api-token`.
- Endpoints: `GET /health`, `GET /seas`, `POST /search`, `POST /list`, `POST /write`
  (write only with `--allow-write`).
- It calls the **same** tool implementations the agent uses — there is no second retriever,
  so answers cannot diverge.

```bash
TOKEN=$(cat ~/.dsh/consciousness-api-token)
curl -s -X POST http://127.0.0.1:8765/search \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"query":"那个脚本","limit":3}'
```

## Scale

Measured locally (sandbox sea, 2,000 points, 100 queries, one machine):

| metric | value |
| --- | --- |
| search latency p50 | 39 ms |
| search latency p95 | 53 ms |
| single write p50 | 87 ms |
| sea file size (2,000 points) | 0.40 MB |

Reproduce: `node scripts/scale-test.mjs --n 2000 --q 100 --w 20`.

## Tests

```bash
node scripts/selftest-all.mjs   # 45 suites, 3xx assertions
node scripts/regress.mjs        # 38 fixed regression cases
node scripts/selfcheck-install.mjs  # 9 install-environment checks
```

## Honest limits

- One host only (DSH) — the HTTP API above is the first step out, not a general SDK.
- Scale verified on a single machine up to a few thousand points; no high-concurrency runs.
- Chinese documentation only (this file is the first English summary).
- Backups are rolling pre-write copies kept for 14 days, not portable snapshots.
- Retrieval numbers are measured on our own test set; a public benchmark run is still pending.

## Licence

See `LICENSE` in the package.
