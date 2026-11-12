# 识海 · 项目说明材料

> **English summary** — This is the design and verification record of Shihai, a long-term
> memory plugin for the DeepSeek Harness (DSH) agent. It covers what the plugin stores,
> how retrieval ranks memories, how forgetting and archiving work, how confidence and
> revised facts are handled, how mood affects ordering, what was measured (latency,
> recall, throughput at large scale), the failure modes found during development, and the
> limits that remain. Written for whoever has to maintain it after me. The full text is in
> Chinese; the install command is `dsh plugin --profile web add dsh-consciousness2`.
>
> 全文中文。下面起是正文。

---

