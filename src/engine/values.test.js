import { describe, it, expect } from 'vitest'
import { classify, compareClassified, compileFilter, distinctValues } from './values.js'

const sorted = (arr, desc) => [...arr].sort((a, b) => compareClassified(classify(a), classify(b), desc))

describe('sort comparison', () => {
    const mixed = ['b', 10, '', 'A', '2024-01-03', 2]
    it('numbers, then dates, then text (case-insensitive); blanks last', () => {
        expect(sorted(mixed, false)).toEqual([2, 10, '2024-01-03', 'A', 'b', ''])
    })
    it('blanks stay last when descending', () => {
        expect(sorted(mixed, true)).toEqual(['b', 'A', '2024-01-03', 10, 2, ''])
    })
    it('compares dates as dates across the three formats', () => {
        expect(sorted(['1/8/2024', '2024-01-03', '15 Jan 2024'], false)).toEqual(['2024-01-03', '1/8/2024', '15 Jan 2024'])
    })
    it('treats currency and percent text as numbers', () => {
        expect(sorted(['$1,200.00', '$320.00', '10%'], false)).toEqual(['10%', '$320.00', '$1,200.00'])
    })
})

describe('filters', () => {
    it('groups case/space variants and keeps the first-seen label', () => {
        const d = distinctValues(['West', 'East', 'west', ' WEST ', ''])
        expect(d.find((x) => x.key === 'west')).toMatchObject({ label: 'West', count: 3 })
        expect(d[d.length - 1].key).toBe('')
    })
    it('conditions', () => {
        const gt = compileFilter({ include: null, cond: { op: 'gt', value: '1000' } })
        expect([gt('$1,200.00'), gt('$320.00'), gt(''), gt('N/A')]).toEqual([true, false, false, false])
        expect(compileFilter({ include: null, cond: { op: 'contains', value: 'ele' } })('Electronics')).toBe(true)
        expect(compileFilter({ include: null, cond: { op: 'empty' } })('  ')).toBe(true)
        expect(compileFilter({ include: null, cond: { op: 'lt', value: '2024-02-01' } })('15 Jan 2024')).toBe(true)
    })
    it('checklist with blanks', () => {
        const f = compileFilter({ include: [''], cond: null })
        expect([f(''), f('x')]).toEqual([true, false])
    })
})