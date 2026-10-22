// Display-only number formats. Pure: no React, no engine state. The stored value is never rewritten.
import { parseDay } from './values.js'

/** "$1,200.00" -> 1200, "10%" -> 0.1, "$ 49.99" -> 49.99, "n/a" -> null */
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

const fmt2 = (n) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatValue(value, format) {
    if (value === null || value === undefined) return ''
    const text = String(value)
    if (text.trim() === '' || !format || format === 'general') return text
    if (format === 'date') {
        const d = parseDay(text)
        return d === null ? text : new Date(d * 86400000).toISOString().slice(0, 10)
    }
    const n = toNum(value)
    if (n === null) return text // non-numeric text is left alone
    if (format === 'number') return (n < 0 ? '-' : '') + fmt2(n)
    if (format === 'currency') return (n < 0 ? '-$' : '$') + fmt2(n)
    if (format === 'percent') return `${Math.round(n * 1e4) / 100}%`
    return text
}

/** What the grid shows for a getCell() result: error, or value with the cell's numberFormat applied. */
export function cellDisplay(cell) {
    if (cell.error) return cell.error
    const isFormula = cell.raw.startsWith('=')
    const value = isFormula ? cell.computed : cell.raw
    const fmt = cell.style && cell.style.numberFormat
    const text = isFormula
        ? typeof value === 'number' ? String(Math.round(value * 1e10) / 1e10) : value == null ? '' : String(value)
        : cell.raw
    return fmt && fmt !== 'general' ? formatValue(isFormula ? text : value, fmt) : text
}