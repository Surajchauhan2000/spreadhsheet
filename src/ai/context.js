// Builds the sheet context sent to the model: headers, inferred types, <= 5 sample rows,
// row count, selection. NEVER the whole sheet.
import { readTable } from './sheetData.js'
import { norm, toNum, toDate, isTotalsRow } from './queryExecutor.js'
import { columnLabel } from '../engine/selection.js'

function inferType(values) {
    if (values.length === 0) return 'text'
    let date = 0, currency = 0, percent = 0, id = 0, number = 0
    for (const v of values) {
        const s = String(v).trim()
        if (toDate(s) !== null) date++
        else if (/^[-+]?\$/.test(s)) currency++
        else if (s.endsWith('%')) percent++
        else if (/^[A-Za-z]{2,}[-_]?\d+$/.test(s)) id++
        else if (toNum(s) !== null) number++
    }
    const n = values.length
    if (date >= n * 0.5) return 'date'
    if (currency >= n * 0.5) return 'currency'
    if (percent >= n * 0.25) return 'percent'
    if (id >= n * 0.5) return 'id'
    if (number + currency + percent >= n * 0.5) return 'number'
    return 'text'
}

export function buildContext(engine, selection = '') {
    const data = readTable(engine)
    if (!data) return { empty: true, selection }
    const { table, used } = data
    const header = table[0].map((h) => String(h ?? '').trim())
    let body = table.slice(1).filter((row) => row.some((c) => norm(c) !== ''))
    const hasTotalsRow = body.length > 0 && isTotalsRow(body[body.length - 1])
    if (hasTotalsRow) body = body.slice(0, -1)

    const columns = header.map((name, i) => {
        const vals = []
        for (let r = 0; r < body.length && vals.length < 200; r++) {
            if (norm(body[r][i]) !== '') vals.push(body[r][i])
        }
        return {
            name,
            index: used.c1 + i,
            type: inferType(vals),
            examples: [...new Set(vals.map((v) => String(v).trim()))].slice(0, 3),
        }
    })
    return {
        range: `${columnLabel(used.c1)}${used.r1 + 1}:${columnLabel(used.c2)}${used.r2 + 1}`,
        rowCount: body.length,
        columns,
        sampleRows: body.slice(0, 5).map((row) => header.map((_, i) => String(row[i] ?? ''))),
        selection,
        hasTotalsRow,
    }
}