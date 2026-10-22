import { useState, useRef, useEffect } from 'react'
import './App.css'
import { createEngine } from './engine/core.js'
import { fillRange } from './engine/fillRange.js'
import { normRange, inRange, sameRect, rangeLabel, columnLabel, fillTargetFor, pickSortRange } from './engine/selection.js'
import { loadSampleSmall, loadSampleLarge } from './fixtures/loadSample.js'
import FilterMenu from './engine/FilterMenu.jsx'

const TOTAL_ROWS = 50
const TOTAL_COLS = 50

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const single = (r, c) => ({ anchor: { r, c }, focus: { r, c } })
// Times a function call. Lives outside the component so the purity lint rule doesn't flag it.
function timed(fn) {
  const t0 = performance.now()
  const result = fn()
  return { result, ms: performance.now() - t0 }
}

function formatComputed(v) {
  if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10)
  return v == null ? '' : String(v)
}

export default function App() {
  const [engine] = useState(() => createEngine(TOTAL_ROWS, TOTAL_COLS))
  const [, setVersion] = useState(0)
  // ONE selection object for the whole grid (no per-cell state)
  const [sel, setSel] = useState(() => single(0, 0))
  const [editing, setEditing] = useState(null) // { r, c, source: 'cell' | 'bar' }
  const [editValue, setEditValue] = useState('')
  const [fillTarget, setFillTarget] = useState(null)
  const [menu, setMenu] = useState(null)           // { col, x, y } while a filter dropdown is open
  const [sortState, setSortState] = useState(null) // { col, dir, depth }: drives header arrow + click cycle
  const [status, setStatus] = useState('')
  const gridRef = useRef(null)
  const dragRef = useRef(null)
  const skipBlurRef = useRef(false)

  const rerender = () => setVersion((v) => v + 1)
  const range = normRange(sel)
  const active = sel.anchor
  const activeStyle = engine.getStyle(active.r, active.c) || {}

  // ────── Global undo / redo (works wherever focus is, except inside text inputs) ──────

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const el = document.activeElement
      const nativeText = el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'))
      if (nativeText) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (engine.undo()) setVersion((v) => v + 1)
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        if (engine.redo()) setVersion((v) => v + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine])

  // Give the keyboard back to the grid whenever editing ends
  useEffect(() => {
    if (!editing) gridRef.current?.focus({ preventScroll: true })
  }, [editing])

  // ────── Finish a drag (select or fill) ──────

  useEffect(() => {
    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (drag.type === 'fill') {
        const target = fillTarget
        setFillTarget(null)
        if (target && !sameRect(target, drag.source)) {
          fillRange(engine, drag.source, target) // ONE undo step
          setSel({ anchor: { r: target.r1, c: target.c1 }, focus: { r: target.r2, c: target.c2 } })
          setVersion((v) => v + 1)
        }
      }
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [engine, fillTarget])

  // ────── Editing ──────

  const startEdit = (r, c, initial, source = 'cell') => {
    skipBlurRef.current = false
    setEditing({ r, c, source })
    setEditValue(initial !== undefined ? initial : engine.getRaw(r, c))
  }

  const commitEdit = () => {
    if (!editing) return
    if (engine.getRaw(editing.r, editing.c) !== editValue) {
      engine.setCell(editing.r, editing.c, editValue)
      rerender()
    }
    setEditing(null)
  }

  const cancelEdit = () => {
    skipBlurRef.current = true
    setEditing(null)
  }

  const moveTo = (r, c, extend = false) => {
    const rr = clamp(r, 0, engine.rows - 1)
    const cc = clamp(c, 0, engine.cols - 1)
    setSel((s) => (extend ? { anchor: s.anchor, focus: { r: rr, c: cc } } : single(rr, cc)))
    gridRef.current
      ?.querySelector(`td[data-kind="cell"][data-r="${rr}"][data-c="${cc}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const handleCellInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit()
      moveTo(editing.r + 1, editing.c)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commitEdit()
      moveTo(editing.r, editing.c + (e.shiftKey ? -1 : 1))
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  // Formula bar
  const handleBarFocus = () => {
    if (!editing) startEdit(active.r, active.c, undefined, 'bar')
  }
  const handleBarKeyDown = (e) => {
    if (!editing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit()
      moveTo(editing.r + 1, editing.c)
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  // ────── Keyboard on the grid (when not editing) ──────

  const handleGridKeyDown = (e) => {
    if (editing) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      const used = engine.getUsedRange()
      if (used) setSel({ anchor: { r: used.r1, c: used.c1 }, focus: { r: used.r2, c: used.c2 } })
      return
    }
    if (mod) return // Ctrl+Z / Ctrl+Y are handled globally

    const from = e.shiftKey ? sel.focus : sel.anchor
    const step = (dr, dc) => {
      e.preventDefault()
      moveTo(from.r + dr, from.c + dc, e.shiftKey)
    }

    switch (e.key) {
      case 'ArrowDown': return step(1, 0)
      case 'ArrowUp': return step(-1, 0)
      case 'ArrowLeft': return step(0, -1)
      case 'ArrowRight': return step(0, 1)
      case 'Tab': return step(0, e.shiftKey ? -1 : 1)
      case 'Enter':
      case 'F2':
        e.preventDefault()
        return startEdit(active.r, active.c)
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        engine.clearContents(range) // ONE undo step
        rerender()
        return
      default:
        if (e.key.length === 1 && !e.altKey) {
          e.preventDefault()
          startEdit(active.r, active.c, e.key)
        }
    }
  }

  // ────── Mouse (event delegation: one handler for the whole table) ──────

  const hitTest = (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-kind]') : null
    if (!el) return null
    return { kind: el.dataset.kind, r: Number(el.dataset.r), c: Number(el.dataset.c) }
  }

  const handleMouseDown = (e) => {
    if (e.button !== 0 || e.target.tagName === 'INPUT') return
    const hit = hitTest(e)
    if (!hit) return
    if (hit.kind === 'sort' || hit.kind === 'filter') return
    e.preventDefault()
    if (editing) commitEdit()
    gridRef.current?.focus({ preventScroll: true })
    const shift = e.shiftKey
    const lastRow = engine.rows - 1
    const lastCol = engine.cols - 1

    if (hit.kind === 'handle') {
      dragRef.current = { type: 'fill', source: range }
    } else if (hit.kind === 'cell') {
      setSel((s) => (shift ? { anchor: s.anchor, focus: { r: hit.r, c: hit.c } } : single(hit.r, hit.c)))
      dragRef.current = { type: 'cell' }
    } else if (hit.kind === 'col') {
      setSel((s) => ({ anchor: { r: 0, c: shift ? s.anchor.c : hit.c }, focus: { r: lastRow, c: hit.c } }))
      dragRef.current = { type: 'col' }
    } else if (hit.kind === 'row') {
      setSel((s) => ({ anchor: { r: shift ? s.anchor.r : hit.r, c: 0 }, focus: { r: hit.r, c: lastCol } }))
      dragRef.current = { type: 'row' }
    } else if (hit.kind === 'all') {
      setSel({ anchor: { r: 0, c: 0 }, focus: { r: lastRow, c: lastCol } })
    }
  }

  const handleMouseMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    const hit = hitTest(e)
    if (!hit) return
    const lastRow = engine.rows - 1
    const lastCol = engine.cols - 1

    if (drag.type === 'cell' && hit.kind === 'cell') {
      setSel((s) => (s.focus.r === hit.r && s.focus.c === hit.c ? s : { anchor: s.anchor, focus: { r: hit.r, c: hit.c } }))
    } else if (drag.type === 'col' && (hit.kind === 'col' || hit.kind === 'cell')) {
      setSel((s) => (s.focus.c === hit.c ? s : { anchor: s.anchor, focus: { r: lastRow, c: hit.c } }))
    } else if (drag.type === 'row' && (hit.kind === 'row' || hit.kind === 'cell')) {
      setSel((s) => (s.focus.r === hit.r ? s : { anchor: s.anchor, focus: { r: hit.r, c: lastCol } }))
    } else if (drag.type === 'fill' && hit.kind === 'cell') {
      const target = fillTargetFor(drag.source, hit.r, hit.c)
      setFillTarget((prev) => (prev && sameRect(prev, target) ? prev : target))
    }
  }

  const handleDoubleClick = (e) => {
    if (e.target.tagName === 'INPUT') return
    const hit = hitTest(e)
    if (hit && hit.kind === 'cell') startEdit(hit.r, hit.c)
  }

  // ────── Styles: applied to the whole selection as ONE undo step ──────

  const applyStyle = (patchFor) => {
    const changes = []
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const prev = engine.getStyle(r, c) || {}
        changes.push({ row: r, col: c, style: { ...prev, ...patchFor(prev) } })
      }
    }
    engine.applyChanges(changes)
    rerender()
    gridRef.current?.focus({ preventScroll: true })
  }

  const toggleBold = () => { const on = !activeStyle.bold; applyStyle(() => ({ bold: on })) }
  const toggleItalic = () => { const on = !activeStyle.italic; applyStyle(() => ({ italic: on })) }
  const toggleUnderline = () => { const on = !activeStyle.underline; applyStyle(() => ({ underline: on })) }

  // ────── Clear / sample / row & column ops ──────

  const clearSelection = () => {
    const changes = []
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) changes.push({ row: r, col: c, raw: '', style: null })
    }
    engine.applyChanges(changes)
    rerender()
  }

  const clearAllCells = () => {
    const changes = []
    for (let r = 0; r < engine.rows; r++) {
      for (let c = 0; c < engine.cols; c++) changes.push({ row: r, col: c, raw: '', style: null })
    }
    engine.applyChanges(changes)
    setSel(single(0, 0))
    setEditing(null)
    rerender()
  }

  const loadSample = (loader) => {
    loader(engine)
    rerender()
    setSel(single(0, 0))
    setEditing(null)
  }

  const shiftSel = (dr, dc) =>
    setSel((s) => ({
      anchor: { r: s.anchor.r + dr, c: s.anchor.c + dc },
      focus: { r: s.focus.r + dr, c: s.focus.c + dc },
    }))

  const insertRow = () => { engine.insertRow(active.r); shiftSel(1, 0); rerender() }
  const insertColumn = () => { engine.insertColumn(active.c); shiftSel(0, 1); rerender() }
  const deleteRow = () => {
    engine.deleteRow(active.r)
    setSel(single(Math.min(active.r, engine.rows - 1), active.c))
    rerender()
  }
  const deleteColumn = () => {
    engine.deleteColumn(active.c)
    setSel(single(active.r, Math.min(active.c, engine.cols - 1)))
    rerender()
  }

  // ────── Sort / filter ──────

  // The arrow is valid only while the sort is still the latest undo step, so undo/redo keep it honest
  const curSort = sortState && sortState.depth === engine.undoDepth() ? sortState : null
  const summary = engine.getFilterSummary()

const doSort = (col) => {
  const dir = curSort && curSort.col === col ? { asc: 'desc', desc: 'original' }[curSort.dir] : 'asc'
  const { result: res, ms } = timed(() =>
    engine.sortRows({ col, dir, range: pickSortRange(range, col, engine.getUsedRange(), engine.rows, engine.cols) })
  )
  if (!res.ok) setStatus(res.code === 'NO_DATA' ? 'Nothing to sort' : `Column ${columnLabel(col)} is outside the data`)
  else if (!res.changed) setStatus('Already in that order')
  else setStatus(`Sorted column ${columnLabel(col)} (${dir}) in ${ms.toFixed(0)} ms`)
  setSortState(dir === 'original' ? null : { col, dir, depth: engine.undoDepth() })
  rerender()
  gridRef.current?.focus({ preventScroll: true })
}

  const openFilter = (e, col) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMenu({ col, x: Math.min(rect.left, window.innerWidth - 270), y: rect.bottom + 4 })
  }

  // ────── Derived ──────

  const formulaBarValue = editing ? editValue : engine.getRaw(active.r, active.c)

  // ────── Render ──────

  return (
    <div className="app-wrapper">
      <div className="app-header">
        <h2 className="app-title">📊 Spreadsheet App</h2>
      </div>

      <div className="main-content">
        <div className="toolbar">
          <div className="toolbar-group">
            <button className={`toolbar-btn bold-btn ${activeStyle.bold ? 'active' : ''}`} onClick={toggleBold} title="Bold">B</button>
            <button className={`toolbar-btn italic-btn ${activeStyle.italic ? 'active' : ''}`} onClick={toggleItalic} title="Italic">I</button>
            <button className={`toolbar-btn underline-btn ${activeStyle.underline ? 'active' : ''}`} onClick={toggleUnderline} title="Underline">U</button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Size:</span>
            <select className="toolbar-select" value={activeStyle.fontSize || 13} onChange={(e) => applyStyle(() => ({ fontSize: parseInt(e.target.value) }))}>
              {[8, 10, 11, 12, 13, 14, 16, 18, 20, 24].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="toolbar-group">
            <button className={`align-btn ${(activeStyle.align || 'left') === 'left' ? 'active' : ''}`} onClick={() => applyStyle(() => ({ align: 'left' }))} title="Align Left">⬤←</button>
            <button className={`align-btn ${activeStyle.align === 'center' ? 'active' : ''}`} onClick={() => applyStyle(() => ({ align: 'center' }))} title="Align Center">⬤</button>
            <button className={`align-btn ${activeStyle.align === 'right' ? 'active' : ''}`} onClick={() => applyStyle(() => ({ align: 'right' }))} title="Align Right">⬤→</button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Text:</span>
            <input
              type="color"
              value={activeStyle.color || '#202124'}
              onChange={(e) => applyStyle(() => ({ color: e.target.value }))}
              title="Font color"
              style={{ width: '32px', height: '32px', border: '1px solid #dadce0', cursor: 'pointer', borderRadius: '4px' }}
            />
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Fill:</span>
            <select className="toolbar-select" value={activeStyle.bg || 'white'} onChange={(e) => applyStyle(() => ({ bg: e.target.value }))}>
              <option value="white">White</option>
              <option value="#ffff99">Yellow</option>
              <option value="#99ffcc">Green</option>
              <option value="#ffcccc">Red</option>
              <option value="#cce5ff">Blue</option>
              <option value="#e0ccff">Purple</option>
              <option value="#ffd9b3">Orange</option>
              <option value="#f0f0f0">Gray</option>
            </select>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={() => { if (engine.undo()) rerender() }} disabled={!engine.canUndo()} title="Undo (Ctrl+Z)">↶ Undo</button>
            <button className="toolbar-btn" onClick={() => { if (engine.redo()) rerender() }} disabled={!engine.canRedo()} title="Redo (Ctrl+Y)">↷ Redo</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={insertRow} title="Insert row above">+ Row</button>
            <button className="toolbar-btn" onClick={deleteRow} title="Delete row">- Row</button>
            <button className="toolbar-btn" onClick={insertColumn} title="Insert column before">+ Col</button>
            <button className="toolbar-btn" onClick={deleteColumn} title="Delete column">- Col</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn danger" onClick={clearSelection}>✕ Selection</button>
            <button className="toolbar-btn danger" onClick={clearAllCells}>✕ All</button>
            <button className="toolbar-btn" onClick={() => { if (engine.clearFilters()) rerender() }} disabled={!engine.hasFilters()}>Clear filters</button>

          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={() => loadSample(loadSampleSmall)} title="Load fixtures/sales.tsv (33 rows) at A1">⬇ Sample 33</button>
            <button className="toolbar-btn" onClick={() => loadSample(loadSampleLarge)} title="Load fixtures/sales-large.tsv (~3,000 rows) at A1">⬇ Sample 3k</button>
          </div>
        </div>

        <div className="formula-bar">
          <span className="formula-bar-label">{rangeLabel(range)}</span>
          <input
            className="formula-bar-input"
            value={formulaBarValue}
            onChange={(e) => {
              if (!editing) startEdit(active.r, active.c, e.target.value, 'bar')
              else setEditValue(e.target.value)
            }}
            onKeyDown={handleBarKeyDown}
            onFocus={handleBarFocus}
            onBlur={() => { if (editing && editing.source === 'bar') commitEdit() }}
            placeholder="Select a cell then type, or enter a formula like =SUM(A1:A5)"
          />
        </div>

        <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={handleGridKeyDown}>
          <table
            className="grid-table"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onDoubleClick={handleDoubleClick}
          >
            <thead>
              <tr>
                <th className="col-header-blank" data-kind="all"></th>
                {Array.from({ length: engine.cols }, (_, c) => (
                  <th
                    key={c}
                    data-kind="col"
                    data-c={c}
                    className={`col-header ${c >= range.c1 && c <= range.c2 ? 'hdr-sel' : ''}`}
                  >
                    <span className="hdr-label">{columnLabel(c)}</span>
                    <button className={`hdr-btn ${curSort?.col === c ? 'on' : ''}`} data-kind="sort" title="Sort: ascending, descending, original" onClick={() => doSort(c)}>
                      {curSort?.col === c ? (curSort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                    </button>
                    <button className={`hdr-btn ${engine.getFilter(c) ? 'on' : ''}`} data-kind="filter" title="Filter" onClick={(e) => openFilter(e, c)}>▾</button>

                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: engine.rows }, (_, r) => (
               <tr key={r} style={engine.isRowHidden(r) ? { display: 'none' } : undefined}>
                  <td
                    data-kind="row"
                    data-r={r}
                    className={`row-header ${r >= range.r1 && r <= range.r2 ? 'hdr-sel' : ''}`}
                  >
                    {r + 1}
                  </td>
                  {Array.from({ length: engine.cols }, (_, c) => {
                    const cellData = engine.getCell(r, c)
                    const style = cellData.style || {}
                    const display = cellData.error
                      ? cellData.error
                      : cellData.raw.startsWith('=') ? formatComputed(cellData.computed) : cellData.raw

                    let cls = 'cell'
                    if (inRange(range, r, c)) {
                      cls += ' in-sel'
                      if (r === range.r1) cls += ' sel-t'
                      if (r === range.r2) cls += ' sel-b'
                      if (c === range.c1) cls += ' sel-l'
                      if (c === range.c2) cls += ' sel-r'
                    }
                    if (r === active.r && c === active.c) cls += ' active'
                    if (fillTarget && inRange(fillTarget, r, c)) {
                      cls += ' fp'
                      if (r === fillTarget.r1) cls += ' fp-t'
                      if (r === fillTarget.r2) cls += ' fp-b'
                      if (c === fillTarget.c1) cls += ' fp-l'
                      if (c === fillTarget.c2) cls += ' fp-r'
                    }

                    const isCellEditor = editing && editing.source === 'cell' && editing.r === r && editing.c === c
                    const isBarEditing = editing && editing.source === 'bar' && editing.r === r && editing.c === c
                    const textStyle = {
                      fontWeight: style.bold ? 'bold' : 'normal',
                      fontStyle: style.italic ? 'italic' : 'normal',
                      textDecoration: style.underline ? 'underline' : 'none',
                      color: cellData.error ? '#d93025' : (style.color || '#202124'),
                      fontSize: (style.fontSize || 13) + 'px',
                    }

                    return (
                      <td
                        key={c}
                        data-kind="cell"
                        data-r={r}
                        data-c={c}
                        className={cls}
                        style={{ background: style.bg || 'white' }}
                      >
                        {isCellEditor ? (
                          <input
                            autoFocus
                            className="cell-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
                            onBlur={() => {
                              if (skipBlurRef.current) { skipBlurRef.current = false; return }
                              commitEdit()
                            }}
                            onKeyDown={handleCellInputKeyDown}
                            style={{ ...textStyle, textAlign: style.align || 'left', background: style.bg || 'white' }}
                          />
                        ) : (
                          <div
                            className={`cell-display align-${style.align || 'left'} ${cellData.error ? 'error' : ''}`}
                            style={textStyle}
                          >
                            {isBarEditing ? editValue : display}
                          </div>
                        )}
                        {!editing && r === range.r2 && c === range.c2 && (
                          <div className="fill-handle" data-kind="handle" title="Drag to fill"></div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="status-line">
          <span>{summary.active ? `${summary.visible} of ${summary.total} rows` : ''}</span>
          <span>{status}</span>
        </div>
        <p className="footer-hint">
          Click = select · Drag / Shift+Click / Shift+Arrow = range · Double-click, Enter, F2 or just type = edit · Delete clears · Ctrl+A used range · Drag the blue square to fill · Ctrl+Z / Ctrl+Y
        </p>
      </div>
            {menu && (
              <>
                <div className="fm-backdrop" onMouseDown={() => setMenu(null)} />
                <FilterMenu
                  key={menu.col}
                  engine={engine}
                  col={menu.col}
                  label={columnLabel(menu.col)}
                  x={menu.x}
                  y={menu.y}
                  onClose={() => setMenu(null)}
                  onChange={(spec) => { engine.setFilter(menu.col, spec); rerender() }}
                />
              </>
            )}
    </div>
  )
}