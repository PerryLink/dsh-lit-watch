/**
 * Runtime: dedupe across runs, time windows, error isolation, tools.
 * @module test/runtime-tools.spec
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { WatchNetworkError, type HttpClient } from '../src/http.ts'
import { LitWatchRuntime } from '../src/runtime.ts'
import { makeLitAddTool } from '../src/tools/lit-add.ts'
import { makeLitReportTool } from '../src/tools/lit-report.ts'
import { makeLitRunTool } from '../src/tools/lit-run.ts'
import { VERSION } from '../src/version.ts'

const AT = new Date('2026-11-01T09:00:00.000Z')
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lit-watch-'))
})

afterEach(async () => {
  if (root.startsWith(tmpdir())) await rm(root, { recursive: true, force: true })
})

/** Build a work-list body. */
function body(dois: string[]): string {
  return JSON.stringify({
    message: {
      'total-results': dois.length,
      items: dois.map(doi => ({ DOI: doi, title: [`Paper ${doi}`], issued: { 'date-parts': [[2026]] } })),
    },
  })
}

/** A client returning fixed bodies and recording URLs. */
function fakeClient(bodies: string[]): { client: HttpClient; urls: string[] } {
  const urls: string[] = []
  let index = 0
  return {
    urls,
    client: {
      async get(url: string) {
        urls.push(url)
        const payload = bodies[Math.min(index, bodies.length - 1)]!
        index += 1
        return { status: 200, body: payload, url }
      },
    },
  }
}

/** Build a runtime over the fixtures. */
function runtime(client: HttpClient): LitWatchRuntime {
  return new LitWatchRuntime({ config: resolveConfig({ root, cacheTtlMs: 0 }), client, now: () => AT })
}

const EXEC = {} as never

describe('runtime', () => {
  it('returns only new items across runs and advances the window', async () => {
    const fake = fakeClient([body(['10.5555/a', '10.5555/b']), body(['10.5555/a', '10.5555/b']), body(['10.5555/a', '10.5555/c'])])
    const rt = runtime(fake.client)
    await rt.add({ name: 'crispr', query: 'crispr base editing' })

    const first = await rt.run({ name: 'crispr' })
    expect(first.runs[0]!.newCount).toBe(2)
    expect(fake.urls[0]).toContain('query.bibliographic=crispr+base+editing')
    expect(fake.urls[0]).not.toContain('from-pub-date')

    const second = await rt.run({ name: 'crispr' })
    expect(second.runs[0]!.newCount).toBe(0)

    const third = await rt.run({ name: 'crispr' })
    expect(third.runs[0]!.newCount).toBe(1)
    expect(third.runs[0]!.newItems[0]!.doi).toBe('10.5555/c')
    // A window is applied once a previous run exists (one day of overlap).
    expect(decodeURIComponent(fake.urls[2]!)).toContain('from-pub-date:')
    expect(third.runs[0]!.seenTotal).toBe(3)
  })

  it('keeps a network failure local and does not advance that watch', async () => {
    const client: HttpClient = {
      async get() {
        throw new WatchNetworkError('network_error', 'boom')
      },
    }
    const rt = new LitWatchRuntime({ config: resolveConfig({ root, cacheTtlMs: 0 }), client, now: () => AT })
    await rt.add({ name: 'failing', query: 'anything' })
    const result = await rt.run({ name: 'failing' })
    expect(result.runs[0]!.error?.code).toBe('network_error')
    expect(result.runs[0]!.newCount).toBe(0)
    expect(result.warnings.join(' ')).toContain('was not advanced')
    const watch = (await rt.watches())[0]!
    expect(watch.lastRunAt).toBeUndefined()
  })

  it('enforces names, replacement and unknown watches', async () => {
    const fake = fakeClient([body([])])
    const rt = runtime(fake.client)
    await rt.add({ name: 'w', query: 'q' })
    await expect(rt.add({ name: 'w', query: 'q2' })).rejects.toMatchObject({ code: 'WATCH_EXISTS' })
    const replaced = await rt.add({ name: 'w', query: 'q2', replace: true })
    expect(replaced.query).toBe('q2')
    await expect(rt.run({ name: 'nope' })).rejects.toMatchObject({ code: 'WATCH_UNKNOWN' })
  })

  it('renders a digest and history', async () => {
    const fake = fakeClient([body(['10.5555/a'])])
    const rt = runtime(fake.client)
    await rt.add({ name: 'w', query: 'q' })
    await rt.run()
    const report = rt.report(await rt.history(10))
    expect(report.markdown).toContain('Literature watch')
    expect(report.markdown).toContain('10.5555/a')
    expect((report.sarif as { runs: Array<{ results: unknown[] }> }).runs[0]!.results).toHaveLength(1)
  })
})

describe('tools', () => {
  it('declares names and schemas', () => {
    const rt = runtime(fakeClient([body([])]).client)
    for (const [tool, name] of [
      [makeLitAddTool(rt), 'lit_watch_add'],
      [makeLitRunTool(rt), 'lit_watch_run'],
      [makeLitReportTool(rt), 'lit_watch_report'],
    ] as const) {
      expect(tool.name).toBe(name)
      expect(Object.keys(tool.parameters).length).toBeGreaterThan(0)
      expect(tool.output.schema).toBeDefined()
    }
  })

  it('add → run → report end to end', async () => {
    const rt = runtime(fakeClient([body(['10.5555/a'])]).client)
    const added = (await makeLitAddTool(rt).execute({ name: 'w', query: 'q' }, EXEC)) as { ok: true }
    expect(added.ok).toBe(true)
    const run = (await makeLitRunTool(rt).execute({}, EXEC)) as { ok: true; totalNew: number; runs: unknown[] }
    expect(run.totalNew).toBe(1)
    const report = (await makeLitReportTool(rt).execute({ runs: run.runs }, EXEC)) as { ok: true; markdown: string; sarif: { version: string } }
    expect(report.markdown).toContain('10.5555/a')
    expect(report.sarif.version).toBe('2.1.0')
  })

  it('failure branches carry stable codes', async () => {
    const rt = runtime(fakeClient([body([])]).client)
    const value = (await makeLitRunTool(rt).execute({}, EXEC)) as { ok: false; error: { code: string } }
    expect(value.ok).toBe(false)
    expect(value.error.code).toBe('INVALID_INPUT')
  })
})

describe('package', () => {
  it('VERSION matches package.json and the manifest declares a bundle patch', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(pkg['version']).toBe(VERSION)
    expect(pkg['dsh']).toEqual({ manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } })
    expect(pkg['dependencies']).toEqual({})
  })
})
