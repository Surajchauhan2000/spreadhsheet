# Design notes

Browser spreadsheet with range selection and fill, sort and filter, a virtualized 100,000 x 200 grid, and two AI features (ask your data, format with AI).

**Principle:** the engine is plain JavaScript with no React and no DOM. React only displays engine state and calls engine methods. The model translates, the engine computes: no number a user sees comes from model output.

Numbers marked `[FILL]` must be measured on `npm run build && npm run preview` before submitting.

---

## 1. Code layout

| Path | Role | React/DOM? |
|---|---|---|
| `src/engine/core.js` | Cells, formulas, dependency graph, undo, sort, filter, sizes, freeze | No |
| `src/engine/fill.js`, `fillRange.js` | Series detection and fill planning | No |
| `src/engine/selection.js` | Selection rectangles, fill target, `parseRef` (name box) | No |
| `src/engine/layout.js` | Prefix-sum axis with binary search | No |
| `src/engine/values.js`, `sortPlan.js` | Classification, comparison, filter predicates, stable sort plan | No |
| `src/engine/numberFormat.js` | Display-only number formats | No |
| `src/ai/*` | Validator, context, query executor, format applier, pipeline, providers | No (providers use `fetch` only) |
| `src/VirtualGrid.jsx`, `App.jsx`, `AiPanel.jsx`, `FilterMenu.jsx` | UI | Yes |
| `src/measureText.js` | Canvas text measuring (DOM, so kept outside engine/ai) | DOM |

## 2. Data model

- **Cells:** sparse `Map` keyed by A1 string (`"K2"`). Value: `{ raw, computed, error, style }`. `raw` is exactly what the user typed (formulas start with `=`). `style` is an immutable object; it is never mutated in place. Nothing is allocated for empty cells, so 100,000 x 200 costs nothing until used.
- **Computed values:** `computedCache` (key to value) plus a `dirtyCells` set. Editing a cell marks it and its transitive dependents dirty; only those are recomputed.
- **Dependency graph:** forward and reverse edge maps. Ranges (`J2:J32`) are expanded to individual cells. Cycle detection by DFS gives `#CYCLE!`.
- **Formulas:** tokenizer and recursive-descent parser (`+ - * /`, unary minus, parentheses, `SUM AVG MIN MAX` over ranges). Parsed ASTs are cached by formula text. References accept `A1`, `$A$1`, `$A1`, `A$1`.
- **Row identity:** `rowIds[i]` is the stable id of the row now at index `i` (lazy, created on first sort). Sorting permutes it; "original order" sorts by id.
- **Filters:** `filters: Map<col, spec>` and `hidden: Set<row>`. A filter is a view: hidden rows keep their data and still count in formulas.
- **Sizes:** `colWidths` and `rowHeights` are sparse maps holding only non-default values. Hidden rows have height 0 in the layout.
- **Freeze:** `frozenRows`, `frozenCols` live in the engine (so they are undoable).
- **Layout axis:** `createAxis(count, sizeOf)` builds a `Float64Array` of prefix sums; `indexAt(px)` is a binary search, `visibleRange` adds overscan.

### Reference rewriting (three different rules)

| Operation | Function | Rule |
|---|---|---|
| Insert/delete row or column | `shiftCellReferences` | Every reference moves, `$` or not, because the target physically moved |
| Fill / copy | `shiftFormulaForFill` | Only relative parts move; `$` parts stay pinned |
| Sort | `remapRowReferences` | Single references follow their row; ranges are left untouched so `SUM(J2:J32)` spanning the block still works |

## 3. Engine API added (public methods of `createEngine`)

