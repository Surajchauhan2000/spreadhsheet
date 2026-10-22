// Read-only query executor. Pure: no React, no engine. Follows AI_CONTRACT.md section 3.
// Input: a table = array of rows (arrays), row 0 is the header. Values are computed cell values.
import { MAX_RESULT_ROWS, FILTER_OPS, AGGREGATE_FNS } from './contract.js'

const TOTALS_RE = /^(grand\s+)?(total|totals|subtotal|sum)\b/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export const norm = (v) => String(v ?? '').trim().toLowerCase()

/** "$1,200.00" -> 1200, "10%" -> 0.1, "N/A" -> null */
export function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (v === null || v === undefined) return null
    let t = String(v).trim()
    const pct = t.endsWith('%')
    t = t.replace(/[$,%\s]/g, '')
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null
    const n = parseFloat(t)
    return pct ? n / 100 : n
}

function dayOf(y, m, d) {
    const t = Date.UTC(y, m - 1, d)
    const dt = new Date(t)
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? Math.round(t / 86400000) : null
}

/** YYYY-M-D, M/D/YYYY, D Mon YYYY (3+ letter English month) -> day number (same order as the ISO string) or null */
export function toDate(v) {
    const s = String(v ?? '').trim()
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
    if (m) return dayOf(+m[1], +m[2], +m[3])
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
    if (m) return dayOf(+m[3], +m[1], +m[2])
    m = /^(\d{1,2}) ([A-Za-z]{3,}) (\d{4})$/.exec(s)
    if (m) {
        const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
        return mo ? dayOf(+m[3], mo, +m[1]) : null
    }
    return null
}

export function isTotalsRow(row) {
    for (const cell of row) {
        const t = String(cell ?? '').trim()
        if (t !== '') return TOTALS_RE.test(t)
    }
    return false
}

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100

function fail(code, detail) {
    throw Object.assign(new Error(detail), { code })
}

const CMP = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b }

function makeFilter(ci, op, v) {
    const vNum = toNum(v)
    const vNorm = norm(v)
    const vDate = v === null || v === undefined ? null : toDate(v)
    switch (op) {
        case 'eq':
        case 'neq': {
            const same = (c) => {
                const cn = vNum !== null ? toNum(c) : null
                return cn !== null ? cn === vNum : norm(c) === vNorm
            }
            return op === 'eq' ? (row) => same(row[ci]) : (row) => !same(row[ci])
        }
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
            const cmp = CMP[op]
            if (vDate !== null) {
                return (row) => {
                    const d = toDate(row[ci])
                    return d !== null && cmp(d, vDate)
                }
            }
            return (row) => {
                const n = toNum(row[ci])
                return vNum !== null && n !== null && cmp(n, vNum)
            }
        }
        case 'contains': return (row) => norm(row[ci]).includes(vNorm)
        case 'startsWith': return (row) => norm(row[ci]).startsWith(vNorm)
        case 'endsWith': return (row) => norm(row[ci]).endsWith(vNorm)
        case 'isEmpty': return (row) => norm(row[ci]) === ''
        default: return (row) => norm(row[ci]) !== ''
    }
}

function finishAggregate(fn, acc) {
    switch (fn) {
        case 'count': return acc.nonEmpty
        case 'countDistinct': return acc.distinct ? acc.distinct.size : 0
        case 'sum': return acc.n ? round2(acc.sum) : null
        case 'avg': return acc.n ? round2(acc.sum / acc.n) : null
        case 'min': return acc.min === null ? null : round2(acc.min)
        default: return acc.max === null ? null : round2(acc.max)
    }
}

// Stable multi-key sort. Numbers before non-numbers (in either direction), then text.
function sortItems(items, keys) {
    if (keys.length === 0) return items
    const decorated = items.map((item, i) => ({
        item, i,
        k: keys.map((s) => {
            const v = s.get(item)
            const n = toNum(v)
            return n !== null ? { n } : { t: norm(v) }
        }),
    }))
    decorated.sort((a, b) => {
        for (let j = 0; j < keys.length; j++) {
            const x = a.k[j]
            const y = b.k[j]
            let c
            if (x.n !== undefined && y.n !== undefined) c = x.n - y.n
            else if (x.n !== undefined) return -1
            else if (y.n !== undefined) return 1
            else c = x.t < y.t ? -1 : x.t > y.t ? 1 : 0
            if (c) return keys[j].desc ? -c : c
        }
        return a.i - b.i
    })
    return decorated.map((d) => d.item)
}

/**
 * Run a validated query plan over a table.
 * Returns { columns, rows, rowCount, truncated } or { error, detail }.
 */
export function executeQuery(plan, table) {
    if (!plan || plan.type !== 'query') return { error: 'READ_ONLY', detail: `READ_ONLY:${plan && plan.type}` }
    if (!table || table.length === 0) return { error: 'NO_DATA', detail: 'The sheet is empty' }
    try {
        return run(plan, table)
    } catch (e) {
        if (e && e.code) return { error: e.code, detail: e.message }
        throw e
    }
}

