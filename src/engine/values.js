// Value classification, comparison and filter predicates. Pure: no React, no engine state.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// "$1,200.00" -> 1200, "10%" -> 0.1, "" -> 0, "N/A" -> NaN
export function toNumberLoose(v) {
    if (typeof v === 'number') return v
    if (typeof v !== 'string') return NaN
    let t = v.trim()
    if (t === '') return 0
    let pct = false
    if (t.endsWith('%')) { pct = true; t = t.slice(0, -1) }
    t = t.replace(/^([-+]?)\$/, '$1').replace(/,/g, '')
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN
    const n = parseFloat(t)
    return pct ? n / 100 : n
}

function dayFromYMD(y, m, d) {
    const t = Date.UTC(y, m - 1, d)
    const dt = new Date(t)
    const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    return ok ? Math.round(t / 86400000) : null
}

// The three sample formats: 2024-01-15, 1/15/2024, 15 Jan 2024 -> day number, or null
export function parseDay(text) {
    const s = String(text).trim()
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
    if (m) return dayFromYMD(+m[1], +m[2], +m[3])
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
    if (m) return dayFromYMD(+m[3], +m[1], +m[2])
    m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s)
    if (m) {
        const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1
        return mo ? dayFromYMD(+m[3], mo, +m[1]) : null
    }
    return null
}

export const normText = (v) => String(v ?? '').trim().toLowerCase()

// rank: 0 number, 1 date, 2 text, 3 blank (blank always sorts last)
export function classify(v) {
    if (v === null || v === undefined) return { rank: 3 }
    if (typeof v === 'number') return Number.isNaN(v) ? { rank: 2, s: 'nan' } : { rank: 0, n: v }
    const s = String(v).trim()
    if (s === '') return { rank: 3 }
    const day = parseDay(s)
    if (day !== null) return { rank: 1, n: day }
    const n = toNumberLoose(s)
    if (!Number.isNaN(n)) return { rank: 0, n }
    return { rank: 2, s: s.toLowerCase() }
}

// Blanks last in BOTH directions. Ties return 0 so the caller's sort stays stable.
export function compareClassified(a, b, desc = false) {
    if (a.rank === 3 || b.rank === 3) return a.rank === b.rank ? 0 : a.rank === 3 ? 1 : -1
    let c
    if (a.rank !== b.rank) c = a.rank - b.rank
    else if (a.rank === 2) c = a.s < b.s ? -1 : a.s > b.s ? 1 : 0
    else c = a.n - b.n
    return desc ? -c : c
}

/**
 * Filter spec: { include: string[] | null, cond: { op, value } | null }
 *  include = normalised keys allowed ('' = blanks), null = no checklist restriction
 *  cond.op = 'contains' | 'gt' | 'lt' | 'empty'
 * Returns a predicate over a cell's display value.
 */
export function compileFilter(spec) {
    const include = spec.include ? new Set(spec.include) : null
    const cond = spec.cond
    const needle = cond && cond.op === 'contains' ? normText(cond.value) : ''
    const target = cond && (cond.op === 'gt' || cond.op === 'lt') ? classify(cond.value) : null
    return (display) => {
        const key = normText(display)
        if (include && !include.has(key)) return false
        if (!cond) return true
        if (cond.op === 'empty') return key === ''
        if (cond.op === 'contains') return key.includes(needle)
        const v = classify(display)
        if (v.rank > 1 || target.rank > 1 || v.rank !== target.rank) return false
        return cond.op === 'gt' ? v.n > target.n : v.n < target.n
    }
}

// Distinct values grouped on the normalised key ("West", "west", " WEST " are one entry)
// label = first-seen spelling. Sorted with the same rules as sorting.
export function distinctValues(displays) {
    const map = new Map()
    for (const d of displays) {
        const key = normText(d)
        const e = map.get(key)
        if (e) e.count++
        else map.set(key, { key, label: key === '' ? '' : String(d).trim(), count: 1 })
    }
    return [...map.values()].sort((a, b) => compareClassified(classify(a.label), classify(b.label), false))
}