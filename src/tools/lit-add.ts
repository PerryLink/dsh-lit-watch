/**
 * `lit_watch_add` — save a Crossref watch.
 * @module dsh-lit-watch/tools/lit-add
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { LitError, type LitWatchRuntime } from '../runtime.ts'
import { ERROR_SCHEMA } from './shared.ts'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    watch: { type: 'json' },
    error: ERROR_SCHEMA,
  },
} as const

/**
 * Build the `lit_watch_add` tool.
 * @param runtime - the runtime.
 * @returns the tool definition.
 */
export function makeLitAddTool(runtime: LitWatchRuntime) {
  return defineTool({
    name: 'lit_watch_add',
    description: [
      'Save a literature watch built on Crossref `query.bibliographic` (dsh-lit-watch).',
      '',
      'A watch is a named query plus an optional Crossref filter (`type:journal-article`), a fixed `since` date and a row count. Runs after the first use the previous run date as the time window (with one day of overlap; the seen store absorbs duplicates). Names are unique unless `replace` is true.',
    ].join('\n'),
    parameters: {
      name: { type: 'string', required: true, description: 'Watch name (letters/digits/._-, 1–64 chars).' },
      query: { type: 'string', required: true, description: 'Crossref bibliographic query.' },
      filter: { type: 'string', description: 'Extra Crossref filters, comma-separated.' },
      since: { type: 'string', description: 'Fixed lower bound YYYY-MM-DD (default: previous run).' },
      rows: { type: 'integer', description: 'Rows to request (default 25, capped by config).' },
      replace: { type: 'boolean', description: 'Replace an existing watch with the same name.' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        const result = value as { ok: true; watch: { name: string; query: string } } | { ok: false; error: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `lit_watch_add failed (${result.error.code}): ${result.error.message}` }]
        return [{ type: 'text', text: `lit_watch_add: "${result.watch.name}" → ${result.watch.query}` }]
      },
    },
    async execute(args: unknown) {
      const request = args as Parameters<LitWatchRuntime['add']>[0]
      try {
        return { ok: true as const, watch: (await runtime.add(request)) as never }
      } catch (error) {
        if (error instanceof LitError || error instanceof RangeError) return { ok: false as const, error: { code: error instanceof LitError ? error.code : 'INVALID_INPUT', message: error.message } }
        throw error
      }
    },
  })
}
