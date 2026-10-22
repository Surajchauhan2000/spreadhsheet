// Reads the sheet's COMPUTED values into a plain table. The only bridge between engine and AI code.
export function readTable(engine) {
    const used = engine.getUsedRange()
    if (!used) return null
    const table = []
    for (let r = used.r1; r <= used.r2; r++) {
        const row = []
        for (let c = used.c1; c <= used.c2; c++) {
            const cell = engine.getCell(r, c)
            // formula -> computed value; plain cell -> the text exactly as typed
            row.push(cell.error ? cell.error : cell.raw.startsWith('=') ? cell.computed : cell.raw)
        }
        table.push(row)
    }
    return { table, used }
}