/**
 * Function-plugin contract: no default export, name/inject, enabled gating and
 * exactly three uniquely named tools.
 * @module test/plugin.spec
 */

import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import * as plugin from '../src/index.ts'

/** Minimal stand-in for the host context the plugin uses at mount time. */
function fakeContext(registered: string[]) {
  return {
    logger: () => ({ info: () => {} }),
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
    tools: {
      register: (tool: { name: string }) => {
        registered.push(tool.name)
        return () => {}
      },
    },
  }
}

describe('plugin contract', () => {
  it('is a function plugin with name, inject and a Schemastery Config', () => {
    expect('default' in plugin).toBe(false)
    expect(plugin.name).toBe('lit-watch')
    expect(plugin.inject).toEqual(['tools'])
    expect(typeof Config).toBe('function')
  })

  it('mounts nothing when disabled and exactly three unique tools when enabled', () => {
    const registered: string[] = []
    const ctx = fakeContext(registered)
    plugin.apply(ctx as never, { enabled: false })
    expect(registered).toEqual([])
    plugin.apply(ctx as never, { enabled: true })
    expect(registered).toEqual(['lit_watch_add', 'lit_watch_run', 'lit_watch_report'])
    expect(new Set(registered).size).toBe(3)
  })
})
