/**
 * Bounded HTTP client: allowlist, redirect re-validation, status handling,
 * retry, timeout and per-host throttling. No test touches the network.
 * @module test/http.spec
 */

import { describe, expect, it } from 'vitest'
import { assertAllowed, createHttpClient, WatchNetworkError, type FetchLike } from '../src/http.ts'

const URL_OK = 'https://api.crossref.org/works?query=crispr'

/** Build a client with test-friendly bounds. */
function client(fetchImpl: FetchLike, overrides: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  return createHttpClient({
    fetchImpl,
    timeoutMs: 1_000,
    minIntervalMs: 0,
    retries: 0,
    maxRedirects: 3,
    userAgent: 'dsh-lit-watch/test',
    sleep: async () => {},
    now: () => 0,
    ...overrides,
  })
}

describe('URL allowlist', () => {
  it('accepts only HTTPS URLs on the exact allowlisted host', () => {
    expect(assertAllowed(URL_OK).hostname).toBe('api.crossref.org')
    for (const url of [
      'http://api.crossref.org/works',
      'https://evil.example/works',
      'https://api.crossref.org.evil.example/works',
      'https://user:secret@api.crossref.org/works',
      'https://api.crossref.org:8443/works',
      'not a url',
    ]) {
      expect(() => assertAllowed(url), url).toThrow(WatchNetworkError)
    }
  })

  it('rejects a host that is merely a prefix match', () => {
    expect(() => assertAllowed('https://api.crossref.org.example/works')).toThrow(/allowlist/u)
  })
})

describe('redirects', () => {
  it('follows an allowlisted redirect and returns the final URL', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async input => {
      calls.push(String(input))
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://api.crossref.org/works?page=2' } })
      return new Response('{"message":{"items":[]}}', { status: 200 })
    }
    const response = await client(fetchImpl).get(URL_OK)
    expect(calls).toHaveLength(2)
    expect(response.url).toContain('page=2')
    expect(JSON.parse(response.body)).toEqual({ message: { items: [] } })
  })

  it('re-validates every redirect hop and blocks a non-allowlisted host', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async input => {
      calls.push(String(input))
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } })
    }
    await expect(client(fetchImpl).get(URL_OK)).rejects.toMatchObject({ code: 'blocked_host' })
    expect(calls).toHaveLength(1)
  })

  it('stops after maxRedirects', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async input => {
      calls.push(String(input))
      return new Response(null, { status: 307, headers: { location: 'https://api.crossref.org/works?again=1' } })
    }
    await expect(client(fetchImpl, { maxRedirects: 1 }).get(URL_OK)).rejects.toMatchObject({ code: 'too_many_redirects' })
    expect(calls).toHaveLength(2)
  })

  it('rejects a redirect without a Location header', async () => {
    const fetchImpl: FetchLike = async () => new Response(null, { status: 302 })
    await expect(client(fetchImpl).get(URL_OK)).rejects.toMatchObject({ code: 'network_error' })
  })
})

describe('response handling', () => {
  it('rejects non-2xx responses instead of treating them as an empty result', async () => {
    const fetchImpl: FetchLike = async () => new Response('server exploded', { status: 500 })
    await expect(client(fetchImpl).get(URL_OK)).rejects.toMatchObject({ code: 'http_error' })
  })

  it('retries 429 once and returns the successful response', async () => {
    let calls = 0
    const sleeps: number[] = []
    const fetchImpl: FetchLike = async () => {
      calls += 1
      if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } })
      return new Response('{"message":{"items":[]}}', { status: 200 })
    }
    const response = await client(fetchImpl, { retries: 1, sleep: async ms => { sleeps.push(ms) } }).get(URL_OK)
    expect(calls).toBe(2)
    expect(sleeps).toEqual([1_000])
    expect(response.status).toBe(200)
  })

  it('maps timeout and network failures to stable codes', async () => {
    const timeout: FetchLike = async () => {
      const error = new Error('aborted')
      error.name = 'TimeoutError'
      throw error
    }
    await expect(client(timeout).get(URL_OK)).rejects.toMatchObject({ code: 'timeout' })
    const offline: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    await expect(client(offline).get(URL_OK)).rejects.toMatchObject({ code: 'network_error' })
  })

  it('maps a body-read abort to a timeout', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        status: 200,
        headers: new Headers(),
        text: async () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          throw error
        },
      }) as unknown as Response
    await expect(client(fetchImpl).get(URL_OK)).rejects.toMatchObject({ code: 'timeout' })
  })

  it('throttles repeated requests to the same host', async () => {
    let now = 1_000
    const sleeps: number[] = []
    const fetchImpl: FetchLike = async () => new Response('{}', { status: 200 })
    const throttled = client(fetchImpl, {
      minIntervalMs: 150,
      now: () => now,
      sleep: async ms => {
        sleeps.push(ms)
        now += ms
      },
    })
    await throttled.get(URL_OK)
    await throttled.get(URL_OK)
    expect(sleeps).toEqual([150])
  })

  it('sends the configured user agent and Accept header', async () => {
    let seen: RequestInit | undefined
    const fetchImpl: FetchLike = async (_input, init) => {
      seen = init
      return new Response('{}', { status: 200 })
    }
    await client(fetchImpl, { userAgent: 'watch-test/1' }).get(URL_OK, { accept: 'application/json' })
    expect(new Headers(seen?.headers).get('user-agent')).toBe('watch-test/1')
    expect(new Headers(seen?.headers).get('accept')).toBe('application/json')
    expect(seen?.redirect).toBe('manual')
  })
})
