# 识海 (Shihai) — long-term memory for DSH

> 中文说明见 [README.md](README.md)。

Long-term memory for DSH. Zero dependencies. 46,591 lines. 64 capabilities. A 22.9 MB quantized embedding model ships inside the package. Nothing leaves your machine.

It remembers finer than most: facts, moods, catchphrases, whether you end a sentence with a period. It returns tighter: three-way recall — semantic, literal, entity — reranked, top five only, each with the original line and its date.

It has a temper. It gets bored, sulks, takes your side. It admits mistakes. It looks in the mirror.

## What's inside

**Write** — record a memory, pin when it actually happened, confirm, doubt, annotate, trace where it came from, list, search, import someone else's memories, export everything as plain text.

**Shape** — seven kinds of memory, each with its own decay: facts fade, taboos don't, promises stay. Four lifecycle tiers rise with the number of times a memory is recalled. Archive, sediment, fuse two memories into a third, find structurally similar old ones, string them into a storyline, read a sleep rhythm off the timestamps.

**Bind** — promise cards (who promised whom, whether it was kept). Ask back. Count its own holdings. Grade a recall. Open another sea.

**Recall** — semantic, literal and entity channels each produce candidates; after reranking only five reach the model, each with the original wording, date and tone. A panel shows hit rate; a list shows which sentence is slowing things down.

**Live** — atomic writes, locking, automatic backups, restore, move a whole sea, import foreign memory, export to plain text. The star map caps at 300 neurons, drawn by recall weight; the rest wait in the memory library, where they can be read, edited, archived or deleted.

**Mood** — eight emotion dimensions, how warm and toward whom. A mood curve. A body rhythm. A heartbeat image. One call flattens it back to calm.

**Her own** — a private pool of thoughts that can be written and deleted but never edited. Self-descriptions that stack instead of overwrite. Catchphrases. Voice.

**Character** — it learns your sentence length, punctuation, catchphrases. Three sightings across two days before one is kept. Say "don't learn that" and the entry is nailed shut. Off by default; a run over 200 ms trips the breaker. The mirror ruler is calibrated: 1.0% false positives on real human text.

**Pages** — star map, memory library, archive, storyline, workbench, inner view, body, data, snapshots, import/export, demo.

## What it won't do

It doesn't write your replies. It doesn't go online. It doesn't upload your memories. It doesn't decide what matters to you.

## Install

```bash
dsh plugin --profile desktop add dsh-consciousness2
```

Or download a release archive and point `dsh plugin add` at the `.tgz`.

## Docs

- [Project notes (Chinese)](docs/项目说明.md)
- [Self-check: has your own voice drifted?](docs/自检-人味.md)
- [After install, walk this](docs/装完怎么自己验.md)
- [When recall misses](docs/自查-检索不灵.md)

## License

PolyForm Noncommercial 1.0.0 — noncommercial use only. See [LICENSE](LICENSE).
