// Orchestration: prompt -> provider -> parse/validate -> executor / format planner. No React.
import { QUERY_PLAN_SCHEMA, FORMAT_SHEET_SCHEMA, CLARIFY_SCHEMA } from './contract.js'
import { parseAction } from './validate.js'
import { buildContext } from './context.js'
import { readTable } from './sheetData.js'
import { executeQuery } from './queryExecutor.js'
import { planFormat } from './formatApplier.js'
import { describeFormat } from './describeFormat.js'
import { parseRef } from '../engine/selection.js'

export function buildSystemPrompt(context) {
    return [
        'You translate spreadsheet requests into ONE JSON action. You never compute or guess numbers: the app executes your plan.',
        'Answer with a single JSON object and nothing else: no prose, no code fences.',
        'Allowed actions (JSON Schemas):',
        JSON.stringify({ query: QUERY_PLAN_SCHEMA, format_sheet: FORMAT_SHEET_SCHEMA, clarify: CLARIFY_SCHEMA }),
        'Rules:',
        '- Use column names exactly as in the sheet context.',
        '- If the request needs a column that is not in the context, or is ambiguous, answer with a clarify action asking the user.',
        '- Questions about data are "query" actions (read-only). Never output any other action type besides format_sheet and clarify.',
        '- "Top N" means sort + limit. Date filters use ISO YYYY-MM-DD with gte / lt.',
        '- Percent and currency cells may be stored as text like "10%" or "$1,200.00"; the executor normalises them.',
        '- Requests to change how the sheet looks are "format_sheet" actions. Column indexes in format_sheet are the "index" values from the context.',
        '- freezeRows: an integer (0 unfreezes); leave it out when the user did not mention freezing.',
        'Sheet context (headers, types, up to 5 sample rows, never the full data):',
        JSON.stringify(context),
    ].join('\n')
}

export function runQuery(action, engine) {
    const data = readTable(engine)
    if (!data) return { kind: 'error', code: 'NO_DATA', detail: 'The sheet is empty', action }
    const t0 = performance.now()
    const result = executeQuery(action, data.table)
    const ms = performance.now() - t0 // executor only, not the sheet read
    if (result.error) {
        return { kind: 'error', code: result.error, detail: result.detail, action, available: data.table[0].map((h) => String(h ?? '').trim()) }
    }
    return { kind: 'query', action, result, ms }
}

// ── format_sheet ──

function sheetOf(engine) {
    return {
        used: engine.getUsedRange(),
        getCell: engine.getCell,
        getStyle: engine.getStyle,
        getColWidth: engine.getColWidth,
        frozenRows: engine.getFrozenRows(),
    }
}

/** Plan only (no writes): used for the preview card. */
export function previewFormat(action, engine, measure) {
    const t0 = performance.now()
    const plan = planFormat(action, sheetOf(engine), { measure })
    return { kind: 'format', action, plan, text: describeFormat(action, plan), ms: performance.now() - t0 }
}

/** Plan again against the CURRENT sheet and write it as ONE undo step. ms = plan + write (not React). */
export function applyFormat(action, engine, measure) {
    const t0 = performance.now()
    const plan = planFormat(action, sheetOf(engine), { measure })
    if (plan.result === 'OK') {
        engine.applyChanges(plan.changes, { freezeRows: plan.freezeRows, widths: plan.widths })
    }
    return { ...plan, ms: performance.now() - t0 }
}

export function evaluateAction(action, engine, measure) {
    if (action.type === 'clarify') return { kind: 'clarify', action, question: action.question }
    if (action.type === 'query') return runQuery(action, engine)
    return previewFormat(action, engine, measure)
}

/** Full flow. Never throws: every failure becomes an outcome the panel shows. */
export async function requestAction({ provider, engine, prompt, history = [], selection = '', measure }) {
    const system = buildSystemPrompt(buildContext(engine, selection))
    let response
    try {
        // `user` is ONLY the user's prompt (the mock provider matches on it); context lives in `system`.
        response = await provider.complete({ system, user: prompt, history })
    } catch (e) {
        return { outcome: { kind: 'error', code: 'PROVIDER_ERROR', detail: e?.message ?? String(e) } }
    }
    const raw = response.text
    const parsed = parseAction(raw)
    if (!parsed.ok) return { raw, outcome: { kind: 'error', code: parsed.code, detail: parsed.detail } }
    return { raw, outcome: evaluateAction(parsed.action, engine, measure) }
}

/** Write a result table (header + rows) at `where` ("C5"). ONE undo step. */
export function insertResult(engine, result, where) {
    const rg = parseRef(where)
    if (!rg) return { ok: false, error: `"${where}" is not a cell reference` }
    const nRows = result.rows.length + 1
    const nCols = result.columns.length
    if (rg.r1 + nRows > engine.rows || rg.c1 + nCols > engine.cols) {
        return { ok: false, error: `The result (${nRows} rows x ${nCols} columns) does not fit at ${where}` }
    }
    const changes = []
    const put = (r, c, v) => changes.push({ row: rg.r1 + r, col: rg.c1 + c, raw: v === null || v === undefined ? '' : String(v) })
    result.columns.forEach((name, c) => put(0, c, name))
    result.rows.forEach((row, r) => row.forEach((v, c) => put(r + 1, c, v)))
    engine.applyChanges(changes)
    return { ok: true, at: where.trim().toUpperCase() }
}