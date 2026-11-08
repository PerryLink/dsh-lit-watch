/**
 * Bounded HTTP client for Crossref (HTTPS, exact-host allowlist, manual
 * redirect re-validation, timeout, per-host interval, one retry on 429/503).
 * The fetch implementation is injectable so tests never touch the network.
 * @module dsh-retraction-watch/http
 */

/** The only host this plugin talks to. */
export const ALLOWED_HOSTS: readonly string[] = ['api.crossref.org']

/** Stable network failure codes. */
export type NetworkErrorCode = 'blocked_host' | 'invalid_url' | 'too_many_redirects' | 'timeout' | 'network_error' | 'http_error'

/** A transport-level failure. */
export class WatchNetworkError extends Error {
  /** Stable code. */
  readonly code: NetworkErrorCode

  constructor(code: NetworkErrorCode, message: string) {
    super(message)
    this.name = 'WatchNetworkError'
    this.code = code
  }
}

/** One HTTP response. */
export interface HttpResponse {
  readonly status: number
  readonly body: string
  readonly url: string
}

/** The HTTP surface the runtime depends on. */
export interface HttpClient {
  get(url: string, options?: { readonly accept?: string }): Promise<HttpResponse>
}

/** The minimal fetch shape needed. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Options for {@link createHttpClient}. */
export interface HttpClientOptions {
  readonly fetchImpl?: FetchLike
  readonly timeoutMs: number
  readonly minIntervalMs: number
  readonly retries: number
  readonly maxRedirects: number
  readonly userAgent: string
  readonly allowedHosts?: readonly string[]
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

/** Validate a URL against the allowlist. */
export function assertAllowed(url: string, allowedHosts: readonly string[] = ALLOWED_HOSTS): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new WatchNetworkError('invalid_url', `not a valid URL: ${url}`)
  }
  if (parsed.protocol !== 'https:') throw new WatchNetworkError('invalid_url', `only https is allowed, got ${parsed.protocol}`)
  if (parsed.username !== '' || parsed.password !== '') throw new WatchNetworkError('invalid_url', 'credentials in the URL are not allowed')
  if (parsed.port !== '' && parsed.port !== '443') throw new WatchNetworkError('invalid_url', `non-default ports are not allowed (${parsed.port})`)
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new WatchNetworkError('blocked_host', `host ${parsed.hostname} is not on the allowlist`)
  }
  return parsed
}

const defaultSleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/** True for a redirect status. */
function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * Create the bounded client.
 * @param options - bounds and injection points.
 * @returns the client.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike)
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const allowed = options.allowedHosts ?? ALLOWED_HOSTS
  const lastCall = new Map<string, number>()

  const throttle = async (host: string): Promise<void> => {
    const previous = lastCall.get(host)
    if (previous !== undefined) {
      const wait = previous + options.minIntervalMs - now()
      if (wait > 0) await sleep(wait)
    }
    lastCall.set(host, now())
  }

  const request = async (url: string, accept: string | undefined): Promise<Response> => {
    let attempt = 0
    for (;;) {
      let response: Response
      try {
        response = await fetchImpl(url, {
          redirect: 'manual',
          headers: { 'user-agent': options.userAgent, ...(accept === undefined ? {} : { accept }) },
          signal: AbortSignal.timeout(options.timeoutMs),
        })
      } catch (error) {
        const name = (error as Error).name
        if (name === 'TimeoutError' || name === 'AbortError') throw new WatchNetworkError('timeout', `request timed out after ${options.timeoutMs} ms: ${url}`)
        throw new WatchNetworkError('network_error', `network error for ${url}: ${(error as Error).message}`)
      }
      if ((response.status === 429 || response.status === 503) && attempt < options.retries) {
        attempt += 1
        const retryAfter = Number(response.headers.get('retry-after') ?? '')
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 500 * attempt)
        continue
      }
      return response
    }
  }

  return {
    async get(url: string, requestOptions: { accept?: string } = {}): Promise<HttpResponse> {
      let current = assertAllowed(url, allowed).toString()
      for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
        await throttle(new URL(current).hostname.toLowerCase())
        const response = await request(current, requestOptions.accept)
        if (isRedirect(response.status)) {
          const location = response.headers.get('location')
          if (location === null || location === '') throw new WatchNetworkError('network_error', `redirect without a Location header from ${current}`)
          current = assertAllowed(new URL(location, current).toString(), allowed).toString()
          continue
        }
        const body = await response.text()
        return { status: response.status, body, url: current }
      }
      throw new WatchNetworkError('too_many_redirects', `more than ${options.maxRedirects} redirects starting at ${url}`)
    },
  }
}
