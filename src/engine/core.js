import { toNumberLoose, classify, compileFilter, distinctValues } from './values.js'
import { planSort } from './sortPlan.js'
import { DEFAULT_COL_W, DEFAULT_ROW_H, MIN_SIZE } from './layout.js'
// ─────────────────────────────────────────────────────────────
//  Operator precedence for expression parsing
// ─────────────────────────────────────────────────────────────

const MAX_UNDO_HISTORY = 100
const STRICT_NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i

// ─────────────────────────────────────────────────────────────
//  Column / Cell coordinate utilities
// ─────────────────────────────────────────────────────────────

function columnLetterToIndex(columnLetter) {
    let index = 0
    for (let i = 0; i < columnLetter.length; i++) {
        index = index * 26 + (columnLetter.charCodeAt(i) - 64)
    }
    return index - 1
}

function indexToColumnLetter(col) {
    let label = ''
    let n = col + 1
    while (n > 0) {
        n--
        label = String.fromCharCode(65 + (n % 26)) + label
        n = Math.floor(n / 26)
    }
    return label
}

function indexToCellKey(row, col) {
    return indexToColumnLetter(col) + (row + 1)
}

// Accepts A1, $A$1, $A1, A$1. Returns 0-based row/col plus absolute flags.
export function parseCellKey(cellKey) {
    const match = cellKey.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/)
    if (!match) return null
    return {
        row: parseInt(match[4], 10) - 1,
        col: columnLetterToIndex(match[2].toUpperCase()),
        colAbs: match[1] === '$',
        rowAbs: match[3] === '$',
    }
}

// ─────────────────────────────────────────────────────────────
//  Dependency graph (tracks which cells depend on which)
// ─────────────────────────────────────────────────────────────

function createDependencyGraph() {
    const forwardEdges = new Map()
    const reverseEdges = new Map()

    function addDependency(cell, dependsOn) {
        if (!forwardEdges.has(cell)) forwardEdges.set(cell, new Set())
        if (!reverseEdges.has(dependsOn)) reverseEdges.set(dependsOn, new Set())
        forwardEdges.get(cell).add(dependsOn)
        reverseEdges.get(dependsOn).add(cell)
    }

    function removeAllDependencies(cell) {
        // Only this cell's OWN precedents. Its dependents keep pointing at it,
        // because they still read this cell (even if it is now blank).
        const deps = forwardEdges.get(cell)
        if (!deps) return
        for (const dep of deps) {
            const rev = reverseEdges.get(dep)
            if (rev) {
                rev.delete(cell)
                if (rev.size === 0) reverseEdges.delete(dep)
            }
        }
        forwardEdges.delete(cell)
    }

    function getDependencies(cell) {
        return forwardEdges.get(cell) || new Set()
    }

    function getDependents(cell) {
        return reverseEdges.get(cell) || new Set()
    }

    function getAllDependentsRecursive(cell, visited = new Set()) {
        if (visited.has(cell)) return new Set()
        visited.add(cell)
        const result = new Set()
        for (const dependent of getDependents(cell)) {
            result.add(dependent)
            for (const indirect of getAllDependentsRecursive(dependent, visited)) {
                result.add(indirect)
            }
        }
        return result
    }

    function hasCycle(startCell) {
        const visited = new Set()
        const recursionStack = new Set()
        const dfs = (node) => {
            if (recursionStack.has(node)) return true
            if (visited.has(node)) return false
            visited.add(node)
            recursionStack.add(node)
            for (const dep of getDependencies(node)) {
                if (dfs(dep)) return true
            }
            recursionStack.delete(node)
            return false
        }
        return dfs(startCell)
    }

    function topologicalSort(affectedCells) {
        const inDegree = new Map()
        const queue = []
        const sorted = []

        for (const cell of affectedCells) inDegree.set(cell, 0)
        for (const cell of affectedCells) {
            for (const dep of getDependencies(cell)) {
                if (affectedCells.has(dep)) {
                    inDegree.set(cell, (inDegree.get(cell) || 0) + 1)
                }
            }
        }
        for (const cell of affectedCells) {
            if (inDegree.get(cell) === 0) queue.push(cell)
        }
        let head = 0
        while (head < queue.length) {
            const cell = queue[head++]
            sorted.push(cell)
            for (const dependent of getDependents(cell)) {
                if (affectedCells.has(dependent)) {
                    inDegree.set(dependent, inDegree.get(dependent) - 1)
                    if (inDegree.get(dependent) === 0) queue.push(dependent)
                }
            }
        }
        return sorted
    }

    function clear() {
        forwardEdges.clear()
        reverseEdges.clear()
    }

    return {
        addDependency,
        removeAllDependencies,
        getDependencies,
        getDependents,
        getAllDependentsRecursive,
        hasCycle,
        topologicalSort,
        clear
    }
}

// ─────────────────────────────────────────────────────────────
//  Tokenizer + recursive-descent parser
//  Grammar:  expr   = term (('+'|'-') term)*
//            term   = unary (('*'|'/') unary)*
//            unary  = ('-'|'+') unary | primary
//            primary= number | cell [':' cell] | FUNC '(' range ')' | '(' expr ')'
//  Cell tokens are normalised: "$g$2" -> "G2" (the $ only matters for shifting).
// ─────────────────────────────────────────────────────────────

