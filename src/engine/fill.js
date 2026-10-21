// Pure fill logic. No React, no DOM, no engine state.
// Works on raw cell strings; the caller reads/writes them through the engine.

import { shiftFormulaForFill } from './core'

const NUM_RE = /^-?\d+(\.\d+)?$/
const TRAIL_RE = /^(.*?)(\d+)$/ // "ORD-1001" -> prefix "ORD-", digits "1001"

// ── helpers ──

const pad2 = (n) => String(n).padStart(2, '0')
const fmtNum = (x) => String(Math.round(x * 1e10) / 1e10)

function seriesStep(nums) {
    return (nums[nums.length - 1] - nums[0]) / (nums.length - 1)
}

// ── dates ──
// Each format knows how to parse a seed and print a day back in the seed's style.
// TODO: add the third sample format listed in AI_CONTRACT.md / sales.tsv.

const DATE_FORMATS = [
    {
        parse(s) {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
            return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null
        },
        format: (p) => `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`,
    },
    {
        parse(s) {
            const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
            return m ? { y: +m[3], mo: +m[1], d: +m[2], pad: /^0/.test(m[1]) || /^0/.test(m[2]) } : null
        },
        format: (p, seed) => {
            const f = seed.pad ? pad2 : String
            return `${f(p.mo)}/${f(p.d)}/${p.y}`
        },
    },
]

function toDayNumber({ y, mo, d }) {
    const t = Date.UTC(y, mo - 1, d)
    const dt = new Date(t)
    const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    return valid ? Math.round(t / 86400000) : null
}

