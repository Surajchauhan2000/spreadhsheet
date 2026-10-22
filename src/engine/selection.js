// Pure selection helpers. No React, no DOM.
// A selection is { anchor: {r,c}, focus: {r,c} }; anchor is the active cell.

export function normRange(sel) {
    const { anchor: a, focus: f } = sel
    return { r1: Math.min(a.r, f.r), c1: Math.min(a.c, f.c), r2: Math.max(a.r, f.r), c2: Math.max(a.c, f.c) }
}

export function inRange(rg, r, c) {
    return r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2
}

export function sameRect(a, b) {
    return a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2
}

export function columnLabel(col) {
    let label = ''
    let n = col + 1
    while (n > 0) {
        n--
        label = String.fromCharCode(65 + (n % 26)) + label
        n = Math.floor(n / 26)
    }
    return label
}

export function rangeLabel(rg) {
    const a = columnLabel(rg.c1) + (rg.r1 + 1)
    if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return a
    return `${a}:${columnLabel(rg.c2)}${rg.r2 + 1}`
}

// Where the fill target ends up while the handle is dragged to cell (pr, pc).
// Grows along the axis the pointer is furthest from the source; pointer inside the
// source shrinks it (values cleared by fillRange).
export function fillTargetFor(S, pr, pc) {
    const down = pr - S.r2
    const up = S.r1 - pr
    const right = pc - S.c2
    const left = S.c1 - pc
    const v = Math.max(down, up, 0)
    const h = Math.max(right, left, 0)
    if (v === 0 && h === 0) {
        const shrinkRows = S.r2 - pr
        const shrinkCols = S.c2 - pc
        return shrinkRows >= shrinkCols ? { ...S, r2: pr } : { ...S, c2: pc }
    }
    if (v >= h) return { ...S, r1: S.r1 - Math.max(up, 0), r2: S.r2 + Math.max(down, 0) }
    return { ...S, c1: S.c1 - Math.max(left, 0), c2: S.c2 + Math.max(right, 0) }
}

// Which rectangle should a header sort use? undefined = let the engine use the used range
// (single cell, whole row/column, the full used range, or a column outside the selection).
export function pickSortRange(sel, col, used, rows, cols) {
    const single = sel.r1 === sel.r2 && sel.c1 === sel.c2
    const fullCol = sel.r1 === 0 && sel.r2 === rows - 1
    const fullRow = sel.c1 === 0 && sel.c2 === cols - 1
    if (single || fullCol || fullRow || (used && sameRect(sel, used))) return undefined
    if (col < sel.c1 || col > sel.c2) return undefined
    return sel
}

function labelToCol(label) {
    let n = 0
    for (const ch of label.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
}

// "AZ5000" or "K2:K100000" (with optional $) -> normalised rect, or null if it is not a reference.
export function parseRef(text) {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)\s*(?::\s*\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(text)
    if (!m) return null
    const r1 = Number(m[2]) - 1
    const c1 = labelToCol(m[1])
    const r2 = m[4] ? Number(m[4]) - 1 : r1
    const c2 = m[3] ? labelToCol(m[3]) : c1
    if (r1 < 0 || r2 < 0) return null
    return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) }
}