const CELL_TOKEN_RE = /\$?[A-Za-z]{1,3}\$?\d+(?![A-Za-z0-9_(])/y
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y

function tokenize(expression) {
    const tokens = []
    let pos = 0
    while (pos < expression.length) {
        const ch = expression[pos]
        if (ch === ' ') { pos++; continue }
        if ('()+-*/,:'.includes(ch)) {
            tokens.push({ type: 'punct', value: ch })
            pos++
            continue
        }
        if ((ch >= '0' && ch <= '9') || ch === '.') {
            let s = ''
            while (pos < expression.length && ((expression[pos] >= '0' && expression[pos] <= '9') || expression[pos] === '.')) {
                s += expression[pos++]
            }
            const n = parseFloat(s)
            if (isNaN(n)) throw new Error('Bad number')
            tokens.push({ type: 'number', value: n })
            continue
        }
        CELL_TOKEN_RE.lastIndex = pos
        const cm = CELL_TOKEN_RE.exec(expression)
        if (cm) {
            tokens.push({ type: 'cell', value: cm[0].replace(/\$/g, '').toUpperCase() })
            pos += cm[0].length
            continue
        }
        IDENT_RE.lastIndex = pos
        const im = IDENT_RE.exec(expression)
        if (im && expression[pos + im[0].length] === '(') {
            tokens.push({ type: 'function', value: im[0].toUpperCase() })
            pos += im[0].length
            continue
        }
        throw new Error(`Unexpected character: ${ch}`)
    }
    return tokens
}

function parseTokensToAST(tokens) {
    let pos = 0
    const peek = () => tokens[pos]
    const next = () => tokens[pos++]
    const isPunct = (t, v) => t && t.type === 'punct' && t.value === v

    function expr() {
        let left = term()
        while (isPunct(peek(), '+') || isPunct(peek(), '-')) {
            const operator = next().value
            left = { type: 'binary', operator, left, right: term() }
        }
        return left
    }

    function term() {
        let left = unary()
        while (isPunct(peek(), '*') || isPunct(peek(), '/')) {
            const operator = next().value
            left = { type: 'binary', operator, left, right: unary() }
        }
        return left
    }

    function unary() {
        if (isPunct(peek(), '-')) {
            next()
            return { type: 'binary', operator: '-', left: { type: 'number', value: 0 }, right: unary() }
        }
        if (isPunct(peek(), '+')) {
            next()
            return unary()
        }
        return primary()
    }

    function primary() {
        const t = next()
        if (!t) throw new Error('Unexpected end of formula')
        if (t.type === 'number') return { type: 'number', value: t.value }
        if (t.type === 'cell') {
            if (isPunct(peek(), ':')) {
                next()
                const end = next()
                if (!end || end.type !== 'cell') throw new Error('Invalid range')
                return { type: 'range', start: t.value, end: end.value }
            }
            return { type: 'cell', value: t.value }
        }
        if (t.type === 'function') {
            if (!isPunct(next(), '(')) throw new Error('Expected (')
            const arg = expr()
            if (arg.type !== 'range') throw new Error(`Function ${t.value} requires a range`)
            if (!isPunct(next(), ')')) throw new Error('Mismatched parentheses')
            return { type: 'function', name: t.value, range: arg }
        }
        if (isPunct(t, '(')) {
            const inner = expr()
            if (!isPunct(next(), ')')) throw new Error('Mismatched parentheses')
            return inner
        }
        throw new Error('Unexpected token')
    }

    const ast = expr()
    if (pos < tokens.length) throw new Error('Unexpected token')
    return ast
}

// ─────────────────────────────────────────────────────────────
//  Evaluator — walks the AST and computes values
// ─────────────────────────────────────────────────────────────

function expandCellRange(startKey, endKey) {
    const startMatch = startKey.match(/^([A-Z]+)(\d+)$/)
    const endMatch = endKey.match(/^([A-Z]+)(\d+)$/)
    if (!startMatch || !endMatch) throw new Error('REF')

    const startCol = columnLetterToIndex(startMatch[1])
    const startRow = parseInt(startMatch[2]) - 1
    const endCol = columnLetterToIndex(endMatch[1])
    const endRow = parseInt(endMatch[2]) - 1

    const cells = []
    for (let r = Math.min(startRow, endRow); r <= Math.max(startRow, endRow); r++) {
        for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
            cells.push(indexToCellKey(r, c))
        }
    }
    return cells
}

function evaluateAST(ast, getCellValue, visited = new Set()) {
    if (!ast) return 0

    if (ast.type === 'number') return ast.value

    if (ast.type === 'cell') {
        const key = ast.value
        if (visited.has(key)) throw new Error('CIRCULAR')
        visited.add(key)
        const value = getCellValue(key, visited)
        visited.delete(key)
        return value
    }

    if (ast.type === 'range') throw new Error('VALUE')

        if (ast.type === 'binary') {
            const leftVal = toNumberLoose(evaluateAST(ast.left, getCellValue, visited))
            const rightVal = toNumberLoose(evaluateAST(ast.right, getCellValue, visited))
            if (Number.isNaN(leftVal) || Number.isNaN(rightVal)) throw new Error('VALUE')
            switch (ast.operator) {
            case '+': return leftVal + rightVal
            case '-': return leftVal - rightVal
            case '*': return leftVal * rightVal
            case '/':
                if (rightVal === 0) throw new Error('VALUE')
                return leftVal / rightVal
            default: throw new Error('VALUE')
        }
    }

    if (ast.type === 'function') {
        const rangeCells = expandCellRange(ast.range.start, ast.range.end)
        const values = rangeCells.map(cellKey => {
            if (visited.has(cellKey)) throw new Error('CIRCULAR')
            visited.add(cellKey)
            const value = getCellValue(cellKey, visited)
            visited.delete(cellKey)
            const num = toNumberLoose(value)
            return Number.isNaN(num) ? 0 : num
        })

        switch (ast.name) {
            case 'SUM': return values.reduce((sum, val) => sum + val, 0)
            case 'AVG': return values.length === 0 ? 0 : values.reduce((sum, val) => sum + val, 0) / values.length
            case 'MIN': return values.length === 0 ? 0 : Math.min(...values)
            case 'MAX': return values.length === 0 ? 0 : Math.max(...values)
            default: throw new Error('VALUE')
        }
    }

    throw new Error('VALUE')
}