function fromDayNumber(n) {
    const dt = new Date(n * 86400000)
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

function parseAnyDate(s) {
    const text = s.trim()
    for (const fmt of DATE_FORMATS) {
        const parts = fmt.parse(text)
        if (!parts) continue
        const day = toDayNumber(parts)
        if (day !== null) return { fmt, parts, day }
    }
    return null
}

// ── weekday / month names ──

const NAME_LISTS = [
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
]

function caseStyle(s) {
    const t = s.trim()
    if (t.length > 1 && t === t.toUpperCase()) return 'upper'
    if (t === t.toLowerCase()) return 'lower'
    return 'title'
}

function applyCase(word, style) {
    if (style === 'upper') return word.toUpperCase()
    if (style === 'lower') return word
    return word[0].toUpperCase() + word.slice(1)
}

// ── generators: each returns k -> raw string, or null if the seeds don't fit ──

function numericGen(seeds) {
    if (!seeds.every((s) => NUM_RE.test(s.trim()))) return null
    // "007", "008" keep their zero padding: let the text-number generator handle them
    if (seeds.some((s) => /^-?0\d/.test(s.trim()))) return null
    if (seeds.length === 1) return () => seeds[0]
    const nums = seeds.map(Number)
    const step = seriesStep(nums)
    const last = nums[nums.length - 1]
    return (k) => fmtNum(last + step * (k + 1))
}

function dateGen(seeds) {
    const parsed = seeds.map(parseAnyDate)
    if (parsed.some((p) => p === null)) return null
    if (seeds.length === 1) return () => seeds[0]
    const days = parsed.map((p) => p.day)
    const step = Math.round(seriesStep(days))
    const last = days[days.length - 1]
    // Each filled cell prints in the format of the seed it is paired with.
    return (k) => {
        const src = parsed[k % seeds.length]
        return src.fmt.format(fromDayNumber(last + step * (k + 1)), src.parts)
    }
}

function nameGen(seeds, dir) {
    const lower = seeds.map((s) => s.trim().toLowerCase())
    const list = NAME_LISTS.find((l) => lower.every((s) => l.includes(s)))
    if (!list) return null
    const len = list.length
    const idx = lower.map((s) => list.indexOf(s))
    const n = seeds.length
    const step = n >= 2 ? idx[n - 1] - idx[n - 2] : dir
    return (k) => {
        const i = (((idx[n - 1] + step * (k + 1)) % len) + len) % len
        return applyCase(list[i], caseStyle(seeds[k % n]))
    }
}

function textNumberGen(seeds, dir) {
    const ms = seeds.map((s) => TRAIL_RE.exec(s))
    if (ms.some((m) => !m)) return null
    const prefix = ms[0][1]
    if (ms.some((m) => m[1] !== prefix)) return null
    const nums = ms.map((m) => parseInt(m[2], 10))
    const padded = ms.some((m) => m[2].length > 1 && m[2][0] === '0')
    const width = padded ? Math.max(...ms.map((m) => m[2].length)) : 0
    const step = seeds.length >= 2 ? seriesStep(nums) : dir
    const last = nums[nums.length - 1]
    return (k) => {
        const v = Math.max(0, Math.round(last + step * (k + 1)))
        return prefix + String(v).padStart(width, '0')
    }
}

function pickGenerator(seeds, dir) {
    if (seeds.some((s) => s.startsWith('='))) return null // formulas: copy + shift
    return numericGen(seeds) || dateGen(seeds) || nameGen(seeds, dir) || textNumberGen(seeds, dir)
}

function copyWithShift(raw, distance, axis, reverse) {
    if (!raw.startsWith('=')) return raw
    const d = reverse ? -distance : distance
    return axis === 'row' ? shiftFormulaForFill(raw, d, 0) : shiftFormulaForFill(raw, 0, d)
}

/**
 * Extend one line of seed cells.
 * seeds   raw strings in processing order (for up/left fills the caller reverses them)
 * count   how many new cells to produce
 * opts    axis: 'row' | 'col' (formula shift direction), reverse: fill goes up/left
 * returns [{ raw, seed }] where seed = index into `seeds` whose style the cell inherits
 */
export function fillLine(seeds, count, { axis = 'row', reverse = false } = {}) {
    const n = seeds.length
    if (n === 0 || count <= 0) return []
    const dir = reverse ? -1 : 1
    const gen = pickGenerator(seeds, dir)
    const out = []
    for (let k = 0; k < count; k++) {
        const seed = k % n
        const raw = gen ? gen(k) : copyWithShift(seeds[seed], n + k - seed, axis, reverse)
        out.push({ raw, seed })
    }
    return out
}

function fillAlongAxis(source, target, getRaw, vertical) {
    const changes = []
    const lineStart = vertical ? source.c1 : source.r1
    const lineEnd = vertical ? source.c2 : source.r2
    const seedStart = vertical ? source.r1 : source.c1
    const seedEnd = vertical ? source.r2 : source.c2
    const targetStart = vertical ? target.r1 : target.c1
    const targetEnd = vertical ? target.r2 : target.c2
    const at = (line, pos) => (vertical ? { row: pos, col: line } : { row: line, col: pos })
    const axis = vertical ? 'row' : 'col'

    for (let line = lineStart; line <= lineEnd; line++) {
        const seeds = []
        for (let p = seedStart; p <= seedEnd; p++) {
            const { row, col } = at(line, p)
            seeds.push(getRaw(row, col) ?? '')
        }
        const after = targetEnd - seedEnd
        if (after > 0) {
            fillLine(seeds, after, { axis }).forEach(({ raw, seed }, k) => {
                changes.push({ ...at(line, seedEnd + 1 + k), raw, styleFrom: at(line, seedStart + seed) })
            })
        }
        const before = seedStart - targetStart
        if (before > 0) {
            fillLine(seeds.slice().reverse(), before, { axis, reverse: true }).forEach(({ raw, seed }, k) => {
                changes.push({ ...at(line, seedStart - 1 - k), raw, styleFrom: at(line, seedEnd - seed) })
            })
        }
    }
    return changes
}

/**
 * Plan a fill from `source` to `target` (both {r1,c1,r2,c2}, inclusive, 0-based).
 * Returns [{ row, col, raw, styleFrom }] for the cells to write (styleFrom = seed cell
 * whose style to copy), or [{ row, col, raw: '', clear: true }] when target is smaller
 * than source (dragging back shrinks the fill). Pure: reads cells only via getRaw.
 */
export function planFill(source, target, getRaw) {
    const rowGrow = Math.max(target.r2 - source.r2, 0) + Math.max(source.r1 - target.r1, 0)
    const colGrow = Math.max(target.c2 - source.c2, 0) + Math.max(source.c1 - target.c1, 0)

    if (rowGrow === 0 && colGrow === 0) {
        const clears = []
        for (let r = source.r1; r <= source.r2; r++) {
            for (let c = source.c1; c <= source.c2; c++) {
                const inside = r >= target.r1 && r <= target.r2 && c >= target.c1 && c <= target.c2
                if (!inside) clears.push({ row: r, col: c, raw: '', styleFrom: null, clear: true })
            }
        }
        return clears
    }
    return fillAlongAxis(source, target, getRaw, rowGrow >= colGrow)
}