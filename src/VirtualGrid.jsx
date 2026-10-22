import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createAxis, DEFAULT_ROW_H, MIN_SIZE } from './engine/layout.js'
import { columnLabel, inRange } from './engine/selection.js'

const HDR_H = 28 // column header height
const RH_W = 56 // row header width
const OVERSCAN = 4

// ── helpers ──
let measureCtx = null
function textWidth(text) {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
    measureCtx.font = "13px 'Courier New', monospace"
  }
  return measureCtx.measureText(text).width
}

function formatComputed(v) {
  if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10)
  return v == null ? '' : String(v)
}

function cellText(cell) {
  if (cell.error) return cell.error
  return cell.raw.startsWith('=') ? formatComputed(cell.computed) : cell.raw
}

function spans(a, b) {
  const out = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

/**
 * Virtualized grid. Three horizontal bands (header, frozen rows, body), each made of three
 * segments (row-header column, frozen columns, scrolling columns). Sticky positioning keeps
 * the frozen parts in place while the browser scrolls natively. Only visible cells exist in
 * the DOM; there is no React state per cell (just one scroll position + one resize preview).
 */
export default function VirtualGrid({
  engine, gridRef, apiRef, range, active, fillTarget, editing, editValue, freeze, curSort,
  onEditChange, onEditKeyDown, onEditBlur, onSort, onFilter, onLayoutChange,
  onKeyDown, onMouseDown, onMouseMove, onDoubleClick,
}) {
  const [view, setView] = useState({ top: 0, left: 0, w: 800, h: 600 })
  const [preview, setPreview] = useState(null) // { kind: 'col'|'row', index, size } while dragging a border
  const rafRef = useRef(0)

  const nRows = engine.rows
  const nCols = engine.cols
  const layoutVersion = engine.layoutVersion()
  const colPreview = preview && preview.kind === 'col' ? preview : null
  const rowPreview = preview && preview.kind === 'row' ? preview : null

  // Prefix sums: rebuilt only when sizes / hidden rows / counts change, not on scroll.
  const colAxis = useMemo(() => {
    void layoutVersion // sizes live in the engine; this number changes whenever they do
    return createAxis(nCols, (c) => (colPreview && colPreview.index === c ? colPreview.size : engine.getColWidth(c)))
  }, [engine, nCols, layoutVersion, colPreview])

  const rowAxis = useMemo(() => {
    void layoutVersion
    return createAxis(nRows, (r) => (rowPreview && rowPreview.index === r ? rowPreview.size : engine.getRowHeight(r)))
  }, [engine, nRows, layoutVersion, rowPreview])

  // Track viewport size (ResizeObserver also fires once when we start observing).
  useEffect(() => {
    const el = gridRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [gridRef])

   useEffect(() => () => {
     cancelAnimationFrame(rafRef.current)
     rafRef.current = 0
   }, [])

  // Scroll position -> state, at most once per animation frame.
  const handleScroll = (e) => {
    const el = e.currentTarget
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }))
    })
  }

  // Imperative API for App: keep a cell in view, and how many rows make one "page".
  useImperativeHandle(
    apiRef,
    () => ({
      scrollToCell(r, c) {
        const el = gridRef.current
        if (!el) return
        const frozenH = rowAxis.offsetOf(Math.min(freeze.rows, nRows))
        const frozenW = colAxis.offsetOf(Math.min(freeze.cols, nCols))
        if (r >= freeze.rows) {
          const top = HDR_H + rowAxis.offsetOf(r)
          const bottom = top + rowAxis.sizeOf(r)
          if (top < el.scrollTop + HDR_H + frozenH) el.scrollTop = top - HDR_H - frozenH
          else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
        }
        if (c >= freeze.cols) {
          const left = RH_W + colAxis.offsetOf(c)
          const right = left + colAxis.sizeOf(c)
          if (left < el.scrollLeft + RH_W + frozenW) el.scrollLeft = left - RH_W - frozenW
          else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
        }
      },
      pageRows() {
        const el = gridRef.current
        return el ? Math.max(1, Math.floor((el.clientHeight - HDR_H) / DEFAULT_ROW_H) - 1) : 20
      },
    }),
    [gridRef, rowAxis, colAxis, freeze, nRows, nCols],
  )

  // ── Resize: live preview in local state, ONE engine call (one undo step) on mouseup ──
  const startResize = (e, kind, index) => {
    e.preventDefault()
    e.stopPropagation()
    const startPos = kind === 'col' ? e.clientX : e.clientY
    const startSize = kind === 'col' ? engine.getColWidth(index) : engine.getRowHeight(index)
    let size = startSize
    const move = (ev) => {
      const delta = (kind === 'col' ? ev.clientX : ev.clientY) - startPos
      size = Math.max(MIN_SIZE, startSize + delta)
      setPreview({ kind, index, size })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setPreview(null)
      if (kind === 'col') engine.setColWidth(index, size)
      else engine.setRowHeight(index, size)
      onLayoutChange()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Double-click on a column border: fit to the widest text in that column.
  const autoFit = (e, col) => {
    e.preventDefault()
    e.stopPropagation()
    let w = textWidth(columnLabel(col)) + 60 // header label + sort/filter buttons
    const used = engine.getUsedRange()
    if (used) {
      for (let r = used.r1; r <= used.r2; r++) {
        const text = cellText(engine.getCell(r, col))
        if (text) w = Math.max(w, textWidth(text) + 16)
      }
    }
    engine.setColWidth(col, Math.min(600, Math.ceil(w)))
    onLayoutChange()
  }

  // ── What is visible ──
  const fr = Math.min(freeze.rows, nRows)
  const fc = Math.min(freeze.cols, nCols)
  const fh = rowAxis.offsetOf(fr) // height of the frozen-rows band
  const fw = colAxis.offsetOf(fc) // width of the frozen-columns segment
  const rv = rowAxis.visibleRange(Math.max(0, view.top - HDR_H), view.h, OVERSCAN)
  const cv = colAxis.visibleRange(Math.max(0, view.left - RH_W), view.w, OVERSCAN)
  const frozenRows = spans(0, fr - 1)
  const bodyRows = spans(Math.max(rv.first, fr), rv.last)
  const frozenCols = spans(0, fc - 1)
  const scrollCols = spans(Math.max(cv.first, fc), cv.last)
  const totalW = RH_W + colAxis.total

  // ── Cells ──
  const renderCell = (r, c, left, top) => {
    const cellData = engine.getCell(r, c)
    const style = cellData.style || {}
    const display = cellText(cellData)

    let cls = 'cell vcell'
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
      color: cellData.error ? '#d93025' : style.color || '#202124',
      fontSize: (style.fontSize || 13) + 'px',
    }

    return (
      <div
        key={`${r}:${c}`}
        data-kind="cell"
        data-r={r}
        data-c={c}
        className={cls}
        style={{ left, top, width: colAxis.sizeOf(c), height: rowAxis.sizeOf(r), background: style.bg || 'white' }}
      >
        {isCellEditor ? (
          <input
            autoFocus
            className="cell-input"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            style={{ ...textStyle, textAlign: style.align || 'left', background: style.bg || 'white' }}
          />
        ) : (
          <div className={`cell-display align-${style.align || 'left'} ${cellData.error ? 'error' : ''}`} style={textStyle}>
            {isBarEditing ? editValue : display}
          </div>
        )}
        {!editing && r === range.r2 && c === range.c2 && <div className="fill-handle" data-kind="handle" title="Drag to fill" />}
      </div>
    )
  }

  // rowList x colList, positions relative to the segment (rowBase / colBase = its origin)
  const cellsFor = (rowList, rowBase, colList, colBase) => {
    const out = []
    for (const r of rowList) {
      if (rowAxis.sizeOf(r) === 0) continue // hidden by a filter
      for (const c of colList) out.push(renderCell(r, c, colAxis.offsetOf(c) - colBase, rowAxis.offsetOf(r) - rowBase))
    }
    return out
  }

  const rowHeaders = (rowList, rowBase) =>
    rowList
      .filter((r) => rowAxis.sizeOf(r) > 0)
      .map((r) => (
        <div
          key={r}
          className={`vhdr ${r >= range.r1 && r <= range.r2 ? 'hdr-sel' : ''}`}
          data-kind="row"
          data-r={r}
          style={{ left: 0, top: rowAxis.offsetOf(r) - rowBase, width: RH_W, height: rowAxis.sizeOf(r) }}
        >
          {r + 1}
          <div className="resizer-row" onMouseDown={(e) => startResize(e, 'row', r)} />
        </div>
      ))

  const colHeaders = (colList, colBase) =>
    colList.map((c) => (
      <div
        key={c}
        className={`vhdr ${c >= range.c1 && c <= range.c2 ? 'hdr-sel' : ''}`}
        data-kind="col"
        data-c={c}
        style={{ left: colAxis.offsetOf(c) - colBase, top: 0, width: colAxis.sizeOf(c), height: HDR_H }}
      >
        <span className="hdr-label">{columnLabel(c)}</span>
        <button
          className={`hdr-btn ${curSort?.col === c ? 'on' : ''}`}
          data-kind="sort"
          title="Sort: ascending, descending, original"
          onClick={() => onSort(c)}
        >
          {curSort?.col === c ? (curSort.dir === 'asc' ? '▲' : '▼') : '⇅'}
        </button>
        <button className={`hdr-btn ${engine.getFilter(c) ? 'on' : ''}`} data-kind="filter" title="Filter" onClick={(e) => onFilter(e, c)}>
          ▾
        </button>
        <div className="resizer-col" onMouseDown={(e) => startResize(e, 'col', c)} onDoubleClick={(e) => autoFit(e, c)} />
      </div>
    ))

  // ── Layout of one band: [row headers | frozen columns | scrolling columns] ──
  const seg0 = (h) => ({ position: 'sticky', left: 0, width: RH_W, height: h, flex: 'none', zIndex: 3, background: '#f8f9fa' })
  const seg1 = (h) => ({
    position: 'sticky', left: RH_W, width: fw, height: h, flex: 'none', zIndex: 2, background: '#fff',
    boxShadow: fc > 0 ? '2px 0 0 #9aa0a6' : undefined,
  })
  const seg2 = (h) => ({ position: 'relative', width: colAxis.total - fw, height: h, flex: 'none', zIndex: 1 })

  return (
    <div
      className="vg-scroll"
      ref={gridRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={handleScroll}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onDoubleClick={onDoubleClick}
    >
      <div style={{ position: 'relative', width: totalW, height: HDR_H + rowAxis.total }}>
        {/* column header band (sticky to the top) */}
        <div style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', width: totalW, height: HDR_H }}>
          <div style={seg0(HDR_H)}>
            <div className="vhdr" data-kind="all" style={{ left: 0, top: 0, width: RH_W, height: HDR_H }} />
          </div>
          <div style={seg1(HDR_H)}>{colHeaders(frozenCols, 0)}</div>
          <div style={seg2(HDR_H)}>{colHeaders(scrollCols, fw)}</div>
        </div>

        {/* frozen rows band (sticky just below the header) */}
        {fr > 0 && (
          <div style={{ position: 'sticky', top: HDR_H, zIndex: 20, display: 'flex', width: totalW, height: fh, boxShadow: '0 2px 0 #9aa0a6' }}>
            <div style={seg0(fh)}>{rowHeaders(frozenRows, 0)}</div>
            <div style={seg1(fh)}>{cellsFor(frozenRows, 0, frozenCols, 0)}</div>
            <div style={seg2(fh)}>{cellsFor(frozenRows, 0, scrollCols, fw)}</div>
          </div>
        )}

        {/* body band: scrolls normally, only visible rows exist */}
        <div style={{ position: 'relative', zIndex: 10, display: 'flex', width: totalW, height: rowAxis.total - fh }}>
          <div style={seg0(rowAxis.total - fh)}>{rowHeaders(bodyRows, fh)}</div>
          <div style={seg1(rowAxis.total - fh)}>{cellsFor(bodyRows, fh, frozenCols, 0)}</div>
          <div style={seg2(rowAxis.total - fh)}>{cellsFor(bodyRows, fh, scrollCols, fw)}</div>
        </div>
      </div>
    </div>
  )
}