import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'

function load(e, rows) {
    const changes = []
    rows.forEach((row, r) => row.forEach((raw, c) => changes.push({ row: r, col: c, raw })))
    e.applyChanges(changes)
}
const names = (e) => [1, 2, 3, 4].map((r) => e.getRaw(r, 0))

describe('sortRows', () => {
    const make = () => {
        const e = createEngine(30, 10)
        load(e, [
            ['Name', 'Units', 'Total', 'PPU'],
            ['a', '2', '$10.00', '=C2/B2'],
            ['b', '4', '$400.00', '=C3/B3'],
            ['c', '5', '', '=C4/B4'],
            ['d', '1', '$50.00', '=C5/B5'],
            ['Total', '=SUM(B2:B5)', '=SUM(C2:C5)', ''],
        ])
        return e
    }

    it('sorts desc, blank last, formulas follow rows, totals row pinned', () => {
        const e = make()
        expect(e.sortRows({ col: 2, dir: 'desc' }).changed).toBe(true)
        expect(names(e)).toEqual(['b', 'd', 'a', 'c'])
        expect(e.getRaw(1, 3)).toBe('=C2/B2')
        expect(e.getCell(1, 3).computed).toBe(100)
        expect(e.getCell(2, 3).computed).toBe(50)
        expect(e.getRaw(5, 0)).toBe('Total')
        expect(e.getRaw(5, 2)).toBe('=SUM(C2:C5)')
        expect(e.getCell(5, 2).computed).toBe(460)
    })

    it('is one undo step and redo works', () => {
        const e = make()
        e.sortRows({ col: 2, dir: 'desc' })
        e.undo()
        expect(names(e)).toEqual(['a', 'b', 'c', 'd'])
        expect(e.getRaw(2, 3)).toBe('=C3/B3')
        e.redo()
        expect(names(e)).toEqual(['b', 'd', 'a', 'c'])
    })

    it('third state returns to the original order', () => {
        const e = make()
        e.sortRows({ col: 2, dir: 'asc' })
        e.sortRows({ col: 2, dir: 'desc' })
        e.sortRows({ col: 2, dir: 'original' })
        expect(names(e)).toEqual(['a', 'b', 'c', 'd'])
        expect(e.getRaw(1, 3)).toBe('=C2/B2')
    })

    it('no-op sort creates no undo entry', () => {
        const e = make()
        const depth = e.undoDepth()
        expect(e.sortRows({ col: 0, dir: 'asc' }).changed).toBe(false)
        expect(e.undoDepth()).toBe(depth)
    })

    it('reports a column outside the data', () => {
        expect(make().sortRows({ col: 8, dir: 'asc' })).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' })
    })
})

describe('filter + sort', () => {
    const make = () => {
        const e = createEngine(30, 10)
        load(e, [['Region', 'Units'], ['West', '5'], ['East', '3'], ['west', '4'], ['North', '1'], ['Total', '=SUM(B2:B5)']])
        return e
    }

    it('hides rows, still counts them in formulas, reports 2 of 4', () => {
        const e = make()
        e.setFilter(0, { include: ['west'], cond: null })
        expect([1, 2, 3, 4].map((r) => e.isRowHidden(r))).toEqual([false, true, false, true])
        expect(e.getFilterSummary()).toEqual({ active: true, visible: 2, total: 4 })
        expect(e.getCell(5, 1).computed).toBe(13)
    })

    it('sorting with a filter moves only visible rows; undo twice clears both', () => {
        const e = make()
        e.setFilter(0, { include: ['west'], cond: null })
        e.sortRows({ col: 1, dir: 'asc' })
        expect([1, 2, 3, 4].map((r) => e.getRaw(r, 1))).toEqual(['4', '3', '5', '1'])
        e.undo()
        expect(e.getRaw(1, 1)).toBe('5')
        expect(e.hasFilters()).toBe(true)
        e.undo()
        expect(e.hasFilters()).toBe(false)
        expect(e.isRowHidden(2)).toBe(false)
    })

    it('hidden rows shift with insertRow and come back on undo', () => {
        const e = make()
        e.setFilter(0, { include: ['west'], cond: null })
        e.insertRow(1)
        expect(e.isRowHidden(3)).toBe(true)
        e.undo()
        expect(e.isRowHidden(2)).toBe(true)
    })
})

describe('performance', () => {
    it('sorts 10,000 rows (with formulas) in under 300 ms', () => {
        const N = 10000
        const e = createEngine(N + 5, 6)
        const changes = [{ row: 0, col: 0, raw: 'id' }, { row: 0, col: 1, raw: 'Total' }, { row: 0, col: 2, raw: 'x2' }]
        for (let i = 1; i <= N; i++) {
            changes.push({ row: i, col: 0, raw: `ORD-${i}` })
            changes.push({ row: i, col: 1, raw: String((i * 7919) % 10007) })
            changes.push({ row: i, col: 2, raw: `=B${i + 1}*2` })
        }
        e.applyChanges(changes)
        const t0 = performance.now()
        const res = e.sortRows({ col: 1, dir: 'asc' })
        const ms = performance.now() - t0
        console.log(`sort ${N} rows: ${ms.toFixed(1)} ms`)
        expect(res.changed).toBe(true)
        expect(ms).toBeLessThan(299)
    })
})