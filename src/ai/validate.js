// Hand-written JSON Schema subset validator + model-response parser. Pure: no React, no engine.
import { ACTION_TYPES, QUERY_PLAN_SCHEMA, FORMAT_SHEET_SCHEMA, CLARIFY_SCHEMA } from './contract.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const TYPE_CHECKS = {
    string: (v) => typeof v === 'string',
    number: (v) => typeof v === 'number' && Number.isFinite(v),
    integer: (v) => Number.isInteger(v),
    boolean: (v) => typeof v === 'boolean',
    null: (v) => v === null,
    array: (v) => Array.isArray(v),
    object: isObj,
}

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/** Returns a list of human-readable problems ([] = valid). Supports the keywords contract.js uses. */
export function validate(schema, value, path = '$', errors = []) {
    if ('const' in schema && value !== schema.const) {
        errors.push(`${path}: must be ${JSON.stringify(schema.const)}`)
        return errors
    }
    if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: must be one of ${schema.enum.join(', ')}`)
        return errors
    }
    if (schema.type) {
        const types = [].concat(schema.type)
        if (!types.some((t) => TYPE_CHECKS[t](value))) {
            errors.push(`${path}: expected ${types.join(' or ')}, got ${kindOf(value)}`)
            return errors
        }
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`)
        if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`)
    }
    if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${path}: does not match ${schema.pattern}`)
    }
    if (Array.isArray(value) && schema.items) {
        value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`, errors))
    }
    if (isObj(value)) {
        for (const key of schema.required ?? []) {
            if (!(key in value)) errors.push(`${path}: missing required property "${key}"`)
        }
        const props = schema.properties ?? {}
        for (const [key, v] of Object.entries(value)) {
            if (key in props) validate(props[key], v, `${path}.${key}`, errors)
            else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${key}"`)
        }
    }
    return errors
}

/** First parseable JSON object in the text. Skips prose and code fences; respects braces inside strings. */
export function extractJson(text) {
    if (typeof text !== 'string') return null
    for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
        let depth = 0
        let inStr = false
        let esc = false
        for (let i = start; i < text.length; i++) {
            const ch = text[i]
            if (inStr) {
                if (esc) esc = false
                else if (ch === '\\') esc = true
                else if (ch === '"') inStr = false
                continue
            }
            if (ch === '"') inStr = true
            else if (ch === '{') depth++
            else if (ch === '}') {
                depth--
                if (depth === 0) {
                    const candidate = text.slice(start, i + 1)
                    try {
                        JSON.parse(candidate)
                        return candidate
                    } catch {
                        break // not valid JSON, try the next "{"
                    }
                }
            }
        }
    }
    return null
}

const SCHEMAS = {
    [ACTION_TYPES.QUERY]: QUERY_PLAN_SCHEMA,
    [ACTION_TYPES.FORMAT_SHEET]: FORMAT_SHEET_SCHEMA,
    [ACTION_TYPES.CLARIFY]: CLARIFY_SCHEMA,
}

/**
 * Raw model text -> { ok: true, action } | { ok: false, code, detail }.
 * Nothing downstream may see an action that did not pass through here.
 */
export function parseAction(text) {
    const json = extractJson(text)
    if (json === null) return { ok: false, code: 'INVALID_RESPONSE', detail: 'No valid JSON object found in the model response' }
    const action = JSON.parse(json)
    if (typeof action.type !== 'string') return { ok: false, code: 'INVALID_RESPONSE', detail: '$: missing string property "type"' }
    if (!Object.hasOwn(SCHEMAS, action.type)) {
        return { ok: false, code: 'READ_ONLY', detail: `Action type "${action.type}" is not allowed (only query, format_sheet, clarify)` }
    }
    const errors = validate(SCHEMAS[action.type], action)
    if (errors.length) return { ok: false, code: 'INVALID_RESPONSE', detail: errors.join('; ') }
    return { ok: true, action }
}