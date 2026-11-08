/**
 * Query building, item parsing, seen-store diff.
 * @module test/watch.spec
 */

import { describe, expect, it } from 'vitest'
import { assertDate, assertName, buildWatchUrl, parseItems, unseenItems } from '../src/watch.ts'

const BODY = JSON.stringify({
  message: {
    'total-results': 2,
    items: [
      { DOI: '10.5555/a', title: ['First paper'], issued: { 'date-parts': [[2026, 1, 2]] }, 'container-title': ['Journal A'], URL: 'https://doi.org/10.5555/a', type: 'journal-article', author: [{ given: 'Ann', family: 'Lee' }] },
      { DOI: '10.5555/B', title: ['Second paper'], issued: { 'date-parts': [[2025]] } },
      { title: ['No DOI, ignored'] },
    ],
  },
})

describe('watch definitions', () => {
  it('validates names and dates', () => {
    expect(assertName('crispr-watch')).toBe('crispr-watch')
    expect(() => assertName('bad name!')).toThrow(RangeError)
    expect(assertDate('2026-01-31', 'since')).toBe('2026-01-31')
    expect(() => assertDate('2026-13-01', 'since')).toThrow(RangeError)
  })

  it('builds the Crossref URL with filters and mailto', () => {
    const url = buildWatchUrl({ name: 'w', query: 'crispr base editing', filter: 'type:journal-article', since: '2026-01-01', createdAt: '', updatedAt: '' }, { since: '2026-02-01', maxRows: 50, mailto: 'a@b.c' })
    const parsed = new URL(url)
    expect(parsed.hostname).toBe('api.crossref.org')
    expect(parsed.searchParams.get('query.bibliographic')).toBe('crispr base editing')
    expect(parsed.searchParams.get('filter')).toBe('type:journal-article,from-pub-date:2026-02-01')
    expect(parsed.searchParams.get('select')).toContain('DOI')
    expect(parsed.searchParams.get('mailto')).toBe('a@b.c')
  })
})

describe('items and diff', () => {
  it('parses items and skips records without DOI/title', () => {
    const { items, totalResults } = parseItems(BODY)
    expect(totalResults).toBe(2)
    expect(items).toHaveLength(2)
    expect(items[0]!.doi).toBe('10.5555/a')
    expect(items[0]!.year).toBe(2026)
    expect(items[0]!.venue).toBe('Journal A')
    expect(items[0]!.authors).toEqual(['Ann Lee'])
    expect(items[1]!.doi).toBe('10.5555/B')
  })

  it('diffs case-insensitively against the seen store', () => {
    const { items } = parseItems(BODY)
    expect(unseenItems(items, {})).toHaveLength(2)
    expect(unseenItems(items, { '10.5555/a': 'seen' })).toHaveLength(1)
    expect(unseenItems(items, { '10.5555/a': 'seen', '10.5555/b': 'seen' })).toHaveLength(0)
  })
})
