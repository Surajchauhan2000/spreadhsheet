import { describe, it, expect } from 'vitest'
import { createEngine } from './core'
import { fillRange } from './fillRange'

describe('applyChanges', () => {
    it('is one undo step for values and styles, and redo works', () => {
        const e = createEngine(20, 20)
        e.setCell(0, 0, 'a')
        e.applyChanges([
            { row: 0, col: 0, raw: 'b', style: { bold: true } },
            { row: 1, col: 0, raw: 'c' },
        ])
        expect(e.getRaw(0, 0)).toBe('b')
        expect(e.getStyle(0, 0)).toEqual({ bold: true })
        e.undo()
        expect(e.getRaw(0, 0)).toBe('a')
        expect(e.getStyle(0, 0)).toBeUndefined()
        expect(e.getRaw(1, 0)).toBe('')
        e.redo()
        expect(e.getRaw(1, 0)).toBe('c')
        expect(e.getStyle(0, 0)).toEqual({ bold: true })
    })
    it('no-op creates no undo entry', () => {
        const e = createEngine(20, 20)
        expect(e.applyChanges([{ row: 0, col: 0, raw: '' }])).toBe(false)
        expect(e.canUndo()).toBe(false)
    })
    it('clearContents is one undo step', () => {
        const e = createEngine(20, 20)
        e.setCell(0, 0, '1')
        e.setCell(1, 0, '2')
        e.clearContents({ r1: 0, c1: 0, r2: 1, c2: 0 })
        expect(e.getRaw(1, 0)).toBe('')
        e.undo()
        expect(e.getRaw(0, 0)).toBe('1')
        expect(e.getRaw(1, 0)).toBe('2')
    })
})

describe('styles follow structure', () => {
    it('moves with insertRow and comes back on undo', () => {
        const e = createEngine(30, 20)
        e.applyChanges([{ row: 9, col: 0, raw: 'x', style: { bold: true } }])
        e.insertRow(5)
        expect(e.getStyle(10, 0)).toEqual({ bold: true })
        e.undo()
        expect(e.getStyle(9, 0)).toEqual({ bold: true })
    })
})

describe('fillRange (acceptance)', () => {
    it('A2:A3 -> A6 gives ORD-1003..1005, inherits style, one undo', () => {
        const e = createEngine(50, 20)
        e.setCell(1, 0, 'ORD-1001')
        e.setCell(2, 0, 'ORD-1002')
        e.applyChanges([{ row: 1, col: 0, style: { bold: true } }])
        fillRange(e, { r1: 1, c1: 0, r2: 2, c2: 0 }, { r1: 1, c1: 0, r2: 5, c2: 0 })
        expect([3, 4, 5].map((r) => e.getRaw(r, 0))).toEqual(['ORD-1003', 'ORD-1004', 'ORD-1005'])
        expect(e.getStyle(3, 0)).toEqual({ bold: true })
        e.undo()
        expect([3, 4, 5].map((r) => e.getRaw(r, 0))).toEqual(['', '', ''])
    })
    it('K=G*H and L=$G$2*H fill to row 32', () => {
        const e = createEngine(50, 20)
        e.setCell(1, 10, '=G2*H2')
        e.setCell(1, 11, '=$G$2*H2')
        fillRange(e, { r1: 1, c1: 10, r2: 1, c2: 11 }, { r1: 1, c1: 10, r2: 31, c2: 11 })
        expect(e.getRaw(31, 10)).toBe('=G32*H32')
        expect(e.getRaw(31, 11)).toBe('=$G$2*H32')
    })
    it('fills 5,000 cells in under 200 ms', () => {
        const e = createEngine(6000, 5)
        e.setCell(0, 0, '1')
        e.setCell(1, 0, '2')
        const t0 = performance.now()
        fillRange(e, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 5001, c2: 0 })
        const ms = performance.now() - t0
        console.log(`fill 5000 cells: ${ms.toFixed(1)} ms`)
        expect(e.getRaw(5001, 0)).toBe('5002')
        expect(ms).toBeLessThan(200)
    })
})