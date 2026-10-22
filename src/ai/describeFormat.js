// Plain-words preview of a format_sheet action ("header: bold, grey; 4 columns: number formats; freeze 1 row").
function colorName(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
    if (!m) return hex
    const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16))
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min < 24) return max > 248 ? 'white' : max > 120 ? 'grey' : 'dark'
    let h
    if (max === r) h = (60 * ((g - b) / (max - min)) + 360) % 360
    else if (max === g) h = 60 * ((b - r) / (max - min)) + 120
    else h = 60 * ((r - g) / (max - min)) + 240
    if (h < 20 || h >= 340) return 'red'
    if (h < 45) return 'orange'
    if (h < 70) return 'yellow'
    if (h < 170) return 'green'
    if (h < 200) return 'teal'
    if (h < 260) return 'blue'
    if (h < 290) return 'purple'
    return 'pink'
}

function styleWords(s) {
    const w = []
    if (s.bold) w.push('bold')
    if (s.italic) w.push('italic')
    if (s.underline) w.push('underlined')
    if (s.bg) w.push(s.bg === 'white' ? 'white background' : colorName(s.bg))
    if (s.color) w.push(`${colorName(s.color)} text`)
    if (s.align) w.push(`${s.align}-aligned`)
    if (s.fontSize) w.push(`${s.fontSize}pt`)
    if (s.numberFormat) w.push(`${s.numberFormat} format`)
    return w
}

export function describeFormat(action, plan) {
    if (plan.result !== 'OK') return plan.message
    const i = plan.info
    const parts = []
    if (action.clearFormatting) parts.push('clear all formatting first')
    if (action.headerStyle) parts.push(`header: ${styleWords(action.headerStyle).join(', ')}`)
    if (action.bodyStyle) parts.push(`body: ${styleWords(action.bodyStyle).join(', ')}`)
    if (i.colsApplied) {
        const entries = action.columns ?? []
        const fmts = [...new Set(entries.map((e) => e.style.numberFormat).filter(Boolean))]
        const other = [...new Set(entries.flatMap((e) => styleWords({ ...e.style, numberFormat: undefined })))]
        const bits = []
        if (fmts.length) bits.push(`number formats (${fmts.join(', ')})`)
        bits.push(...other)
        parts.push(`${i.colsApplied} column${i.colsApplied === 1 ? '' : 's'}: ${bits.join(', ')}`)
    }
    if (i.colsIgnored) parts.push(`${i.colsIgnored} column${i.colsIgnored === 1 ? '' : 's'} outside the table ignored`)
    if (action.totalsStyle) {
        parts.push(i.totalsDropped ? 'totals style skipped (the last row is not a totals row)' : `totals row: ${styleWords(action.totalsStyle).join(', ')}`)
    }
    if (plan.freezeRows !== undefined) parts.push(plan.freezeRows === 0 ? 'unfreeze rows' : `freeze ${plan.freezeRows} row${plan.freezeRows === 1 ? '' : 's'}`)
    if (action.autoFitColumns) parts.push('auto-fit column widths')
    else if (plan.widths.length) parts.push(`${plan.widths.length} column width${plan.widths.length === 1 ? '' : 's'}`)
    return parts.join('; ')
}