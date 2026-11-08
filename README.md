# dsh-lit-watch

**What is new in this search since last time — and only that.**

*Saved Crossref bibliographic queries with time windows, a seen-DOI store so repeated runs return genuinely new items, and a Markdown digest + SARIF.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24.9-brightgreen.svg)]()

English · [简体中文](README-zh.md)

---

## What it does

- **`lit_watch_add`** — save a named watch: a Crossref `query.bibliographic` string, optional extra filters (`type:journal-article`), a fixed `since` date and a row count.
- **`lit_watch_run`** — query Crossref, keep only DOIs not in the local seen store, record the exact URL, advance the time window, and append to `runs.jsonl`. A network failure is reported per watch and **does not advance** that watch.
- **`lit_watch_report`** — Markdown digest (one table per watch) + SARIF 2.1.0 notes for new items.

## Verified provider capability

`GET /works?query.bibliographic=…&filter=from-pub-date:…&rows=…&select=…` was verified live on 2026-11-08 (HTTP 200, `total-results` and items parsed). The plugin uses exactly this form; the URL is stored with every run so a digest can be reproduced.

## What it does not do

- **No relevance judgement.** A watch is a `date window × query`; new ≠ important, and Crossref coverage/lag applies.
- **No full text, no abstracts, no citation counts.** Only the fields requested in `select`.
- **No email/webhook alerts.** Runs are caller-driven (host scheduler or user).
- **No non-Crossref sources.** PubMed/arXiv/CNKI watches are out of scope.
- **No REP evidence.** State is local JSON (`watches.json`, `seen.json`, `runs.jsonl`), not a REP record; this is stated instead of implied.

## Time windows

- First run of a watch: no `from-pub-date` unless the watch has `since`.
- Later runs: `since = last successful run date − 1 day` (overlap), so a publication indexed late is not missed; the seen store removes the overlap duplicates.
- A failed run leaves `lastRunAt` untouched, so the next run re-covers the interval instead of skipping it.

## Tools

### `lit_watch_add`

`{ name, query, filter?, since?, rows?, replace? }` → `{ ok, watch }`.

### `lit_watch_run`

`{ name?, fresh? }` → `{ ok, runs, totalNew, warnings }`.

### `lit_watch_report`

`{ runs? }` (default: last 50 from history) → `{ ok, markdown, sarif }`.

### Error codes

Tool failures: `INVALID_INPUT` · `WATCH_UNKNOWN` · `WATCH_EXISTS` · `LIMIT` · `STORE_ERROR`.

Per-watch run errors (inside `runs[].error`): `blocked_host` · `invalid_url` · `too_many_redirects` · `timeout` · `http_error` · `invalid_response` · `network_error`.

## Compatibility & install

| | |
|---|---|
| DeepSeek Harness | **`dsh-v0.2.1-rc.5`** (verified 2026-11-08); peer `>=0.2.1-0 <0.3.0 \|\| >=0.2.2-0 <0.3.0` |
| Node | `^22.19.0 \|\| >=24.9.0` (tested `24.22.1`), ESM only |
| Peers | `@perrylink/dsh-research-core ^0.1.0`, `@deepseek-ai/cordis ^4.0.5-alpha.1`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/schemastery ^3.18.5-alpha.1` |
| Runtime dependencies | **zero** |

```sh
dsh plugin --profile <name> add @perrylink/dsh-research-core dsh-lit-watch
dsh --profile <name> --dump-config | grep dsh-lit-watch
```

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` mounts nothing |
| `root` | `.lit-watch` | watches, seen store, run history, cache |
| `userAgent` / `mailto` | `dsh-lit-watch/0.1.0 …` / — | Crossref polite pool |
| `timeoutMs` / `minIntervalMs` | `15000` / `150` | request bounds |
| `retries` / `maxRedirects` | `1` / `3` | bounded retry/redirect |
| `cacheTtlMs` | `21600000` | 6 h response cache (`fresh` bypasses) |
| `maxResults` / `maxWatches` | `100` / `50` | row cap and watch cap |

## Security boundaries

- HTTPS only, exact-host allowlist (`api.crossref.org`), manual redirects re-validated hop by hop.
- No credentials in URLs, no custom ports; no user data beyond the query text is sent.
- Non-2xx statuses and non-JSON bodies fail the watch instead of being treated as an empty result; the response cache is keyed by a SHA-256 of the exact URL.
- Watch files are local JSON; writes only under `root`.

## Evaluation

**30 tests**: URL construction (query, combined filter, mailto), date/name validation including impossible calendar days, item parsing (DOI/title required, year/venue/authors) and malformed-response rejection, case-insensitive diff, runtime dedupe across three runs (2 → 0 → 1 new) with window advancement, exact-URL cache hits, `fresh` bypass and refusing to cache a malformed body, local network-failure isolation with no window advance, watch replace/unknown/limits, corrupt-store refusal, digest + history, HTTP bounds (allowlist, per-hop redirect re-validation, redirect cap, non-2xx rejection, 429 retry, timeout, throttle), tool schemas, add→run→report end to end, failure branches, plugin contract, package contract.

No benchmark is claimed: the value is diff correctness against a fixed seen store, which the tests pin down; there is no labelled relevance corpus.

## Known limitations (v0.1)

- `query.bibliographic` ranking is Crossref's; a watch can miss relevant items that rank below `rows`.
- No ORCID/affiliation filters beyond raw Crossref `filter` pass-through.
- No dedupe by title (DOI-less records are skipped by design).
- The seen store grows with every new DOI; no automatic pruning in v0.1.

## License

Apache-2.0. No third-party runtime code.
