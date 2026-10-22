import { describe, it, expect } from 'vitest'
import { createAxis } from './layout.js'

describe('axis', () => {
  it('maps pixels to indexes with variable sizes', () => {
    const a = createAxis(5, (i) => (i === 2 ? 100 : 20)) // offsets 0,20,40,140,160,180
    expect(a.indexAt(0)).toBe(0)
    expect(a.indexAt(39)).toBe(1)
    expect(a.indexAt(40)).toBe(2)
    expect(a.indexAt(139)).toBe(2)
    expect(a.indexAt(140)).toBe(3)
    expect(a.total).toBe(180)
  })
  it('skips zero-size (hidden) items', () => {
    const a = createAxis(4, (i) => (i === 1 ? 0 : 20))
    expect(a.indexAt(20)).toBe(2)
  })
  it('100k rows lookup is fast', () => {
    const a = createAxis(100000, () => 24)
    const t = performance.now()
    for (let i = 0; i < 1e5; i++) a.indexAt(i * 24)
    expect(performance.now() - t).toBeLessThan(100)
  })
})