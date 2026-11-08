/**
 * Markdown digest and SARIF for watch runs.
 * @module dsh-lit-watch/report
 */

import type { WatchRun } from './watch.ts'

/** Escape a table cell. */
function cell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\n+/gu, ' ').trim()
}

/**
 * Render runs as a Markdown digest.
 * @param runs - the runs.
 * @returns Markdown text.
 */
export function renderDigest(runs: readonly WatchRun[]): string {
  const lines = ['# Literature watch', '']
  const total = runs.reduce((sum, run) => sum + run.newCount, 0)
  lines.push(`**Watches run:** ${runs.length} · **new items:** ${total} · **generated:** ${new Date().toISOString()}`)
  lines.push('')
  for (const run of runs) {
    lines.push(`## ${run.name}`)
    lines.push('')
    if (run.error !== undefined) {
      lines.push(`> Query failed (${run.error.code}): ${run.error.message}`)
      lines.push('')
      continue
    }
    lines.push(`Query: \`${run.query}\` · new: **${run.newCount}** · total matches: ${run.totalResults ?? 'unknown'} · seen: ${run.seenTotal}`)
    lines.push('')
    if (run.newItems.length === 0) {
      lines.push('No new items since the previous run.')
      lines.push('')
      continue
    }
    lines.push('| DOI | Title | Year | Venue |')
    lines.push('|---|---|---:|---|')
    for (const item of run.newItems) {
      lines.push(`| [${item.doi}](https://doi.org/${item.doi}) | ${cell(item.title)} | ${item.year ?? ''} | ${cell(item.venue ?? '')} |`)
    }
    lines.push('')
  }
  lines.push('> A watch reports new DOIs in a search window; it does not judge relevance or quality, and Crossref coverage/lag applies.')
  return `${lines.join('\n')}\n`
}

/**
 * Render new items as SARIF 2.1.0 notes.
 * @param runs - the runs.
 * @param version - plugin version.
 * @returns the SARIF log.
 */
export function renderSarif(runs: readonly WatchRun[], version: string): Record<string, unknown> {
  const results = runs.flatMap(run =>
    run.newItems.map(item => ({
      ruleId: `lit-watch/${run.name}`,
      level: 'note' as const,
      message: { text: `New in "${run.name}": ${item.title} (${item.doi})` },
      properties: { doi: item.doi, year: item.year ?? null, venue: item.venue ?? null },
    })),
  )
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'dsh-lit-watch', version } }, results }],
  }
}
