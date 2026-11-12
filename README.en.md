# 识海 (Shihai) — long-term memory for DSH

> 中文说明见 [README.md](README.md)。

A long-term memory orb for the DeepSeek Harness (DSH) agent. Each memory is a neuron:
it brightens when recalled, dims when ignored, sinks when forgotten, and replays
itself when idle. After installing, a gold circle marked 「识」 appears in the sidebar.

## Install

```bash
dsh plugin --profile web add dsh-consciousness2
```

Restart DSH afterwards.

## What it does

- **Remember** — write a memory, search it by word or by meaning; every memory can carry aliases
- **Fade** — rarely touched memories sink; sunk ones are archived and can be brought back
- **Confidence** — each memory carries a confidence score, raised by your confirmation
- **Revised facts** — when you change your mind, both versions stay; the old one is not overwritten
- **Association** — two unrelated old memories can be placed together to yield a third thought
- **Idle recall** — when nothing is asked, it revisits old entries and only mentions what fits
- **Restraint** — a memory may surface and still be left unsaid
- **Mood** — a small emotional state (valence / arousal / dominance) shifts which memories come first
- **Timeline, promises, rhythm** — a month-by-month story, agreements that stay open until kept, and a sense of when you usually show up

Panels: constellation (thousands of edges), inner view (eight affect values),
body (a dozen live metrics incl. ECG and endocrine), story line, archive, workbench, snapshots.

## Requirements

- DSH 0.2.x
- Node.js 22+
- No Python, no PyTorch, no network at runtime. Embeddings ship as a quantized
  bge-small-zh model plus a WASM runtime, computed locally.

## Licence

PolyForm Noncommercial 1.0.0 — see [LICENSE](LICENSE).
Source-available, not open source: use it, study it, modify it for yourself.
Do not sell it, do not re-publish it under another name. Ask first.
