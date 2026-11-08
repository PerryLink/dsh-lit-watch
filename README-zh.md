# dsh-lit-watch

**这次检索相比上次新增了什么——而且只报新增。**

*保存带时间窗口的 Crossref 文献检索；用已见 DOI 库保证重复运行只返回真正新增的条目；输出 Markdown 摘要 + SARIF。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24.9-brightgreen.svg)]()

[English](README.md) · 简体中文

---

## 它做什么

- **`lit_watch_add`** — 保存一个具名监视项：Crossref `query.bibliographic` 查询串、可选的额外过滤条件（`type:journal-article`）、固定的 `since` 日期和返回行数。
- **`lit_watch_run`** — 查询 Crossref，只保留本地已见库中没有的 DOI，记录实际使用的 URL，推进时间窗口，并追加写入 `runs.jsonl`。网络失败会按监视项分别报告，且**不会推进**该监视项。
- **`lit_watch_report`** — Markdown 摘要（每个监视项一张表）+ 针对新增条目的 SARIF 2.1.0 提示。

## 已验证的数据源能力

`GET /works?query.bibliographic=…&filter=from-pub-date:…&rows=…&select=…` 已于 2026-11-08 在线验证（HTTP 200，`total-results` 与条目均可解析）。插件严格使用这一请求形式；每次运行都会保存 URL，以便摘要可以复现。

## 它不做什么

- **不做相关性判断。** 监视项是 `日期窗口 × 查询`；新增 ≠ 重要，而且受 Crossref 收录范围与更新延迟影响。
- **不取全文、不取摘要、不取被引次数。** 只返回 `select` 中请求的字段。
- **不做邮件/webhook 告警。** 运行由调用方驱动（宿主调度器或用户）。
- **不接 Crossref 以外的来源。** PubMed/arXiv/CNKI 监视不在范围内。
- **不写 REP 证据。** 状态保存在本地 JSON（`watches.json`、`seen.json`、`runs.jsonl`），不是 REP 记录；这一点明确说明，不做暗示。

## 时间窗口

- 监视项首次运行：除非该监视项设置了 `since`，否则不带 `from-pub-date`。
- 后续运行：`since = 上次成功运行日期 − 1 天`（重叠一天），这样晚收录的文献不会被漏掉；已见库会去掉重叠产生的重复项。
- 运行失败时 `lastRunAt` 保持不变，因此下次运行会重新覆盖这段时间，而不是直接跳过。

## 工具

### `lit_watch_add`

`{ name, query, filter?, since?, rows?, replace? }` → `{ ok, watch }`.

### `lit_watch_run`

`{ name?, fresh? }` → `{ ok, runs, totalNew, warnings }`.

### `lit_watch_report`

`{ runs? }`（默认：取历史中最近 50 条）→ `{ ok, markdown, sarif }`.

### 错误码

工具失败：`INVALID_INPUT` · `WATCH_UNKNOWN` · `WATCH_EXISTS` · `LIMIT` · `STORE_ERROR`。

每个监视项的运行错误（位于 `runs[].error` 内）：`blocked_host` · `invalid_url` · `too_many_redirects` · `timeout` · `http_error` · `invalid_response` · `network_error`。

## 兼容性与安装

| | |
|---|---|
| DeepSeek Harness | **`dsh-v0.2.1-rc.5`**（2026-11-08 实测）；peer `>=0.2.1-0 <0.3.0 \|\| >=0.2.2-0 <0.3.0` |
| Node | `^22.19.0 \|\| >=24.9.0`（实测 `24.22.1`），仅 ESM |
| Peer 依赖 | `@perrylink/dsh-research-core ^0.1.0`、`@deepseek-ai/cordis ^4.0.5-alpha.1`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery ^3.18.5-alpha.1` |
| 运行时依赖 | **零** |

```sh
dsh plugin --profile <name> add @perrylink/dsh-research-core dsh-lit-watch
dsh --profile <name> --dump-config | grep dsh-lit-watch
```


> **家族统一 peer 说明：** 尽管本包运行时不 import，`@perrylink/dsh-research-core` 仍作为 peer 声明，以保证整个研究插件家族使用同一套安装契约。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | `false` 时不挂载任何内容 |
| `root` | `.lit-watch` | 监视项、已见库、运行历史、缓存 |
| `userAgent` / `mailto` | `dsh-lit-watch/0.1.0 …` / — | Crossref polite pool |
| `timeoutMs` / `minIntervalMs` | `15000` / `150` | 请求超时与频率下限 |
| `retries` / `maxRedirects` | `1` / `3` | 有界重试/重定向 |
| `cacheTtlMs` | `21600000` | 6 小时响应缓存（`fresh` 可绕过） |
| `maxResults` / `maxWatches` | `100` / `50` | 行数上限与监视项上限 |

## 安全边界

- 仅 HTTPS，精确 host 白名单（`api.crossref.org`），手动跟随重定向并逐跳重新校验。
- URL 中不含凭据，不使用自定义端口；除查询文本外不发送任何用户数据。
- 非 2xx 状态和非 JSON 响应体会让该监视项失败，而不是被当成空结果；响应缓存以实际 URL 的 SHA-256 为键。
- 监视文件是本地 JSON；只在 `root` 下写入。

## 评测

**30 个测试**：URL 构造（查询、组合过滤、mailto）、日期/名称校验（含不存在的日历日期）、条目解析（DOI/标题必填，年份/期刊/作者）与畸形响应拒绝、大小写不敏感的差异比较、运行时三次运行的去重（2 → 0 → 1 条新增）及窗口推进、精确 URL 缓存命中、`fresh` 绕过与拒绝缓存畸形响应体、本地网络故障隔离（窗口不推进）、监视项替换/未知/上限、损坏存储拒绝、摘要 + 历史、HTTP 边界（白名单、逐跳重定向复验、重定向上限、非 2xx 拒绝、429 重试、超时、限速）、工具 schema、add→run→report 端到端、失败分支、插件契约、包契约。

不宣称任何基准成绩：其价值在于对固定已见库做差异比较的正确性，测试已经把这一点固定下来；没有人工标注的相关性语料。

## 已知限制（v0.1）

- `query.bibliographic` 的排序由 Crossref 决定；监视项可能漏掉排在 `rows` 之外的相关条目。
- 除原样透传 Crossref `filter` 外，不提供 ORCID/机构过滤。
- 不按标题去重（无 DOI 的记录按设计跳过）。
- 已见库会随每个新 DOI 增长；v0.1 没有自动清理机制。

## 许可

Apache-2.0。运行时零第三方代码。
