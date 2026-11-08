/**
 * Config schema and resolution for `dsh-lit-watch`.
 * @module dsh-lit-watch/config
 */

import path from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Raw plugin config. */
export interface Config {
  enabled?: boolean
  root?: string
  userAgent?: string
  mailto?: string
  timeoutMs?: number
  minIntervalMs?: number
  retries?: number
  maxRedirects?: number
  cacheTtlMs?: number
  maxResults?: number
  maxWatches?: number
}

/** Fully resolved config. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly root: string
  readonly userAgent: string
  readonly mailto: string | undefined
  readonly timeoutMs: number
  readonly minIntervalMs: number
  readonly retries: number
  readonly maxRedirects: number
  readonly cacheTtlMs: number
  readonly maxResults: number
  readonly maxWatches: number
}

/** Schemastery schema. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  root: z.string().default('.lit-watch'),
  userAgent: z.string().default('dsh-lit-watch/0.1.0 (https://github.com/PerryLink/dsh-lit-watch)'),
  mailto: z.string(),
  timeoutMs: z.number().default(15_000),
  minIntervalMs: z.number().default(150),
  retries: z.number().default(1),
  maxRedirects: z.number().default(3),
  cacheTtlMs: z.number().default(6 * 60 * 60 * 1000),
  maxResults: z.number().default(100),
  maxWatches: z.number().default(50),
})

/** Throw unless the value is a non-negative safe integer. */
function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer, got ${String(value)}`)
}

/**
 * Validate raw values and fill explicit defaults.
 * @param config - raw plugin config.
 * @returns the fully resolved config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const root = config.root ?? '.lit-watch'
  if (typeof root !== 'string' || root.trim() === '') throw new TypeError('root must be a non-empty path')
  const timeoutMs = config.timeoutMs ?? 15_000
  const minIntervalMs = config.minIntervalMs ?? 150
  const retries = config.retries ?? 1
  const maxRedirects = config.maxRedirects ?? 3
  const cacheTtlMs = config.cacheTtlMs ?? 6 * 60 * 60 * 1000
  const maxResults = config.maxResults ?? 100
  const maxWatches = config.maxWatches ?? 50
  for (const [name, value] of Object.entries({ timeoutMs, minIntervalMs, retries, maxRedirects, cacheTtlMs, maxResults, maxWatches })) {
    assertNonNegativeInt(name, value)
  }
  if (timeoutMs <= 0 || maxResults <= 0 || maxWatches <= 0) throw new TypeError('timeoutMs, maxResults and maxWatches must be positive')
  return {
    enabled: config.enabled ?? true,
    root: path.resolve(root),
    userAgent: config.userAgent ?? 'dsh-lit-watch/0.1.0 (https://github.com/PerryLink/dsh-lit-watch)',
    ...(config.mailto === undefined || config.mailto.trim() === '' ? { mailto: undefined } : { mailto: config.mailto }),
    timeoutMs,
    minIntervalMs,
    retries,
    maxRedirects,
    cacheTtlMs,
    maxResults,
    maxWatches,
  }
}
