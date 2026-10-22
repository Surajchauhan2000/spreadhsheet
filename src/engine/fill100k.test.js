import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'
import { fillRange } from './fillRange.js'

describe('fill at scale', () => {
    it('fills =J2*2 down to row 100,000', () => {
        const N = 100000
        const e = createEngine(N + 5, 200)
        const seed = []
        for (let r = 1; r < N; r++) seed.push({ row: r, col: 9, raw: String(r) })
        e.applyChanges(seed)
        e.setCell(1, 10, '=J2*2')

        const t0 = performance.now()
        fillRange(e, { r1: 1, c1: 10, r2: 1, c2: 10 }, { r1: 1, c1: 10, r2: N - 1, c2: 10 })
        const ms = performance.now() - t0
        console.log(`fill ${N} rows: ${ms.toFixed(0)} ms`)

        expect(e.getRaw(N - 1, 10)).toBe(`=J${N}*2`)
        expect(e.getCell(N - 1, 10).computed).toBe((N - 1) * 2)
        expect(e.undo()).toBe(true)
        expect(e.getRaw(N - 1, 10)).toBe('')
    })
})