| Method | Meaning |
|---|---|
| `setCell(r, c, raw)` | Edit one cell. One undo entry if the value changed |
| `applyChanges(changes, extras?)` | Bulk write. `changes: [{row, col, raw?, style?}]` (`style: null` clears). `extras: {widths: [{col, width}], freezeRows, freezeCols}`. **One undo entry** for everything; returns `false` and creates no entry if nothing changed |
| `clearContents(range)` | Clear values (not styles) in a rectangle, one undo step |
| `getRaw`, `getCell`, `getStyle` | Read raw text, computed value + error + style, style |
| `getUsedRange()` | Bounding box of non-empty cells |
| `getDataBlock()` | Used range minus header row and a trailing totals row |
| `sortRows({col, dir, range?})` | `dir`: `asc`, `desc`, `original`. Returns `{ok, changed}` or `{ok:false, code}` (`NO_DATA`, `OUT_OF_RANGE`, `BAD_ARGS`). With a filter active only visible rows move |
| `setFilter(col, spec)`, `clearFilters()`, `getFilter`, `hasFilters`, `isRowHidden`, `getFilterSummary`, `getDistinctValues` | Filters as a view. Spec: `{include: string[]|null, cond: {op, value}|null}` |
| `getRowId(r)` | Stable row id |
| `getColWidth`, `getRowHeight`, `setColWidth`, `setRowHeight`, `layoutVersion()` | Sizes; `layoutVersion` changes whenever sizes or hidden rows change so the UI rebuilds prefix sums only then |
| `getFrozenRows`, `getFrozenCols` | Freeze state (changed through `applyChanges` extras) |
| `insertRow/deleteRow/insertColumn/deleteColumn(i)` | Structural edits; formulas, sizes, filters and hidden rows shift |
| `undo`, `redo`, `canUndo`, `canRedo`, `undoDepth` | History (max 100 entries) |
| `ensureCapacity(rows, cols)`, `rows`, `cols` | Grid bounds (sparse; only moves the bounds) |

Pure modules: `planFill`/`fillLine` (fill), `fillRange(engine, source, target)`, `planSort`, `createAxis`, `formatValue`/`cellDisplay`, `parseAction`/`validate`, `executeQuery`, `planFormat`.

## 4. Undo semantics: what one Ctrl+Z reverts

| Action | One undo reverts |
|---|---|
| Edit a cell (Enter/Tab commit) | That cell's text (one entry per committed edit, not per keystroke) |
| Delete / Backspace on a selection | All cleared cells |
| Fill handle drag, Ctrl+D | The whole fill (values and inherited styles), including shrink-clears |
| Apply bold/colour/etc. to a selection | All styled cells |
| Sort (header click) | The whole reorder, including formula rewrites, row ids and styles |
| Filter change / Clear filters | That filter change (restores filters and hidden rows) |
| Column resize / row resize / auto-fit (double-click) | That one resize |
| Insert/delete row or column | The structural change, formulas, sizes, filters |
| Freeze toggle (toolbar) | The freeze change |
| AI "Insert into sheet" | The whole inserted result table |
| AI "Apply" (format_sheet) | All cell styles **and** column widths **and** freeze in one step |
| AI NO_CHANGES / OUT_OF_RANGE / Discard | Nothing: no undo entry is created |

Implementation: bulk edits are `batch` entries holding per-cell `{old, new}` records plus size and freeze records (cheap, no full snapshot). Sort, filter and structural edits store a snapshot of cells plus an "aux" copy (row ids, filters, hidden, sizes, freeze). Snapshots share cell objects instead of cloning them, which is safe because cell objects are never mutated.

## 5. Feature notes

### Challenge 1: selection and fill
- One selection object `{anchor, focus}` for the whole grid; no per-cell state. Mouse handling is event delegation on the grid (`data-kind`, `data-r`, `data-c`).
- Series detection order: numeric (incl. `1, 2` step), date (three formats, step in days, each filled cell keeps the format of its paired seed), weekday/month names (cycle, case preserved), text with trailing number (zero padding preserved), otherwise copy. Formulas copy with relative shift.
- Fill and styles go through one `applyChanges` call, then one recalculation.

### Challenge 2: sort and filter
- Comparator: numbers, then dates, then text (case-insensitive), blanks last in both directions, stable (ties keep id order).
- Filter checklist groups on the normalised key (trim + lower-case), so `West`, `west` and ` West ` are one entry and one filter matches all three. Conditions: contains, greater than, less than, is empty. Several columns combine with AND.
- Sort with an active filter reorders only visible rows; hidden rows do not move.