function run(plan, table) {
    const header = table[0].map((h) => String(h ?? '').trim())
    const colIdx = new Map()
    header.forEach((h, i) => { if (!colIdx.has(h.toLowerCase())) colIdx.set(h.toLowerCase(), i) })
    const resolve = (name) => {
        const i = colIdx.get(norm(name))
        if (i === undefined) fail('UNKNOWN_COLUMN', `UNKNOWN_COLUMN:${name}`)
        return i
    }

    // 3.1 rows: skip blank rows, drop the totals row unless asked to keep it
    const body = []
    for (let i = 1; i < table.length; i++) {
        const row = table[i]
        if (row.every((c) => norm(c) === '')) continue
        body.push(row)
    }
    if (plan.excludeTotalsRow !== false && body.length && isTotalsRow(body[body.length - 1])) body.pop()

    // validate every column / op / fn name BEFORE touching data
    const filters = (plan.filters ?? []).map((f) => {
        const ci = resolve(f.column)
        if (!FILTER_OPS.includes(f.op)) fail('UNKNOWN_OP', `UNKNOWN_OP:${f.op}`)
        return makeFilter(ci, f.op, f.value)
    })
    const groupBy = (plan.groupBy ?? []).map(resolve)
    const aggDefs = (plan.aggregates ?? []).map((a) => {
        if (!AGGREGATE_FNS.includes(a.fn)) fail('UNKNOWN_FN', `UNKNOWN_FN:${a.fn}`)
        return { fn: a.fn, ci: resolve(a.column), name: a.as ?? `${a.fn}(${a.column})` }
    })
    const isGroup = groupBy.length > 0 || aggDefs.length > 0
    const rowCols = !isGroup && plan.columns && plan.columns.length ? plan.columns.map(resolve) : header.map((_, i) => i)

    const want = Number.isFinite(plan.limit) ? Math.floor(plan.limit) : MAX_RESULT_ROWS
    const cap = Math.min(MAX_RESULT_ROWS, Math.max(1, want)) // limit cap is enforced HERE, in code

    const rows = filters.length ? body.filter((r) => filters.every((f) => f(r))) : body

    let columns
    let items // group results: output arrays. row results: source rows.
    if (isGroup) {
        columns = [...groupBy.map((ci) => header[ci]), ...aggDefs.map((a) => a.name)]
        const newAccs = () => aggDefs.map(() => ({ sum: 0, n: 0, nonEmpty: 0, min: null, max: null, distinct: null }))
        const groups = new Map()
        for (const row of rows) {
            let key = ''
            for (let g = 0; g < groupBy.length; g++) key += norm(row[groupBy[g]]) + '\u0001'
            let grp = groups.get(key)
            if (!grp) {
                // label = trimmed value of the FIRST row seen in the group
                grp = { labels: groupBy.map((ci) => String(row[ci] ?? '').trim()), accs: newAccs() }
                groups.set(key, grp)
            }
            for (let a = 0; a < aggDefs.length; a++) {
                const { fn, ci } = aggDefs[a]
                const acc = grp.accs[a]
                if (fn === 'count') {
                    if (norm(row[ci]) !== '') acc.nonEmpty++
                } else if (fn === 'countDistinct') {
                    const t = norm(row[ci])
                    if (t !== '') (acc.distinct ??= new Set()).add(t)
                } else {
                    const n = toNum(row[ci])
                    if (n !== null) {
                        acc.n++
                        acc.sum += n
                        if (acc.min === null || n < acc.min) acc.min = n
                        if (acc.max === null || n > acc.max) acc.max = n
                    }
                }
            }
        }
        // aggregates with no group-by always yield exactly one row, even over zero rows
        if (groupBy.length === 0 && groups.size === 0) groups.set('', { labels: [], accs: newAccs() })
        items = [...groups.values()].map((g) => [...g.labels, ...aggDefs.map((d, a) => finishAggregate(d.fn, g.accs[a]))])
    } else {
        columns = rowCols.map((ci) => header[ci])
        items = rows
    }

    // 3.5 sort: group results sort on output columns; row results on output OR any source column
    const keys = (plan.sort ?? []).map((s) => {
        const name = norm(s.column)
        const outIdx = columns.findIndex((c) => c.trim().toLowerCase() === name)
        const desc = s.dir === 'desc'
        if (isGroup) {
            if (outIdx < 0) fail('UNKNOWN_SORT_COLUMN', `UNKNOWN_SORT_COLUMN:${s.column}`)
            return { get: (item) => item[outIdx], desc }
        }
        const ci = outIdx >= 0 ? rowCols[outIdx] : colIdx.get(name)
        if (ci === undefined) fail('UNKNOWN_SORT_COLUMN', `UNKNOWN_SORT_COLUMN:${s.column}`)
        return { get: (item) => item[ci], desc }
    })
    const sorted = sortItems(items, keys)

    const truncated = sorted.length > cap
    const cut = truncated ? sorted.slice(0, cap) : sorted
    const out = isGroup ? cut : cut.map((row) => rowCols.map((ci) => String(row[ci] ?? '')))
    return { columns, rows: out, rowCount: out.length, truncated }
}