/**
 * Runtime: watches, seen store, Crossref queries, digests.
 *
 * State lives in `<root>`: `watches.json`, `seen.json`, `runs.jsonl`. The seen
 * store is what turns a repeated query into a diff — it is a local monitoring
 * ledger, not a REP evidence store (documented limitation).
 *
 * @module dsh-lit-watch/runtime
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedConfig } from './config.ts'
import { ALLOWED_HOSTS, createHttpClient, WatchNetworkError, type HttpClient } from './http.ts'
import { renderDigest, renderSarif } from './report.ts'
import { assertDate, assertName, buildWatchUrl, parseItems, unseenItems, type SeenStore, type Watch, type WatchRun } from './watch.ts'
import { VERSION } from './version.ts'

/** Stable error codes. */
export type LitErrorCode = 'INVALID_INPUT' | 'WATCH_UNKNOWN' | 'WATCH_EXISTS' | 'LIMIT' | 'NETWORK_ERROR' | 'STORE_ERROR'

/** A typed failure. */
export class LitError extends Error {
  /** Stable code. */
  readonly code: LitErrorCode

  constructor(code: LitErrorCode, message: string) {
    super(message)
    this.name = 'LitError'
    this.code = code
  }
}

/** Runtime options. */
export interface LitRuntimeOptions {
  readonly config: ResolvedConfig
  readonly client?: HttpClient
  readonly now?: () => Date
}

/** The runtime. */
export class LitWatchRuntime {
  readonly config: ResolvedConfig

  readonly #client: HttpClient
  readonly #now: () => Date

  constructor(options: LitRuntimeOptions) {
    this.config = options.config
    this.#now = options.now ?? (() => new Date())
    this.#client =
      options.client ??
      createHttpClient({
        timeoutMs: options.config.timeoutMs,
        minIntervalMs: options.config.minIntervalMs,
        retries: options.config.retries,
        maxRedirects: options.config.maxRedirects,
        userAgent: options.config.userAgent,
        allowedHosts: ALLOWED_HOSTS,
        now: () => this.#now().getTime(),
      })
  }

  /** Current ISO timestamp. */
  iso(): string {
    return this.#now().toISOString()
  }

  /** File paths. */
  get paths(): { watches: string; seen: string; runs: string; cache: string } {
    return {
      watches: path.join(this.config.root, 'watches.json'),
      seen: path.join(this.config.root, 'seen.json'),
      runs: path.join(this.config.root, 'runs.jsonl'),
      cache: path.join(this.config.root, 'cache'),
    }
  }