const AST_CACHE = new Map()
function parseCached(body) {
    let ast = AST_CACHE.get(body)
    if (!ast) {
        ast = parseTokensToAST(tokenize(body))
        if (AST_CACHE.size > 50000) AST_CACHE.clear()
        AST_CACHE.set(body, ast)
    }
    return ast
}

function evaluateFormula(expression, getCellValue) {
    try {
        if (!expression || expression.trim() === '') return { value: '', error: null }
        if (!expression.startsWith('=')) return { value: expression, error: null }

        if (expression.includes('#REF!')) return { value: null, error: '#REF!' }
        const formulaBody = expression.slice(1).trim()
        if (formulaBody === '') return { value: '', error: null }

//        const tokens = tokenize(formulaBody)
//        const ast = parseTokensToAST(tokens)
        const ast = parseCached(formulaBody)
        const result = evaluateAST(ast, getCellValue)
        return { value: result, error: null }
    } catch (error) {
        if (error.message === 'CIRCULAR') return { value: null, error: '#CYCLE!' }
        if (error.message === 'REF') return { value: null, error: '#REF!' }
        if (error.message === 'VALUE') return { value: null, error: '#VALUE!' }
        return { value: null, error: '#PARSE!' }
    }
}

// ─────────────────────────────────────────────────────────────
//  Reference rewriting
// ─────────────────────────────────────────────────────────────

