import { useMemo, useState } from 'react'

const OPS = [
  { value: '', label: 'No condition' },
  { value: 'contains', label: 'Contains' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'empty', label: 'Is empty' },
]

export default function FilterMenu({ engine, col, label, x, y, onClose, onChange }) {
  const items = useMemo(() => engine.getDistinctValues(col), [engine, col])
  const existing = engine.getFilter(col)
  const [checked, setChecked] = useState(() => new Set(existing?.include ?? items.map((i) => i.key)))
  const [search, setSearch] = useState('')
  const [op, setOp] = useState(existing?.cond?.op ?? '')
  const [value, setValue] = useState(existing?.cond?.value ?? '')

  const q = search.trim().toLowerCase()
  const shown = items.filter((i) => (i.label || '(Blanks)').toLowerCase().includes(q))
  const allShown = shown.length > 0 && shown.every((i) => checked.has(i.key))

  const toggle = (key) =>
    setChecked((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const toggleAll = () =>
    setChecked((prev) => {
      const n = new Set(prev)
      shown.forEach((i) => (allShown ? n.delete(i.key) : n.add(i.key)))
      return n
    })

  const apply = () => {
    // With a search term, only the matching checked values count
    const pool = (q ? shown : items).filter((i) => checked.has(i.key))
    const include = pool.length === items.length ? null : pool.map((i) => i.key)
    const cond = op && (op === 'empty' || value.trim() !== '') ? { op, value } : null
    onChange(include || cond ? { include, cond } : null)
    onClose()
  }

  return (
    <div className="filter-menu" style={{ left: x, top: y }}>
      <div className="fm-title">Filter column {label}</div>
      <select className="toolbar-select" value={op} onChange={(e) => setOp(e.target.value)}>
        {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {op && op !== 'empty' && (
        <input className="fm-input" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      <input className="fm-input" placeholder="Search values…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="fm-row">
        <input type="checkbox" checked={allShown} onChange={toggleAll} /> (Select all)
      </label>
      <div className="fm-list">
        {shown.map((i) => (
          <label key={i.key} className="fm-row">
            <input type="checkbox" checked={checked.has(i.key)} onChange={() => toggle(i.key)} />
            {i.label || '(Blanks)'}
            <span className="fm-count">{i.count}</span>
          </label>
        ))}
      </div>
      <div className="fm-actions">
        <button className="toolbar-btn" onClick={apply}>Apply</button>
        <button className="toolbar-btn" onClick={() => { onChange(null); onClose() }}>Clear</button>
        <button className="toolbar-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}