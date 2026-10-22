import { planFill } from './fill'

// Fill `source` out to `target` (both {r1,c1,r2,c2}). One undo step.
// Filled cells inherit the style of their seed; shrinking clears values only.
export function fillRange(engine, source, target) {
    const plan = planFill(source, target, (r, c) => engine.getRaw(r, c))
    const changes = plan.map((p) => {
        if (p.clear) return { row: p.row, col: p.col, raw: '' }
        const seedStyle = engine.getStyle(p.styleFrom.row, p.styleFrom.col)
        return { row: p.row, col: p.col, raw: p.raw, style: seedStyle ?? null }
    })
    return engine.applyChanges(changes)
}