// Matches A1, $A$1, $A1, A$1 but not function names like SUM( or LOG10(
const REF_RE = /(?<![A-Za-z0-9_$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g

function mapReferences(formula, fn) {
    if (!formula || !formula.startsWith('=')) return formula
    return formula.replace(REF_RE, (match, colDollar, colLetters, rowDollar, rowDigits) => {
        const ref = {
            col: columnLetterToIndex(colLetters.toUpperCase()),
            row: parseInt(rowDigits, 10) - 1,
            colAbs: colDollar === '$',
            rowAbs: rowDollar === '$',
        }
        const out = fn(ref)
        if (out === null) return match
        if (out === '#REF!') return '#REF!'
        return (ref.colAbs ? '$' : '') + indexToColumnLetter(out.col) + (ref.rowAbs ? '$' : '') + (out.row + 1)
    })
}

// Structural edits (insert/delete row/col): EVERY reference moves, $ or not,
// because the cell it points to physically moved.
export function shiftCellReferences(formula, rowShift, colShift, atIndex, isColumnOperation = false) {
    return mapReferences(formula, ({ row, col }) => {
        let newRow = row
        let newCol = col
        if (isColumnOperation) {
            if (col >= atIndex) newCol = col + colShift
        } else if (row >= atIndex) {
            newRow = row + rowShift
        }
        if (newRow < 0 || newCol < 0) return null
        return { row: newRow, col: newCol }
    })
}

// Fill / copy: only RELATIVE parts move; $ parts stay pinned.
export function shiftFormulaForFill(formula, deltaRow, deltaCol) {
    return mapReferences(formula, ({ row, col, rowAbs, colAbs }) => {
        const newRow = rowAbs ? row : row + deltaRow
        const newCol = colAbs ? col : col + deltaCol
        if (newRow < 0 || newCol < 0) return '#REF!'
        return { row: newRow, col: newCol }
    })
}

// Sort: rewrite SINGLE cell references via mapRow(row, col) -> newRow | undefined.
// Ranges (A1:B5) are left untouched, so a range spanning the sorted block keeps working.
const REF_OR_RANGE_RE = /(?<![A-Za-z0-9_$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])(\s*:\s*\$?[A-Za-z]{1,3}\$?\d+(?![A-Za-z0-9_(]))?/g

function remapRowReferences(formula, mapRow) {
    if (!formula || formula.charCodeAt(0) !== 61) return formula
    return formula.replace(REF_OR_RANGE_RE, (match, colDollar, letters, rowDollar, digits, rangeTail) => {
        if (rangeTail) return match
        const newRow = mapRow(parseInt(digits, 10) - 1, columnLetterToIndex(letters.toUpperCase()))
        return newRow === undefined ? match : colDollar + letters + rowDollar + (newRow + 1)
    })
}

// Every cell a formula reads, ranges expanded, $ stripped.
function extractCellReferences(formula) {
    const references = new Set()
    const collect = (node) => {
        if (!node) return
        if (node.type === 'cell') references.add(node.value)
        else if (node.type === 'range') {
            for (const key of expandCellRange(node.start, node.end)) references.add(key)
        } else if (node.type === 'binary') {
            collect(node.left)
            collect(node.right)
        } else if (node.type === 'function') collect(node.range)
    }
    try {
        collect(parseCached(formula.slice(1).trim()))
    } catch {
        // Unparseable formula: fall back to single refs so a later fix still tracks them
        for (const m of formula.matchAll(REF_RE)) references.add((m[2] + m[4]).toUpperCase())
    }
    return references
}

// ─────────────────────────────────────────────────────────────
//  Main engine factory
// ─────────────────────────────────────────────────────────────

export function createEngine(initialRows = 50, initialCols = 50) {
    let rows = initialRows
    let cols = initialCols
    const cells = new Map()
    const graph = createDependencyGraph()
    const dirtyCells = new Set()
    const computedCache = new Map()
    const undoStack = []
    const redoStack = []

    // Row identity (lazy): rowIds[i] = stable id of the row now at index i. null = identity.
    let rowIds = null
    let nextRowId = 0
    // Filters are a view: col -> spec, plus the set of row indexes they hide.
    let filters = new Map()
    let hidden = new Set()
    let colWidths = new Map()   // col -> px, only non-default (sparse)
    let rowHeights = new Map()  // row -> px, only non-default
    let _layoutVersion = 0      // UI rebuilds prefix sums only when this changes

    // Internal generation counter — incremented on every structural mutation.
    // Used by the cache to validate entries and by the engine to track state integrity.
    let _generation = 0
    let _batchMode = false
    let _batchCallbacks = []

    // ── Internal helpers ──

    function cellKey(row, col) {
        return indexToCellKey(row, col)
    }

    function cellCoords(key) {
        return parseCellKey(key)
    }

    function isValidCellKey(key) {
        const coords = cellCoords(key)
        return coords && coords.row >= 0 && coords.row < rows && coords.col >= 0 && coords.col < cols
    }

    function updateDependencies(cell, rawFormula) {
        // Extract all cell references from the formula
        // Note: This includes references in ranges (e.g., A1:A5 includes A1, A2, A3, A4, A5)
        // but the current implementation only tracks the range endpoints
        for (const ref of extractCellReferences(rawFormula)) {
            if (isValidCellKey(ref)) graph.addDependency(cell, ref)
        }
        // TODO: Consider tracking individual cells within ranges for more granular dependency tracking
    }

    function markCellDirty(cell) {
        dirtyCells.add(cell)
        for (const dependent of graph.getAllDependentsRecursive(cell)) {
            dirtyCells.add(dependent)
        }
    }

    function markAllCellsDirty() {
        for (const key of cells.keys()) dirtyCells.add(key)
    }

    // ── Value resolution ──

    function resolveCellValue(cellKey, visited = new Set()) {
        if (visited.has(cellKey)) return '#CYCLE!'
        visited.add(cellKey)

        if (computedCache.has(cellKey)) {
            const cached = computedCache.get(cellKey)
            // Validate cache generation — stale entries from a previous generation are discarded
            // Note: _generation is incremented on structural changes, but cache validation
            // must account for cells that may have been invalidated by dependency changes
            if (cached._gen === _generation && !dirtyCells.has(cellKey)) {
                visited.delete(cellKey)
                return cached.error || cached.computed
            }
            computedCache.delete(cellKey)
        }

        const cell = cells.get(cellKey)
        if (!cell || !cell.raw) {
            visited.delete(cellKey)
            return ''
        }

        if (!cell.raw.startsWith('=')) {
            visited.delete(cellKey)
            return STRICT_NUM_RE.test(cell.raw.trim()) ? parseFloat(cell.raw) : cell.raw
        }

        const result = evaluateFormula(cell.raw, (key) => resolveCellValue(key, visited))
        visited.delete(cellKey)

        if (result.error) {
            computedCache.set(cellKey, { computed: null, error: result.error, _gen: _generation })
            return result.error
        }

        computedCache.set(cellKey, { computed: result.value, error: null, _gen: _generation })
        return result.value
    }

    // ── Recalculation ──

    function recalculate() {
        if (dirtyCells.size === 0) return

        const affected = new Set(dirtyCells)
        const sorted = graph.topologicalSort(affected)

        // Process sorted cells first (topological order ensures dependencies are resolved)
        for (const cell of sorted) {
            if (dirtyCells.has(cell)) {
                computedCache.delete(cell)
                resolveCellValue(cell)
            }
        }
        // Process any remaining affected cells that weren't in the sorted list
        // (e.g., cells with no dependencies or circular dependencies)
        const sortedSet = new Set(sorted)
        for (const cell of affected) {
            if (!sortedSet.has(cell)) {
                computedCache.delete(cell)
                resolveCellValue(cell)
            }
        }

        dirtyCells.clear()

        // Notify batch listeners if in batch mode
        // WARNING: Batch mode is currently unused but may be needed for future features
        if (_batchMode) {
            _batchCallbacks.forEach(cb => cb())
        }
    }

        // ── Core cell operations ──

        function setCellRaw(row, col, raw) {
            const key = cellKey(row, col)
            const prev = cells.get(key)
            const style = prev ? prev.style : undefined
            graph.removeAllDependencies(key)
            computedCache.delete(key)

            if (!raw || raw.trim() === '') {
                // A styled blank cell must survive; an unstyled blank cell is just removed
                if (style) cells.set(key, { raw: '', computed: null, error: null, style })
                else cells.delete(key)
                markCellDirty(key)
                return
            }

            if (raw.startsWith('=')) {
                cells.set(key, { raw, computed: null, error: null, style })
                updateDependencies(key, raw)
                if (graph.hasCycle(key)) {
                    graph.removeAllDependencies(key)
                    cells.set(key, { raw, computed: null, error: '#CYCLE!', style })
                    markCellDirty(key)
                    return
                }
            } else {
                cells.set(key, { raw, computed: null, error: null, style })
            }

            markCellDirty(key)
        }

        // Style-only write. Styles are treated as immutable objects (never mutate in place).
        function setStyleRaw(row, col, style) {
            const key = cellKey(row, col)
            const prev = cells.get(key)
            const empty = !style || Object.keys(style).length === 0
            if (!prev) {
                if (!empty) cells.set(key, { raw: '', computed: null, error: null, style })
                return
            }
            if (empty && !prev.raw) {
                cells.delete(key)
                return
            }
            cells.set(key, { ...prev, style: empty ? undefined : style })
        }

    function getCellRaw(row, col) {
        const key = cellKey(row, col)
        const cell = cells.get(key)
        if (!cell) return { raw: '', computed: null, error: null }
        return { ...cell }
    }

    // ── Snapshot / Restore (for undo of structural changes) ──

    function takeSnapshot() {
        // Create a deep copy of all cell data for undo/redo operations
        // Note: This only captures cell data, not the dependency graph or cache
        // The dependency graph is rebuilt from the cell formulas when restoring
        const snapshot = new Map()
        for (const [key, value] of cells.entries()) {
            // Create a shallow copy of the cell object
            // The cell object contains: { raw: string, computed: number|null, error: string|null }
            // Note: computed and error are not persisted in snapshots - they're recalculated on restore
            snapshot.set(key, { ...value })
        }
        snapshot.aux = captureAux()
        return snapshot
    }

    function restoreSnapshot(snapshot) {
        if (snapshot.aux) restoreAux(snapshot.aux)
        cells.clear()
        for (const [key, value] of snapshot.entries()) {
            cells.set(key, { ...value })
        }
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++
        // Rebuild dependency graph from restored cells
        // Important: This must happen before marking cells dirty to ensure correct dependency tracking
        for (const [key, value] of cells.entries()) {
            if (value.raw && value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    // ── Row / Column structural operations ──

    function performInsertRow(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.row >= atIndex) {
                const newKey = cellKey(coords.row + 1, coords.col)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 1, 0, atIndex) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 1, 0, atIndex) })
            }
        }
        rows++
        rowHeights = shiftSizeKeys(rowHeights, atIndex, false)
        _layoutVersion++
         if (rowIds) rowIds.splice(atIndex, 0, nextRowId++)
                hidden = new Set([...hidden].map((r) => (r >= atIndex ? r + 1 : r)))
        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performDeleteRow(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.row === atIndex) continue
            if (coords.row > atIndex) {
                const newKey = cellKey(coords.row - 1, coords.col)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, -1, 0, atIndex) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, -1, 0, atIndex) })
            }
        }
        rows--
        rowHeights = shiftSizeKeys(rowHeights, atIndex, true)
        _layoutVersion++
        if (rowIds) rowIds.splice(atIndex, 1)
                hidden = new Set([...hidden].filter((r) => r !== atIndex).map((r) => (r > atIndex ? r - 1 : r)))

        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performInsertColumn(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.col >= atIndex) {
                const newKey = cellKey(coords.row, coords.col + 1)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 0, 1, atIndex, true) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 0, 1, atIndex, true) })
            }
        }
        cols++
        colWidths = shiftSizeKeys(colWidths, atIndex, false)
        _layoutVersion++
          filters = new Map([...filters].map(([c, s]) => [c >= atIndex ? c + 1 : c, s]))
        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performDeleteColumn(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.col === atIndex) continue
            if (coords.col > atIndex) {
                const newKey = cellKey(coords.row, coords.col - 1)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 0, -1, atIndex, true) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 0, -1, atIndex, true) })
            }
        }
        cols--
        colWidths = shiftSizeKeys(colWidths, atIndex, false)
        _layoutVersion++
        filters = new Map([...filters].filter(([c]) => c !== atIndex).map(([c, s]) => [c > atIndex ? c - 1 : c, s]))
        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    // ── Undo / Redo ──

    function pushToUndoStack(entry) {
        undoStack.push({ ...entry, _gen: _generation })
        if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift()
        redoStack.length = 0
    }

    function executeSetCell(row, col, value) {
        const previousValue = getCellRaw(row, col).raw
        // Only create undo entry if value actually changed
        // This prevents undo stack pollution with no-op edits
        if (previousValue !== value) {
            pushToUndoStack({ type: 'set', r: row, c: col, oldVal: previousValue, newVal: value })
        }
        setCellRaw(row, col, value)
//        _generation++
        recalculate()
    }

        // One undo step for any number of cell/style writes. One recalculation at the end.
        // changes: [{ row, col, raw?, style? }]  (raw/style undefined = keep, style null = clear)
        function executeBatch(changes) {
            const records = []
            for (const ch of changes) {
                const prev = getCellRaw(ch.row, ch.col)
                const newRaw = ch.raw === undefined ? prev.raw : ch.raw
                const newStyle = ch.style === undefined ? prev.style : (ch.style === null ? undefined : ch.style)
                const sameStyle = JSON.stringify(newStyle ?? null) === JSON.stringify(prev.style ?? null)
                if (newRaw === prev.raw && sameStyle) continue
                records.push({ row: ch.row, col: ch.col, oldRaw: prev.raw, newRaw, oldStyle: prev.style, newStyle })
                if (newRaw !== prev.raw) setCellRaw(ch.row, ch.col, newRaw)
                if (!sameStyle) setStyleRaw(ch.row, ch.col, newStyle)
            }
            if (records.length === 0) return false // no-op: no undo entry
            pushToUndoStack({ type: 'batch', records })
//            _generation++
            recalculate()
            return true
        }

        // Clear values (not styles) in a rectangle: one undo step.
        function executeClear(range) {
            const changes = []
            for (const [key, cell] of cells.entries()) {
                if (!cell.raw) continue
                const p = cellCoords(key)
                if (p.row >= range.r1 && p.row <= range.r2 && p.col >= range.c1 && p.col <= range.c2) {
                    changes.push({ row: p.row, col: p.col, raw: '' })
                }
            }
            return executeBatch(changes)
        }

        // Bounding box of non-empty cells, or null. Used for Ctrl+A.
        function getUsedRange() {
            let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1
            for (const [key, cell] of cells.entries()) {
                if (!cell.raw) continue
                const p = cellCoords(key)
                if (p.row < r1) r1 = p.row
                if (p.row > r2) r2 = p.row
                if (p.col < c1) c1 = p.col
                if (p.col > c2) c2 = p.col
            }
            return r2 < 0 ? null : { r1, c1, r2, c2 }
        }

    // ── Sort / filter support ──

    function captureAux() {
        return {
            rowIds: rowIds ? rowIds.slice() : null, nextRowId,
            filters: new Map(filters), hidden: new Set(hidden),
            colWidths: new Map(colWidths), rowHeights: new Map(rowHeights),
        }
    }
    function restoreAux(aux) {
        rowIds = aux.rowIds ? aux.rowIds.slice() : null
        nextRowId = aux.nextRowId
        filters = new Map(aux.filters)
        hidden = new Set(aux.hidden)
        colWidths = new Map(aux.colWidths ?? [])
        rowHeights = new Map(aux.rowHeights ?? [])
        _layoutVersion++
    }

    function ensureRowIds() {
        if (!rowIds) {
            rowIds = Array.from({ length: rows }, (_, i) => i)
            nextRowId = rows
        }
        return rowIds
    }

    function displayOf(r, c) {
        const v = resolveCellValue(cellKey(r, c))
        if (v === null || v === undefined) return ''
        return typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : String(v)
    }

    // Keep in sync with the "totals row" rule in AI_CONTRACT.md
    function looksLikeTotalsRow(r, c1, c2) {
        let first = true
        for (let c = c1; c <= c2; c++) {
            const raw = cells.get(cellKey(r, c))?.raw
            if (!raw) continue
            if (first) {
                first = false
                if (/^\s*(grand\s+)?totals?\b/i.test(raw)) return true
            }
            if (/^=\s*SUM\(/i.test(raw)) return true
        }
        return false
    }

    // Used range with row 1 as header and a trailing totals row excluded.
    function getDataBlock() {
        const used = getUsedRange()
        if (!used) return null
        const totalsRow = looksLikeTotalsRow(used.r2, used.c1, used.c2) ? used.r2 : null
        const r1 = used.r1 + 1
        const r2 = totalsRow !== null ? used.r2 - 1 : used.r2
        if (r2 < r1) return null
        return { headerRow: used.r1, totalsRow, r1, r2, c1: used.c1, c2: used.c2 }
    }

    function recomputeHidden() {
        hidden = new Set()
        _layoutVersion++
        if (filters.size === 0) return
        const block = getDataBlock()
        if (!block) return
        const tests = [...filters].map(([c, spec]) => [c, compileFilter(spec)])
        for (let r = block.r1; r <= block.r2; r++) {
            for (const [c, test] of tests) {
                if (!test(displayOf(r, c))) { hidden.add(r); break }
            }
        }
    }

    function executeSetFilter(col, spec) {
        if (JSON.stringify(filters.get(col) ?? null) === JSON.stringify(spec ?? null)) return false
        pushToUndoStack({ type: 'filter', snap: takeSnapshot(), oldRows: rows })
        if (spec) filters.set(col, spec)
        else filters.delete(col)
        recomputeHidden()
        return true
    }

    function executeClearFilters() {
        if (filters.size === 0) return false
        pushToUndoStack({ type: 'filter', snap: takeSnapshot(), oldRows: rows })
        filters = new Map()
        hidden = new Set()
        _layoutVersion++
        return true
    }

    function getFilterSummary() {
        if (filters.size === 0) return { active: false, visible: 0, total: 0 }
        const block = getDataBlock()
        const total = block ? block.r2 - block.r1 + 1 : 0
        let h = 0
        if (block) for (const r of hidden) if (r >= block.r1 && r <= block.r2) h++
        return { active: true, visible: total - h, total }
    }

    function getDistinctValues(col) {
        const block = getDataBlock()
        if (!block) return []
        const displays = []
        for (let r = block.r1; r <= block.r2; r++) displays.push(displayOf(r, col))
        return distinctValues(displays)
    }

    /**
     * Sort a block by one column. ONE undo step.
     * opts: { col, dir: 'asc'|'desc'|'original', range?: {r1,c1,r2,c2} }
     *  range given  -> sort exactly that rectangle (no header, no totals pin)
     *  range absent -> used range, row 1 header, trailing totals row pinned
     * With a filter active only visible rows are reordered.
     * Formulas anywhere in the sheet that point at a moved row follow it; ranges are untouched.
     */
     function executeSort({ col, dir = 'asc', range } = {}) {
            if (!['asc', 'desc', 'original'].includes(dir)) return { ok: false, code: 'BAD_ARGS', changed: false }
            const block = range ? { r1: range.r1, r2: range.r2, c1: range.c1, c2: range.c2 } : getDataBlock()
            if (!block) return { ok: false, code: 'NO_DATA', changed: false }
            if (col < block.c1 || col > block.c2) return { ok: false, code: 'OUT_OF_RANGE', changed: false }

            const T = [performance.now()]
            const mark = () => T.push(performance.now())

            const rowsToSort = []
            for (let r = block.r1; r <= block.r2; r++) if (!hidden.has(r)) rowsToSort.push(r)
            const ids = ensureRowIds()
            const moves = planSort(rowsToSort, dir, (r) => classify(resolveCellValue(cellKey(r, col))), (r) => ids[r])
            if (moves.size === 0) return { ok: true, changed: false }
            mark() // 1: plan (comparison)

            pushToUndoStack({ type: 'sort', snap: takeSnapshot(), oldRows: rows })
            mark() // 2: snapshot

            const inBlockCol = (c) => c >= block.c1 && c <= block.c2
            const mapRow = (row, c) => (inBlockCol(c) ? moves.get(row) : undefined)
            const next = new Map()
            for (const [key, cell] of cells.entries()) {
                const p = cellCoords(key)
                const raw = cell.raw && cell.raw.charCodeAt(0) === 61 ? remapRowReferences(cell.raw, mapRow) : cell.raw
                const dest = inBlockCol(p.col) ? moves.get(p.row) : undefined
                next.set(dest === undefined ? key : cellKey(dest, p.col), raw === cell.raw ? cell : { ...cell, raw })
            }
            cells.clear()
            for (const [k, v] of next) cells.set(k, v)
            mark() // 3: move cells + remap formulas

            const newIds = ids.slice()
            for (const [from, to] of moves) newIds[to] = ids[from]
            rowIds = newIds

            graph.clear()
            computedCache.clear()
            dirtyCells.clear()
            _generation++
            for (const [k, v] of cells.entries()) {
                if (v.raw && v.raw.charCodeAt(0) === 61) updateDependencies(k, v.raw)
            }
            mark() // 4: rebuild graph

            markAllCellsDirty()
            recalculate()
            mark() // 5: recalculate

            console.log('sort breakdown ms (plan|snapshot|move|graph|recalc)', T.slice(1).map((t, i) => (t - T[i]).toFixed(0)).join(' | '))
            return { ok: true, changed: true, moved: moves.size }
        }

    function executeInsertRow(atIndex) {
        const snapshot = takeSnapshot()
        const previousRows = rows
        pushToUndoStack({ type: 'rowins', snap: snapshot, oldRows: previousRows })
        performInsertRow(atIndex)
        recalculate()
    }

    function executeDeleteRow(atIndex) {
        const snapshot = takeSnapshot()
        const previousRows = rows
        pushToUndoStack({ type: 'rowdel', snap: snapshot, oldRows: previousRows })
        performDeleteRow(atIndex)
        recalculate()
    }

    function executeInsertColumn(atIndex) {
        const snapshot = takeSnapshot()
        const previousCols = cols
        pushToUndoStack({ type: 'colins', snap: snapshot, oldCols: previousCols })
        performInsertColumn(atIndex)
        recalculate()
    }

    function executeDeleteColumn(atIndex) {
        const snapshot = takeSnapshot()
        const previousCols = cols
        pushToUndoStack({ type: 'coldel', snap: snapshot, oldCols: previousCols })
        performDeleteColumn(atIndex)
        recalculate()
        recomputeHidden()
    }

// Re-key a sparse size map after inserting/deleting an index.
function shiftSizeKeys(map, atIndex, isDelete) {
    const next = new Map()
    for (const [k, v] of map) {
        if (isDelete) {
            if (k === atIndex) continue
            next.set(k > atIndex ? k - 1 : k, v)
        } else {
            next.set(k >= atIndex ? k + 1 : k, v)
        }
    }
    return next
}

function applySize(kind, index, value) {
    const map = kind === 'col' ? colWidths : rowHeights
    const def = kind === 'col' ? DEFAULT_COL_W : DEFAULT_ROW_H
    if (value === def) map.delete(index)
    else map.set(index, value)
    _layoutVersion++
}

// ONE undo step, no cell snapshot (cheap).
function executeSetSize(kind, index, value) {
    const map = kind === 'col' ? colWidths : rowHeights
    const def = kind === 'col' ? DEFAULT_COL_W : DEFAULT_ROW_H
    const oldVal = map.get(index) ?? def
    const newVal = Math.max(MIN_SIZE, Math.round(value))
    if (newVal === oldVal) return false
    pushToUndoStack({ type: 'size', kind, index, oldVal, newVal })
    applySize(kind, index, newVal)
    return true
}

    function undo() {
        if (undoStack.length === 0) return false
        const entry = undoStack.pop()
        if (entry.type === 'size') {
            applySize(entry.kind, entry.index, entry.oldVal)
            redoStack.push(entry)
            return true
        }
        if (entry.type === 'batch') {
            for (let i = entry.records.length - 1; i >= 0; i--) {
                const rec = entry.records[i]
                setCellRaw(rec.row, rec.col, rec.oldRaw)
                setStyleRaw(rec.row, rec.col, rec.oldStyle)
            }
            redoStack.push(entry)
//            _generation++
            recalculate()
            return true
        }
        if (entry.type === 'set') {
            // For cell edits, swap current value to redo stack and restore old value
            const currentValue = getCellRaw(entry.r, entry.c).raw
            redoStack.push({ ...entry, newVal: currentValue })
            setCellRaw(entry.r, entry.c, entry.oldVal)
//            _generation++
            recalculate()
        } else {
            // For structural changes (row/col insert/delete), save current state to redo
            // and restore the snapshot from undo entry
            // Note: The snapshot contains the cell data, but rows/cols must be restored separately
            redoStack.push({
                ...entry,
                restoreSnap: takeSnapshot(),
                restoreRows: rows,
                restoreCols: cols
            })
            restoreSnapshot(entry.snap)
            // Restore grid dimensions - this must happen after restoreSnapshot
            // because restoreSnapshot increments _generation but doesn't modify rows/cols
            if (entry.type === 'rowins' || entry.type === 'rowdel') rows = entry.oldRows
            else if (entry.type === 'colins' || entry.type === 'coldel') cols = entry.oldCols
            recalculate()
        }
        return true
    }

    function redo() {
        if (redoStack.length === 0) return false
        const entry = redoStack.pop()
        if (entry.type === 'size') {
            applySize(entry.kind, entry.index, entry.newVal)
            undoStack.push(entry)
            return true
        }
        if (entry.type === 'batch') {
            for (const rec of entry.records) {
                setCellRaw(rec.row, rec.col, rec.newRaw)
                setStyleRaw(rec.row, rec.col, rec.newStyle)
            }
            undoStack.push(entry)
//            _generation++
            recalculate()
            return true
        }

        if (entry.type === 'set') {
            const currentValue = getCellRaw(entry.r, entry.c).raw
            undoStack.push({ ...entry, oldVal: currentValue })
            setCellRaw(entry.r, entry.c, entry.newVal)
//            _generation++
            recalculate()
        } else {
            undoStack.push({
                ...entry,
                snap: takeSnapshot(),
                oldRows: rows,
                oldCols: cols
            })
            restoreSnapshot(entry.restoreSnap)
            rows = entry.restoreRows
            cols = entry.restoreCols
            recalculate()
        }
        return true
    }

    // ── Public cell display (returns raw + computed + error) ──

    function getCellForDisplay(row, col) {
        const cell = getCellRaw(row, col)
        const key = cellKey(row, col)
        // Resolve the computed value (this may trigger recalculation if the cell is dirty)
        // The resolveCellValue function handles caching and dependency resolution
        const value = resolveCellValue(key)

        // Error values are strings starting with '#' (e.g., '#CYCLE!', '#VALUE!')
        if (typeof value === 'string' && value.startsWith('#')) {
            return { raw: cell.raw, computed: null, error: value, style: cell.style }
        }
        // Return the computed value (which may be a number or string)
        // Note: Empty cells return '' as computed value, not null
        return { raw: cell.raw, computed: value, error: null, style: cell.style }
    }

    // ── Public API ──
    // The engine exposes a limited API to prevent direct access to internal state
    // All cell operations go through the public methods which handle undo/redo,
    // dependency tracking, and cache invalidation automatically

    return {
        get rows() { return rows },
        get cols() { return cols },
        getCell: getCellForDisplay,
        setCell: executeSetCell,
        insertRow: executeInsertRow,
        deleteRow: executeDeleteRow,
        insertColumn: executeInsertColumn,
        deleteColumn: executeDeleteColumn,
        undo,
        redo,
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        // Grow the grid so that at least minRows x minCols exist. The engine is
        // sparse, so this only moves the bounds; nothing is allocated.
        getRaw: (row, col) => cells.get(cellKey(row, col))?.raw ?? '',
        getStyle: (row, col) => cells.get(cellKey(row, col))?.style,
        applyChanges: executeBatch,
        clearContents: executeClear,
        getUsedRange,
        ensureCapacity: (minRows, minCols) => {
            if (minRows > rows) rows = minRows
            if (minCols > cols) cols = minCols
            if (rowIds) while (rowIds.length < rows) rowIds.push(nextRowId++)
        },
        undoDepth: () => undoStack.length,
        getDataBlock,
        sortRows: executeSort,
        setFilter: executeSetFilter,
        clearFilters: executeClearFilters,
        getFilter: (col) => filters.get(col) ?? null,
        hasFilters: () => filters.size > 0,
        isRowHidden: (r) => hidden.has(r),
        getFilterSummary,
        getDistinctValues,
        getRowId: (r) => (rowIds ? rowIds[r] : r),
        getColWidth: (c) => colWidths.get(c) ?? DEFAULT_COL_W,
        getRowHeight: (r) => (hidden.has(r) ? 0 : (rowHeights.get(r) ?? DEFAULT_ROW_H)),
        setColWidth: (c, w) => executeSetSize('col', c, w),
        setRowHeight: (r, h) => executeSetSize('row', r, h),
        layoutVersion: () => _layoutVersion,
        // Internal state is not exposed - if you need to serialize/deserialize,
        // you'll need to work with the public API or add new methods
    }
}