  /** Read watches. */
  async watches(): Promise<Watch[]> {
    try {
      const parsed = JSON.parse(await readFile(this.paths.watches, 'utf8')) as Watch[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new LitError('STORE_ERROR', `cannot read watches: ${(error as Error).message}`)
    }
  }

  /** Read the seen store. */
  async seen(): Promise<SeenStore> {
    try {
      return JSON.parse(await readFile(this.paths.seen, 'utf8')) as SeenStore
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new LitError('STORE_ERROR', `cannot read the seen store: ${(error as Error).message}`)
    }
  }

  /**
   * Add or replace a watch.
   * @param request - watch definition.
   * @returns the stored watch.
   */
  async add(request: { name?: string; query?: string; filter?: string; since?: string; rows?: number; replace?: boolean }): Promise<Watch> {
    if (typeof request.query !== 'string' || request.query.trim() === '') throw new LitError('INVALID_INPUT', 'query is required')
    const name = assertName(request.name ?? '')
    const since = request.since === undefined ? undefined : assertDate(request.since, 'since')
    const rows = request.rows
    if (rows !== undefined && (!Number.isSafeInteger(rows) || rows <= 0 || rows > this.config.maxResults)) {
      throw new LitError('INVALID_INPUT', `rows must be between 1 and ${this.config.maxResults}`)
    }
    const watches = await this.watches()
    const existing = watches.find(watch => watch.name === name)
    if (existing !== undefined && request.replace !== true) throw new LitError('WATCH_EXISTS', `watch "${name}" already exists; pass replace: true`)
    if (existing === undefined && watches.length >= this.config.maxWatches) throw new LitError('LIMIT', `at most ${this.config.maxWatches} watches are allowed`)
    const at = this.iso()
    const watch: Watch = {
      name,
      query: request.query.trim(),
      ...(request.filter === undefined || request.filter.trim() === '' ? {} : { filter: request.filter.trim() }),
      ...(since === undefined ? {} : { since }),
      ...(rows === undefined ? {} : { rows }),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      ...(existing?.lastRunAt === undefined ? {} : { lastRunAt: existing.lastRunAt }),
      ...(existing?.lastNewCount === undefined ? {} : { lastNewCount: existing.lastNewCount }),
    }
    const next = [...watches.filter(item => item.name !== name), watch]
    await mkdir(this.config.root, { recursive: true })
    await writeFile(this.paths.watches, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return watch
  }

  /** Cache read. */
  async #cacheGet(key: string, fresh: boolean): Promise<string | undefined> {
    if (fresh || this.config.cacheTtlMs <= 0) return undefined
    try {
      const parsed = JSON.parse(await readFile(path.join(this.paths.cache, `${key}.json`), 'utf8')) as { at: number; body: string }
      if (this.#now().getTime() - parsed.at > this.config.cacheTtlMs) return undefined
      return parsed.body
    } catch {
      return undefined
    }
  }

  /** Cache write (best effort). */
  async #cachePut(key: string, body: string): Promise<void> {
    if (this.config.cacheTtlMs <= 0) return
    try {
      await mkdir(this.paths.cache, { recursive: true })
      await writeFile(path.join(this.paths.cache, `${key}.json`), JSON.stringify({ at: this.#now().getTime(), body }), 'utf8')
    } catch {
      // A cache failure is a miss.
    }
  }

  /**
   * Run one or all watches.
   * @param request - watch name (omit for all) and cache bypass.
   * @returns the runs.
   */
  async run(request: { name?: string; fresh?: boolean } = {}): Promise<{ runs: WatchRun[]; warnings: string[] }> {
    const watches = await this.watches()
    if (watches.length === 0) throw new LitError('INVALID_INPUT', 'no watches are defined; add one with lit_watch_add')
    const selected = request.name === undefined ? watches : watches.filter(watch => watch.name === request.name)
    if (request.name !== undefined && selected.length === 0) throw new LitError('WATCH_UNKNOWN', `no watch named "${request.name}"`)
    const seen = await this.seen()
    const runs: WatchRun[] = []
    const warnings: string[] = []
    for (const watch of selected) {
      const previousRun = watch.lastRunAt === undefined ? undefined : new Date(watch.lastRunAt)
      const overlap = previousRun === undefined ? undefined : new Date(previousRun.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const since = watch.since ?? overlap
      const url = buildWatchUrl(watch, { ...(since === undefined ? {} : { since }), maxRows: this.config.maxResults, ...(this.config.mailto === undefined ? {} : { mailto: this.config.mailto }) })
      const ranAt = this.iso()
      let run: WatchRun
      try {
        const cached = await this.#cacheGet(url, request.fresh === true)
        const body = cached ?? (await this.#client.get(url, { accept: 'application/json' })).body
        if (cached === undefined) await this.#cachePut(url, body)
        const parsed = parseItems(body)
        const freshItems = unseenItems(parsed.items, seen)
        for (const item of freshItems) seen[item.doi.toLowerCase()] = ranAt
        run = {
          name: watch.name,
          query: watch.query,
          url,
          ranAt,
          ...(parsed.totalResults === undefined ? {} : { totalResults: parsed.totalResults }),
          newItems: freshItems,
          newCount: freshItems.length,
          seenTotal: Object.keys(seen).length,
        }
      } catch (error) {
        if (error instanceof WatchNetworkError) {
          run = { name: watch.name, query: watch.query, url, ranAt, newItems: [], newCount: 0, seenTotal: Object.keys(seen).length, error: { code: error.code, message: error.message } }
        } else {
          throw error
        }
      }
      runs.push(run)
      const index = watches.findIndex(item => item.name === watch.name)
      if (run.error === undefined) {
        // Only a successful run advances the window; otherwise a failure would
        // silently skip the next interval.
        watches[index] = { ...watch, lastRunAt: ranAt, lastNewCount: run.newCount, updatedAt: ranAt }
      } else {
        warnings.push(`${watch.name}: ${run.error.code} — the watch was not advanced`)
      }
    }
    await mkdir(this.config.root, { recursive: true })
    await writeFile(this.paths.watches, `${JSON.stringify(watches, null, 2)}\n`, 'utf8')
    await writeFile(this.paths.seen, `${JSON.stringify(seen, null, 2)}\n`, 'utf8')
    for (const run of runs) await appendFile(this.paths.runs, `${JSON.stringify(run)}\n`, 'utf8')
    return { runs, warnings }
  }

  /** Last N runs from history. */
  async history(limit = 20): Promise<WatchRun[]> {
    try {
      const text = await readFile(this.paths.runs, 'utf8')
      return text
        .split('\n')
        .filter(line => line.trim() !== '')
        .slice(-limit)
        .map(line => JSON.parse(line) as WatchRun)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new LitError('STORE_ERROR', `cannot read the run history: ${(error as Error).message}`)
    }
  }

  /** Render a digest + SARIF. */
  report(runs: readonly WatchRun[]): { markdown: string; sarif: Record<string, unknown> } {
    return { markdown: renderDigest(runs), sarif: renderSarif(runs, VERSION) }
  }
}
