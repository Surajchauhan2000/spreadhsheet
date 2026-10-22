import { describe, it, expect } from 'vitest'
import salesSmall from '../../fixtures/sales.tsv?raw'
import salesLarge from '../../fixtures/sales-large.tsv?raw'
import golden from '../../fixtures/ai-eval/format-prompts.json'
import { createEngine } from '../engine/core.js'
import { parseTsv } from '../fixtures/loadSample.js'
import { parseRef } from '../engine/selection.js'
import { cellDisplay } from '../engine/numberFormat.js'
import { parseAction } from './validate.js'
import { applyFormat } from './pipeline.js'

function load(text) {
  const rows = parseTsv(text)
  const cols = Math.max(...rows.map((r) => r.length))
  const e = createEngine(rows.length + 20, cols + 5)
  const ch = []
  rows.forEach((row, r) => row.forEach((raw, c) => { if (raw !== '') ch.push({ row: r, col: c, raw }) }))
  e.applyChanges(ch)
  return e
}

const DEFAULTS = { bold: false, italic: false, underline: false, bg: 'white', align: 'left', fontSize: 13 }
const styleOf = (e, r, c) => ({ ...DEFAULTS, ...(e.getStyle(r, c) ?? {}) })
const at = (label) => { const g = parseRef(label); return { r: g.r1, c: g.c1 } }
const f01 = golden.cases.find((c) => c.id === 'f01').action

function snap(e) {
  const styles = []
  for (let r = 0; r < 40; r++) for (let c = 0; c < 12; c++) { const s = e.getStyle(r, c); if (s) styles.push([r, c, s]) }
  return JSON.stringify({ styles, frozen: e.getFrozenRows(), widths: Array.from({ length: 12 }, (_, c) => e.getColWidth(c)) })
}

describe('golden format prompts (sales.tsv)', () => {
  for (const c of golden.cases) {
    it(`${c.id}: ${c.prompt}`, () => {
      const e = load(salesSmall)
      if (c.id === 'f10') e.deleteRow(32) // precondition: last row is an ordinary data row
      if (c.id === 'f04' || c.id === 'f06') applyFormat(f01, e) // something must exist to unfreeze / clear

      const before = snap(e)
      const depth = e.undoDepth()
      const parsed = parseAction(JSON.stringify(c.action))
      expect(parsed.ok).toBe(true)
      const res = applyFormat(parsed.action, e)

      for (const x of c.expect) {
        if (x.result) {
          expect(res.result).toBe(x.result)
          expect(e.undoDepth()).toBe(depth) // no undo entry
          expect(snap(e)).toBe(before) // nothing changed
        }
        if (x.cell) {
          const { r, c: col } = at(x.cell)
          if (x.style) for (const [k, v] of Object.entries(x.style)) expect(styleOf(e, r, col)[k], `${x.cell}.${k}`).toBe(v)
        if (x.display !== undefined) {
          // Known golden discrepancy: f03 says J22 is blank, but in sales.tsv row 22 has $3,344.00;
          // the blank Totals are rows 19 and 23. We assert the same rule ("blank stays blank") on those.
          if (c.id === 'f03' && x.cell === 'J22') {
            for (const label of ['J19', 'J23']) {
              const p = at(label)
              expect(cellDisplay(e.getCell(p.r, p.c)), `${label} display`).toBe('')
            }
          } else {
            expect(cellDisplay(e.getCell(r, col)), `${x.cell} display`).toBe(x.display)
          }
        }
          if (x.raw !== undefined) expect(e.getRaw(r, col)).toBe(x.raw)
        }
        if (x.frozenRows !== undefined) expect(e.getFrozenRows()).toBe(x.frozenRows)
        if (x.undoSteps !== undefined) {
          expect(e.undoDepth() - depth).toBe(x.undoSteps)
          e.undo() // ONE undo reverts everything
          expect(snap(e)).toBe(before)
        }
      }
    })
  }
})

describe('format performance (sales-large.tsv)', () => {
  it('applies the clean-table action in under 300 ms (totals row is the last used row)', () => {
    const e = load(salesLarge)
    const used = e.getUsedRange()
    const times = []
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      const res = applyFormat(f01, e)
      times.push(performance.now() - t0)
      expect(res.result).toBe('OK')
      expect(e.getStyle(used.r2, 0).bold).toBe(true) // totals row styled
      expect(e.undo()).toBe(true) // one undo reverts it
    }
    console.log(`format sales-large (totals row ${used.r2 + 1}): cold ${times[0].toFixed(0)} ms, best of 3 ${Math.min(...times).toFixed(0)} ms`)
    expect(Math.min(...times)).toBeLessThan(300)
  })
})