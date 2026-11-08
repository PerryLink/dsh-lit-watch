# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Non-2xx Crossref responses are now a per-watch `http_error` failure instead of
  being parsed as an empty result and advancing the watch window.
- A non-JSON or malformed Crossref body raises `invalid_response`, so the run
  fails locally instead of leaking a `SyntaxError` out of `lit_watch_run`.
- The response cache wrote to a path containing the raw URL (including `/` and
  `:`), so writes failed silently and the cache never hit; keys are now the
  SHA-256 of the exact URL.
- `assertDate` accepted impossible calendar dates (e.g. `2026-02-31`) because
  `Date` normalizes them; it now requires an exact round trip.
- `lit_watch_report` rejects malformed `runs` payloads with `INVALID_INPUT`.
- Removed the unused tool-level `NETWORK_ERROR` code and documented the actual
  per-watch network error codes.
- A malformed 200 body is no longer written to the response cache (it would
  keep failing the same watch until the TTL expired).
- A non-array `watches.json` or non-object `seen.json` is reported as
  `STORE_ERROR` instead of being silently replaced by fresh state.

### Added

- Offline HTTP-client tests for the allowlist, per-hop redirect re-validation,
  redirect cap, non-2xx rejection, 429 retry, timeout, header injection and
  per-host throttling; cache, corrupt-store and impossible-date regression
  tests; plugin mount contract (30 tests total).

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
