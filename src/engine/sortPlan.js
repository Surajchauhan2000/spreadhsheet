import { compareClassified } from './values.js'

// Plan a stable sort of `rows` (ascending row indexes).
// mode: 'asc' | 'desc' | 'original'; keyOf(row) -> classified value; idOf(row) -> stable row id.
// Returns Map(oldRow -> newRow) for rows that actually move.
export function planSort(rows, mode, keyOf, idOf) {
    const items = rows.map((r) => ({ r, k: mode === 'original' ? idOf(r) : keyOf(r) }))
    const desc = mode === 'desc'
    items.sort((a, b) => (mode === 'original' ? a.k - b.k : compareClassified(a.k, b.k, desc)) || a.r - b.r)
    const moves = new Map()
    items.forEach((it, i) => { if (it.r !== rows[i]) moves.set(it.r, rows[i]) })
    return moves
}