### Challenge 3: virtual grid
- Rows and columns are absolutely positioned `div`s; only visible range plus overscan exist in the DOM. Scroll position is the only per-scroll React state, throttled with `requestAnimationFrame`.
- Frozen row and column use `position: sticky` bands.
- Resize shows a live preview in local state and calls the engine once on mouseup (one undo step per drag).
- Navigation: name box (`AZ5000`, `K2:K100000`), Ctrl+Home/End, PageUp/PageDown, formula bar.
- **How to fill 100,000 rows:** load Sample 3k, type `=J2*2` in K2, type `K2:K100000` in the name box, press Ctrl+D.

### Challenge 4: ask your data
- Flow: prompt, provider, `extractJson` (skips prose and code fences, respects braces inside strings), `parseAction` (hand-written schema validator), executor, result card.
- Unknown action types (e.g. `mutation`) are rejected with `READ_ONLY` before reaching the executor. Unknown columns return `UNKNOWN_COLUMN` and the UI asks the user; it never guesses. The 500-row cap is enforced in the executor.
- **Context sent to the model** (inside the system prompt; `user` holds only the prompt):
  `{ range, rowCount, columns: [{name, index, type, examples (<=3)}], sampleRows (<=5), selection, hasTotalsRow }`. Never the full data.
- Re-run executes the stored plan again with no model call. Insert into sheet writes header and rows at a chosen cell, one undo step.
- Providers: deterministic `mock` (default) and `http` (OpenAI-compatible chat completions via `fetch`, 20 s timeout, network/auth/rate-limit errors shown). Config from `.env.local`; nothing else knows the vendor.

### Challenge 5: format with AI
- Pure planner `planFormat` follows AI_CONTRACT section 4: header = row 1; totals row only if the last row looks like one (else `totalsStyle` is dropped); order `clearFormatting`, `bodyStyle`, `columns[]`, `totalsStyle`, `headerStyle` last; out-of-range columns ignored; widths outside 30..600 ignored; `freezeRows >= used rows` gives `OUT_OF_RANGE` and nothing else is applied; auto-fit measures text after number formats.
- `numberFormat` is display-only: the stored raw value never changes; non-numeric text such as `n/a` is left alone.
- Preview card shows a plain-words description; Apply re-plans against the current sheet and writes with one `applyChanges` call; Discard changes nothing.

## 6. Measurements

Method: Vitest in Node on a Windows laptop for engine numbers (`npm test`, benchmarks in `*.test.js`); browser numbers from the production build (`npm run build && npm run preview`) with Chrome DevTools Performance.

| Budget | Result | Method |
|---|---|---|
| Fill 5,000 cells < 200 ms | 31 to 59 ms | `batch.test.js`, fill 5,000 cells |
| Sort 10,000 rows < 300 ms | best of 5: 115 to 142 ms; first (cold) run up to 433 ms when the whole suite runs in parallel | `sort.test.js`, 10,000 rows with a formula per row |
| Sort `sales-large.tsv` (3k) by Date | `[FILL] ms` | Production build, Sample 3k, Date header, status line |
| Fill 100,000 formula cells | about 1.1 to 1.3 s, one undo step | `fill100k.test.js` (Node). UI: `[FILL] ms` from the status line |
| First paint < 100 ms | `[FILL] ms` | Performance tab, reload, production build |
| Keystroke latency < 16 ms (50,000 filled cells) | `[FILL] ms` | Performance tab, type in J95000 |
| Scroll 60 fps | `[FILL]` | Performance tab / FPS meter while dragging the scrollbar |
| Commit count when typing at row 95,000 | `[FILL]` | React DevTools Profiler |
| Any golden query on sales-large < 50 ms | all 17 pass (asserted, best of 3) | `queries.golden.test.js` |
| Two-level group-by, 100,000 rows < 500 ms | 148 to 174 ms | `queries.golden.test.js` |
| Format apply on sales-large (totals row 2,992) < 300 ms | 225 ms best of 3 isolated; 358 ms once when the full suite ran in parallel | `format.golden.test.js`. Breakdown: plan about 224 ms (auto-fit measuring), write about 8 ms |

Note on noise: the same benchmark varies 2 to 3x depending on CPU load. The sort and format tests therefore take the best of several runs, and the thresholds were not raised.
