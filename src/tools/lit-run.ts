/**
 * `lit_watch_run` — run watches and report new items.
 * @module dsh-lit-watch/tools/lit-run
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { LitError, type LitWatchRuntime } from '../runtime.ts'
import { ERROR_SCHEMA } from './shared.ts'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    runs: { type: 'json' },
    totalNew: { type: 'integer' },
    warnings: { type: 'array', items: { type: 'string' } },
    error: ERROR_SCHEMA,
  },
} as const

/**
 * Build the `lit_watch_run` tool.
 * @param runtime - the runtime.
 * @returns the tool definition.
 */
export function makeLitRunTool(runtime: LitWatchRuntime) {
  return defineTool({
    name: 'lit_watch_run',
    description: [
      'Run one watch (or all) and return only items not seen before (dsh-lit-watch).',
      '',
      'Each run stores the exact Crossref URL, records the new DOIs in the local seen store, appends to `runs.jsonl`, and advances the time window. A network failure is reported per watch and does not advance that watch.',
    ].join('\n'),
    parameters: {
      name: { type: 'string', description: 'Watch name; omit to run every watch.' },
      fresh: { type: 'boolean', description: 'Bypass the response cache.' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        const result = value as { ok: true; runs: Array<{ name: string; newCount: number }>; totalNew: number; warnings: string[] } | { ok: false; error: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `lit_watch_run failed (${result.error.code}): ${result.error.message}` }]
        const lines = [`lit_watch_run: ${result.runs.length} watch(es), ${result.totalNew} new item(s)`]
        for (const run of result.runs) lines.push(`  ${run.name}: ${run.newCount} new`)
        for (const warning of result.warnings) lines.push(`  warning: ${warning}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: unknown) {
      const request = args as { name?: string; fresh?: boolean }
      try {
        const result = await runtime.run({
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.fresh === true ? { fresh: true } : {}),
        })
        const totalNew = result.runs.reduce((sum, run) => sum + run.newCount, 0)
        return { ok: true as const, runs: result.runs as never, totalNew, warnings: [...result.warnings] }
      } catch (error) {
        if (error instanceof LitError) return { ok: false as const, error: { code: error.code, message: error.message } }
        throw error
      }
    },
  })
}
