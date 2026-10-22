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