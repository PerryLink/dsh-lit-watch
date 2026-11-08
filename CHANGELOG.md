# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-08

First release: literature watches over Crossref.

### Added

- `lit_watch_add`: named watches over `query.bibliographic` with optional
  Crossref filters, a fixed `since` and a row count.
- `lit_watch_run`: seen-store diff (only new DOIs), exact-URL recording,
  per-watch failure isolation, and a time window that overlaps the previous run
  by one day and is not advanced by a failed run.
- `lit_watch_report`: Markdown digest + SARIF 2.1.0.
- Bounded HTTP client (allowlist, per-hop redirect validation, timeout,
  interval, retry) with an injectable fetch for offline tests.
- 12 tests.

### Notes

- A watch reports new DOIs in a search window; it does not judge relevance.
- Local JSON state (`watches.json`, `seen.json`, `runs.jsonl`); no REP evidence.
- No scheduler and no alerts: runs are caller-driven.
