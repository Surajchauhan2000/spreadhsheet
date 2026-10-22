// Plain-words description of a query plan (shown on the result card).
import { MAX_RESULT_ROWS } from './contract.js'

const OPS = {
    eq: 'equals', neq: 'does not equal', gt: 'is greater than', gte: 'is at least', lt: 'is less than',
    lte: 'is at most', contains: 'contains', startsWith: 'starts with', endsWith: 'ends with',
    isEmpty: 'is empty', notEmpty: 'is not empty',
}
const FNS = { sum: 'Sum', avg: 'Average', count: 'Count', countDistinct: 'Distinct count', min: 'Minimum', max: 'Maximum' }

export function describePlan(plan) {
    const parts = []
    const aggs = plan.aggregates ?? []
    const groups = plan.groupBy ?? []
    if (aggs.length) parts.push(aggs.map((a) => `${FNS[a.fn] ?? a.fn} of ${a.column}${a.as ? ` (as "${a.as}")` : ''}`).join(', '))
    else if (groups.length) parts.push('Distinct combinations')
    else parts.push(plan.columns?.length ? `Rows with columns ${plan.columns.join(', ')}` : 'Rows with all columns')
    if (groups.length) parts.push(`grouped by ${groups.join(' and ')}`)
    if (plan.filters?.length) {
        parts.push('where ' + plan.filters.map((f) =>
            `${f.column} ${OPS[f.op] ?? f.op}${f.op === 'isEmpty' || f.op === 'notEmpty' ? '' : ' ' + f.value}`).join(' and '))
    }
    if (plan.sort?.length) parts.push('sorted by ' + plan.sort.map((s) => `${s.column} ${s.dir === 'desc' ? 'descending' : 'ascending'}`).join(', then '))
    parts.push(`at most ${Math.min(plan.limit ?? MAX_RESULT_ROWS, MAX_RESULT_ROWS)} rows`)
    if (plan.excludeTotalsRow === false) parts.push('including the totals row')
    return parts.join(', ') + '.'
}