/**
 * `dsh-lit-watch` — saved literature watches over Crossref: time windows, a seen
 * store for true new-item diffs, and a reviewable digest.
 *
 * Three tools: lit_watch_add, lit_watch_run, lit_watch_report. Only Crossref is
 * contacted (exact-host allowlist, manual redirect re-validation).
 *
 * Function plugin — no default export.
 * @module dsh-lit-watch
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveConfig, type Config as ConfigShape } from './config.ts'
import { LitWatchRuntime } from './runtime.ts'
import { makeLitAddTool } from './tools/lit-add.ts'
import { makeLitReportTool } from './tools/lit-report.ts'
import { makeLitRunTool } from './tools/lit-run.ts'

/** Cordis plugin name. */
export const name = 'lit-watch'

/** The tool registry is a hard requirement. */
export const inject = ['tools']

export { Config, resolveConfig }
export type { ConfigShape }
export type { ResolvedConfig } from './config.ts'
export { VERSION } from './version.ts'
export { ALLOWED_HOSTS, WatchNetworkError, assertAllowed, createHttpClient } from './http.ts'
export type { FetchLike, HttpClient, HttpResponse, NetworkErrorCode } from './http.ts'
export { assertDate, assertName, buildWatchUrl, parseItems, unseenItems } from './watch.ts'
export type { SeenStore, Watch, WatchItem, WatchRun } from './watch.ts'
export { renderDigest, renderSarif } from './report.ts'
export { LitError, LitWatchRuntime } from './runtime.ts'
export type { LitErrorCode, LitRuntimeOptions } from './runtime.ts'
export { makeLitAddTool } from './tools/lit-add.ts'
export { makeLitRunTool } from './tools/lit-run.ts'
export { makeLitReportTool } from './tools/lit-report.ts'

/**
 * Mount the three tools.
 * @param ctx - the plugin context (host).
 * @param config - raw plugin config.
 */
export function apply(ctx: Context, config: ConfigShape): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger('lit-watch')
  if (!resolved.enabled) {
    logger.info('disabled: enabled is false — no tools are mounted')
    return
  }
  const runtime = new LitWatchRuntime({ config: resolved })
  ctx.effect(() => ctx.tools.register(makeLitAddTool(runtime)), 'lit-watch: lit_watch_add tool')
  ctx.effect(() => ctx.tools.register(makeLitRunTool(runtime)), 'lit-watch: lit_watch_run tool')
  ctx.effect(() => ctx.tools.register(makeLitReportTool(runtime)), 'lit-watch: lit_watch_report tool')
}
