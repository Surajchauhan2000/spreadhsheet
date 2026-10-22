// Pure format_sheet applier (AI_CONTRACT.md section 4). No React, no engine import.
// sheet = { used, getCell(r,c), getStyle(r,c), getColWidth(c), frozenRows }
// Returns a PLAN; the caller writes it with ONE engine.applyChanges(...) call = one undo step.
import { toNum, cellDisplay } from '../engine/numberFormat.js'

const TOTALS_RE = /^(grand\s+)?(total|totals|subtotal|sum)\b/i
const MIN_W = 30
const MAX_W = 600

function looksLikeTotals(vals) {
    const filled = vals.map((v) => String(v ?? '').trim()).filter((v) => v !== '')
    if (filled.length === 0) return false
    if (TOTALS_RE.test(filled[0])) return true
    // summary line: text label first, then only numbers, a gap somewhere, >= 2 filled, not all filled
    if (filled.length < 2 || filled.length === vals.length) return false
    if (toNum(filled[0]) !== null) return false
    return filled.slice(1).every((v) => toNum(v) !== null)
}

const merge = (base, layer) => {
    const out = { ...base, ...layer }
    if (out.numberFormat === 'general') delete out.numberFormat
    return out
}

function sameStyle(a, b) {
    const ka = a ? Object.keys(a) : []
    const kb = b ? Object.keys(b) : []
    if (ka.length !== kb.length) return false
    for (const k of ka) if (a[k] !== b[k]) return false
    return true
}

const noPlan = (result, message) => ({
    result, message, changes: [], widths: [], freezeRows: undefined,
    info: { cellsChanged: 0, colsApplied: 0, colsIgnored: 0, totalsRow: null, totalsDropped: false },
})

export function planFormat(action, sheet, { measure = (t) => t.length * 7.8 } = {}) {
    const { used } = sheet
    if (!used) return noPlan('NO_CHANGES', 'The sheet is empty.')
    const usedRows = used.r2 - used.r1 + 1

    // 5. freezing every used row is refused and NOTHING else in the action is applied
    const fz = action.freezeRows
    if (typeof fz === 'number' && fz >= usedRows) {
        return noPlan('OUT_OF_RANGE', `Cannot freeze ${fz} rows: the table has only ${usedRows}, so everything would be frozen. Nothing was changed.`)
    }

    const hr = used.r1 // 1. header row
    const inCols = (c) => Number.isInteger(c) && c >= used.c1 && c <= used.c2

    // 2. totals row only if the last used row looks like one; otherwise totalsStyle is dropped
    let totalsRow = null
    let totalsDropped = false
    if (used.r2 > hr) {
        const vals = []
        for (let c = used.c1; c <= used.c2; c++) {
            const cell = sheet.getCell(used.r2, c)
            vals.push(cell.error ? cell.error : cell.raw.startsWith('=') ? cell.computed : cell.raw)
        }
        if (looksLikeTotals(vals)) totalsRow = used.r2
    }
    if (action.totalsStyle && totalsRow === null) totalsDropped = true

    // 4. column indices outside the used range are ignored
    const colStyles = new Map()
    let colsApplied = 0
    let colsIgnored = 0
    for (const e of action.columns ?? []) {
        if (inCols(e.col)) { colStyles.set(e.col, { ...(colStyles.get(e.col) ?? {}), ...e.style }); colsApplied++ }
        else colsIgnored++
    }

    // 3. order: clearFormatting -> bodyStyle -> columns[] -> totalsStyle -> headerStyle (last, wins)
    const clear = action.clearFormatting === true
    const needFinals = action.autoFitColumns === true
    const finals = new Map()
    const changes = []
    for (let r = used.r1; r <= used.r2; r++) {
        const isHeader = r === hr
        const isTotals = r === totalsRow
        const touched = clear || (isHeader
            ? !!action.headerStyle
            : !!(action.bodyStyle || colStyles.size || (isTotals && action.totalsStyle)))
        if (!touched) continue
        for (let c = used.c1; c <= used.c2; c++) {
            const cur = sheet.getStyle(r, c)
            let st = clear ? {} : cur ?? {}
            if (isHeader) {
                if (action.headerStyle) st = merge(st, action.headerStyle)
            } else {
                if (action.bodyStyle) st = merge(st, action.bodyStyle)
                const cs = colStyles.get(c)
                if (cs) st = merge(st, cs)
                if (isTotals && action.totalsStyle) st = merge(st, action.totalsStyle)
            }
            if (needFinals) finals.set(r * 4096 + c, st)
            if (!sameStyle(cur, st)) changes.push({ row: r, col: c, style: Object.keys(st).length ? st : null })
        }
    }

    // widths: explicit first, auto-fit last (measures the text AFTER the new number formats)
    const widthMap = new Map()
    for (const w of action.columnWidths ?? []) {
        if (inCols(w.col) && w.width >= MIN_W && w.width <= MAX_W) widthMap.set(w.col, w.width)
    }
    if (action.autoFitColumns) {
        for (let c = used.c1; c <= used.c2; c++) {
            const cache = new Map()
            let max = 0
            for (let r = used.r1; r <= used.r2; r++) {
                const cell = sheet.getCell(r, c)
                const text = cellDisplay({ ...cell, style: finals.get(r * 4096 + c) ?? cell.style })
                if (!text) continue
                let w = cache.get(text)
                if (w === undefined) { w = measure(text); cache.set(text, w) }
                if (w > max) max = w
            }
            widthMap.set(c, Math.min(MAX_W, Math.max(MIN_W, Math.ceil(max + 16))))
        }
    }
    const widths = []
    for (const [col, width] of widthMap) if (width !== sheet.getColWidth(col)) widths.push({ col, width })

    const freezeRows = typeof fz === 'number' && fz !== sheet.frozenRows ? fz : undefined
    const info = { cellsChanged: changes.length, colsApplied, colsIgnored, totalsRow, totalsDropped }
    if (changes.length === 0 && widths.length === 0 && freezeRows === undefined) {
        return { ...noPlan('NO_CHANGES', 'Nothing to change: the sheet already looks like this, or the request does not apply to this table.'), info }
    }
    return { result: 'OK', message: '', changes, widths, freezeRows, info }
}