/**
 * Watch definitions, Crossref query building, item parsing and the seen store.
 *
 * Queries are Crossref `query.bibliographic` searches with an optional
 * `from-pub-date` window. This was verified live on 2026-11-08 (HTTP 200 with
 * `filter=from-pub-date:` and `select=`). The plugin does not invent a search
 * syntax: everything the user supplies is sent through, and the exact URL is
 * stored with each run so a digest can be reproduced.
 *
 * @module dsh-lit-watch/watch
 */

/** A saved watch. */
export interface Watch {
  readonly name: string
  readonly query: string
  /** Extra Crossref filters, comma-separated (e.g. "type:journal-article"). */
  readonly filter?: string
  /** Fixed lower bound (YYYY-MM-DD); defaults to the previous run's date. */
  readonly since?: string
  /** Rows to request (default 25, capped by config). */
  readonly rows?: number
  readonly createdAt: string
  readonly updatedAt: string
  /** Last successful run. */
  readonly lastRunAt?: string
  readonly lastNewCount?: number
}

/** One result item. */
export interface WatchItem {
  readonly doi: string
  readonly title: string
  readonly year?: number
  readonly venue?: string
  readonly authors?: readonly string[]
  readonly url?: string
  readonly type?: string
}

/** Result of one watch run. */
export interface WatchRun {
  readonly name: string
  readonly query: string
  readonly url: string
  readonly ranAt: string
  readonly totalResults?: number
  readonly newItems: readonly WatchItem[]
  readonly newCount: number
  readonly seenTotal: number
  readonly error?: { readonly code: string; readonly message: string }
}

/** The seen store. */
export type SeenStore = Record<string, string>

/** Validate a watch name. */
export function assertName(name: string): string {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(name)) {
    throw new RangeError('watch name must be 1–64 characters of letters, digits, dot, underscore or dash, starting with a letter/digit')
  }
  return name
}

/** Validate a YYYY-MM-DD date. */
export function assertDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new RangeError(`${label} must be YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${label} is not a real date`)
  return value
}

/** Build the Crossref URL for a watch. */
export function buildWatchUrl(watch: Watch, options: { readonly since?: string; readonly maxRows: number; readonly mailto?: string }): string {
  const rows = Math.max(1, Math.min(watch.rows ?? 25, options.maxRows))
  const params = new URLSearchParams()
  params.set('query.bibliographic', watch.query)
  params.set('rows', String(rows))
  params.set('sort', 'published')
  params.set('order', 'desc')
  params.set('select', 'DOI,title,issued,container-title,type,URL,author')
  const filters = [watch.filter?.trim(), options.since === undefined ? undefined : `from-pub-date:${options.since}`]
    .filter((value): value is string => value !== undefined && value !== '')
    .join(',')
  if (filters !== '') params.set('filter', filters)
  if (options.mailto !== undefined && options.mailto !== '') params.set('mailto', options.mailto)
  return `https://api.crossref.org/works?${params.toString()}`
}

/** Parse a Crossref work-list response. */
export function parseItems(body: string): { totalResults?: number; items: WatchItem[] } {
  const parsed = JSON.parse(body) as { message?: { 'total-results'?: number; items?: Array<Record<string, unknown>> } }
  const raw = parsed.message?.items ?? []
  const items: WatchItem[] = []
  for (const item of raw) {
    const doi = typeof item['DOI'] === 'string' ? item['DOI'] : undefined
    const titles = item['title']
    const title = Array.isArray(titles) && typeof titles[0] === 'string' ? titles[0] : undefined
    if (doi === undefined || title === undefined) continue
    const issued = item['issued'] as { 'date-parts'?: number[][] } | undefined
    const year = issued?.['date-parts']?.[0]?.[0]
    const venue = Array.isArray(item['container-title']) && typeof item['container-title'][0] === 'string' ? item['container-title'][0] : undefined
    const authors = Array.isArray(item['author'])
      ? (item['author'] as Array<Record<string, unknown>>)
          .map(author => [author['given'], author['family']].filter(part => typeof part === 'string').join(' '))
          .filter(name => name !== '')
      : undefined
    items.push({
      doi,
      title,
      ...(typeof year === 'number' ? { year } : {}),
      ...(venue === undefined ? {} : { venue }),
      ...(authors === undefined || authors.length === 0 ? {} : { authors }),
      ...(typeof item['URL'] === 'string' ? { url: item['URL'] } : {}),
      ...(typeof item['type'] === 'string' ? { type: item['type'] } : {}),
    })
  }
  return { ...(typeof parsed.message?.['total-results'] === 'number' ? { totalResults: parsed.message['total-results'] } : {}), items }
}

/** Filter items that were not seen before. */
export function unseenItems(items: readonly WatchItem[], seen: SeenStore): WatchItem[] {
  return items.filter(item => seen[item.doi.toLowerCase()] === undefined)
}
