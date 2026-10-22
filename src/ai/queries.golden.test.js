import { describe, it, expect } from 'vitest'
import salesLarge from '../../fixtures/sales-large.tsv?raw'
import golden from '../../fixtures/ai-eval/queries.json'
import { parseTsv } from '../fixtures/loadSample.js'
import { parseAction } from './validate.js'
import { executeQuery } from './queryExecutor.js'

const table = parseTsv(salesLarge)

function sameCell(actual, expected) {
  if (typeof expected === 'number') return Math.abs(Number(actual) - expected) <= 0.01
  return String(actual) === String(expected)
}

describe('golden queries (sales-large.tsv)', () => {
  for (const c of golden.cases) {
    it(`${c.id}: ${c.prompt}`, () => {
      const parsed = parseAction(JSON.stringify(c.plan))
      let result
      if (!parsed.ok) result = { error: parsed.code }
      else {
        let best = Infinity
        for (let i = 0; i < 3; i++) {
          const t0 = performance.now()
          result = executeQuery(parsed.action, table)
          best = Math.min(best, performance.now() - t0)
        }
        expect(best).toBeLessThan(50)
      }
      const e = c.expect
      if (e.error) {
        expect(result.error).toBe(e.error)
        if (e.detail) expect(result.detail).toBe(e.detail)
        return
      }
      expect(result.error).toBeUndefined()
      expect(result.columns).toEqual(e.columns)
      expect(result.rowCount).toBe(e.rowCount)
      expect(result.truncated).toBe(e.truncated)
      if (e.rows) {
        const key = (r) => JSON.stringify(r)
        const got = c.plan.sort ? result.rows : [...result.rows].sort((a, b) => key(a).localeCompare(key(b)))
        const want = c.plan.sort ? e.rows : [...e.rows].sort((a, b) => key(a).localeCompare(key(b)))
        expect(got.length).toBe(want.length)
        want.forEach((row, i) => row.forEach((v, j) => expect(sameCell(got[i][j], v)).toBe(true)))
      }
      if (e.rowsPreview) expect(result.rows.slice(0, 10).map((r) => r.map(String))).toEqual(e.rowsPreview)
    })
  }
})

describe('executor performance', () => {
  it('two-level group-by over 100,000 generated rows runs in under 500 ms', () => {
    const regions = ['West', 'west ', 'East', 'North', 'SOUTH', 'Central']
    const cats = ['Electronics', 'Furniture', 'Software', 'Accessories']
    const big = [['Order ID', 'Region', 'Category', 'Units', 'Total']]
    for (let i = 0; i < 100000; i++) big.push([`ORD-${i}`, regions[i % 6], cats[i % 4], String(i % 50), `$${(i % 977) + 0.5}`])
    const plan = {
      type: 'query', groupBy: ['Region', 'Category'],
      aggregates: [{ fn: 'sum', column: 'Total', as: 'Sales' }, { fn: 'count', column: 'Order ID' }],
      sort: [{ column: 'Sales', dir: 'desc' }],
    }
    const t0 = performance.now()
    const res = executeQuery(plan, big)
    const ms = performance.now() - t0
    console.log(`two-level group-by, 100,000 rows: ${ms.toFixed(1)} ms`)
    expect(res.error).toBeUndefined()
    expect(ms).toBeLessThan(500)
  })
})