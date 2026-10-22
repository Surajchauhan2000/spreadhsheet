import { describe, it, expect } from 'vitest'
import { normRange, rangeLabel, fillTargetFor } from './selection'

describe('selection helpers', () => {
    it('normalises a backwards selection', () => {
        const rg = normRange({ anchor: { r: 5, c: 3 }, focus: { r: 2, c: 1 } })
        expect(rg).toEqual({ r1: 2, c1: 1, r2: 5, c2: 3 })
        expect(rangeLabel(rg)).toBe('B3:D6')
    })
    const S = { r1: 1, c1: 0, r2: 2, c2: 0 }
    it('grows down, up and right', () => {
        expect(fillTargetFor(S, 5, 0)).toEqual({ r1: 1, c1: 0, r2: 5, c2: 0 })
        expect(fillTargetFor(S, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 })
        expect(fillTargetFor(S, 2, 3)).toEqual({ r1: 1, c1: 0, r2: 2, c2: 3 })
    })
    it('shrinks when the pointer goes back inside the source', () => {
        expect(fillTargetFor({ r1: 1, c1: 0, r2: 4, c2: 0 }, 2, 0)).toEqual({ r1: 1, c1: 0, r2: 2, c2: 0 })
    })
})