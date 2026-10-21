import { describe, it, expect } from 'vitest'
import { fillLine, planFill } from './fill'

const raws = (seeds, count, opts) => fillLine(seeds, count, opts).map((x) => x.raw)

describe('fillLine: numbers', () => {
    it('continues a numeric series', () => {
        expect(raws(['1', '2'], 3)).toEqual(['3', '4', '5'])
    })
    it('copies a single number', () => {
        expect(raws(['7'], 2)).toEqual(['7', '7'])
    })
    it('avoids float noise', () => {
        expect(raws(['0.1', '0.2'], 1)).toEqual(['0.3'])
    })
})

describe('fillLine: text ending in a number', () => {
    it('increments IDs', () => {
        expect(raws(['ORD-1001', 'ORD-1002'], 3)).toEqual(['ORD-1003', 'ORD-1004', 'ORD-1005'])
    })
    it('increments a single seed', () => {
        expect(raws(['Item 1'], 2)).toEqual(['Item 2', 'Item 3'])
        expect(raws(['Q4'], 1)).toEqual(['Q5'])
    })
    it('preserves zero padding', () => {
        expect(raws(['Q04'], 2)).toEqual(['Q05', 'Q06'])
        expect(raws(['2024-W01'], 2)).toEqual(['2024-W02', '2024-W03'])
        expect(raws(['007', '008'], 2)).toEqual(['009', '010'])
    })
})

describe('fillLine: dates', () => {
    it('steps ISO dates by the seed delta', () => {
        expect(raws(['2024-01-15', '2024-01-16'], 2)).toEqual(['2024-01-17', '2024-01-18'])
    })
    it('keeps the slash format and a bigger step', () => {
        expect(raws(['1/15/2024', '1/17/2024'], 2)).toEqual(['1/19/2024', '1/21/2024'])
    })
    it('rolls over month ends', () => {
        expect(raws(['2024-01-30', '2024-01-31'], 1)).toEqual(['2024-02-01'])
    })
    it('each filled cell keeps its paired seed format', () => {
        expect(raws(['2024-01-15', '1/16/2024', '2024-01-17'], 3)).toEqual(['2024-01-18', '1/19/2024', '2024-01-20'])
    })
})

describe('fillLine: weekday and month names', () => {
    it('cycles and preserves case', () => {
        expect(raws(['Mon'], 2)).toEqual(['Tue', 'Wed'])
        expect(raws(['JAN'], 1)).toEqual(['FEB'])
        expect(raws(['dec'], 1)).toEqual(['jan'])
        expect(raws(['Sat'], 2)).toEqual(['Sun', 'Mon'])
    })
    it('uses the step between seeds', () => {
        expect(raws(['Monday', 'Wednesday'], 2)).toEqual(['Friday', 'Sunday'])
    })
})

describe('fillLine: formulas', () => {
    it('shifts relative refs down', () => {
        expect(raws(['=G2*H2'], 2)).toEqual(['=G3*H3', '=G4*H4'])
    })
    it('keeps $ pinned', () => {
        expect(raws(['=$G$2*H2'], 2)).toEqual(['=$G$2*H3', '=$G$2*H4'])
    })
    it('shifts columns when filling right', () => {
        expect(raws(['=A1+B1'], 1, { axis: 'col' })).toEqual(['=B1+C1'])
    })
})

describe('fillLine: direction and cycling', () => {
    it('goes backwards when reversed', () => {
        expect(raws(['2', '1'], 2, { reverse: true })).toEqual(['0', '-1'])
        expect(raws(['=A2'], 1, { reverse: true })).toEqual(['=A1'])
        expect(raws(['Mon'], 1, { reverse: true })).toEqual(['Sun'])
    })
    it('repeats unrecognised seeds in a cycle', () => {
        expect(raws(['a', 'b'], 3)).toEqual(['a', 'b', 'a'])
    })
})

describe('planFill', () => {
    const data = { '1,0': 'ORD-1001', '2,0': 'ORD-1002', '5,0': 'Item 5', '1,1': '1', '1,2': '2' }
    const getRaw = (r, c) => data[`${r},${c}`] ?? ''

    it('fills down (A2:A3 -> A6)', () => {
        const out = planFill({ r1: 1, c1: 0, r2: 2, c2: 0 }, { r1: 1, c1: 0, r2: 5, c2: 0 }, getRaw)
        expect(out.map((c) => [c.row, c.raw])).toEqual([[3, 'ORD-1003'], [4, 'ORD-1004'], [5, 'ORD-1005']])
        expect(out.map((c) => c.styleFrom.row)).toEqual([1, 2, 1])
    })
    it('fills up', () => {
        const out = planFill({ r1: 5, c1: 0, r2: 5, c2: 0 }, { r1: 3, c1: 0, r2: 5, c2: 0 }, getRaw)
        expect(out.map((c) => [c.row, c.raw])).toEqual([[4, 'Item 4'], [3, 'Item 3']])
    })
    it('fills right', () => {
        const out = planFill({ r1: 1, c1: 1, r2: 1, c2: 2 }, { r1: 1, c1: 1, r2: 1, c2: 4 }, getRaw)
        expect(out.map((c) => [c.col, c.raw])).toEqual([[3, '3'], [4, '4']])
    })
    it('shrinks when dragged back into the source', () => {
        const out = planFill({ r1: 1, c1: 0, r2: 4, c2: 0 }, { r1: 1, c1: 0, r2: 2, c2: 0 }, getRaw)
        expect(out.map((c) => [c.row, c.raw, c.clear])).toEqual([[3, '', true], [4, '', true]])
    })
})