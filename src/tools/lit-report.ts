/**
 * `lit_watch_report` — Markdown digest + SARIF.
 * @module dsh-lit-watch/tools/lit-report
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { LitError, type LitWatchRuntime } from '../runtime.ts'
import { renderDigest, renderSarif } from '../report.ts'
import type { WatchRun } from '../watch.ts'
import { VERSION } from '../version.ts'
import { ERROR_SCHEMA } from './shared.ts'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    markdown: { type: 'string' },
    sarif: { type: 'json' },
    error: ERROR_SCHEMA,
  },
} as const

/**
 * Build the `lit_watch_report` tool.
 * @param runtime - the runtime.
 * @returns the tool definition.
 */
export function makeLitReportTool(runtime: LitWatchRuntime) {
  return defineTool({
    name: 'lit_watch_report',
    description: [
      'Render watch runs as a Markdown digest + SARIF 2.1.0 (dsh-lit-watch).',
      '',
      'Pass runs from lit_watch_run, or omit them to use the last 50 runs from the local history. New items become SARIF notes; the digest repeats that a watch reports new DOIs, not relevance.',
    ].join('\n'),
    parameters: {
      runs: { type: 'json', description: 'Runs from lit_watch_run (default: recent runs from history).' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        const result = value as { ok: true; markdown: string } | { ok: false; error: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `lit_watch_report failed (${result.error.code}): ${result.error.message}` }]
        return [{ type: 'text', text: result.markdown }]
      },
    },
    async execute(args: unknown) {
      const request = args as { runs?: WatchRun[] }
      try {
        const runs = request.runs !== undefined ? request.runs : await runtime.history(50)
        if (runs.length === 0) throw new LitError('INVALID_INPUT', 'no runs are available; call lit_watch_run first')
        return { ok: true as const, markdown: renderDigest(runs), sarif: renderSarif(runs, VERSION) as never }
      } catch (error) {
        if (error instanceof LitError) return { ok: false as const, error: { code: error.code, message: error.message } }
        throw error
      }
    },
  })
}
