import { useEffect, useRef, useState } from 'react'
import { requestAction, runQuery, insertResult, applyFormat } from './ai/pipeline.js'
import { describePlan } from './ai/describe.js'
import { measureText } from './measureText.js'

const PREVIEW_ROWS = 100

function QueryCard({ outcome, activeLabel, onRerun, onInserted }) {
  const [where, setWhere] = useState('')
  const [note, setNote] = useState('')
  const { result } = outcome
  const insert = () => {
    const r = insertResult(outcome.engine, result, where.trim() || activeLabel)
    setNote(r.ok ? `Inserted at ${r.at}. One undo step (Undo button, or click the grid then Ctrl+Z).` : r.error)
    if (r.ok) onInserted()
  }
  return (
    <>
      <div className="ai-desc">{describePlan(outcome.action)}</div>
      <div className="ai-table-wrap">
        <table className="ai-table">
          <thead><tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>
            {result.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
              <tr key={i}>{row.map((v, j) => <td key={j}>{v === null ? '—' : String(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ai-meta">
        {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
        {result.truncated ? ' (truncated by limit)' : ''}
        {result.rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ''}
        {' · executed in '}{outcome.ms.toFixed(1)} ms
      </div>
      <div className="ai-actions">
        <button className="toolbar-btn" onClick={onRerun}>↻ Re-run</button>
        <input className="fm-input ai-where" placeholder={activeLabel} value={where} onChange={(e) => setWhere(e.target.value)} title="Top-left cell to write at" />
        <button className="toolbar-btn" onClick={insert}>Insert into sheet</button>
      </div>
      {note && <div className="ai-meta">{note}</div>}
    </>
  )
}

function FormatCard({ outcome, engine, onChange }) {
  const [state, setState] = useState({ status: 'ready', note: '' })
  const plan = outcome.plan
  const ok = plan.result === 'OK'
  const apply = () => {
    const r = applyFormat(outcome.action, engine, measureText) // re-plans against the CURRENT sheet
    if (r.result === 'OK') {
      setState({ status: 'applied', note: `Applied: ${r.info.cellsChanged} cells restyled in ${r.ms.toFixed(1)} ms. One undo step (Undo button, or click the grid then Ctrl+Z).` })
      onChange()
    } else {
      setState({ status: 'ready', note: `${r.result}: ${r.message}` })
    }
  }
  return (
    <>
      {ok
        ? <div className="ai-desc"><strong>Preview:</strong> {outcome.text}.</div>
        : <div className="ai-err"><strong>{plan.result}</strong>: {plan.message}</div>}
      {ok && state.status === 'ready' && (
        <div className="ai-actions">
          <button className="toolbar-btn" onClick={apply}>Apply</button>
          <button className="toolbar-btn" onClick={() => setState({ status: 'discarded', note: 'Discarded. Nothing changed.' })}>Discard</button>
        </div>
      )}
      {state.note && <div className="ai-meta">{state.note}</div>}
    </>
  )
}

function Card({ card, engine, activeLabel, showPlan, onRerun, onChange }) {
  const o = card.outcome
  return (
    <div className="ai-card">
      <div className="ai-prompt">{card.prompt}</div>
      {card.pending && <div className="ai-meta">Thinking…</div>}
      {o?.kind === 'error' && (
        <div className="ai-err">
          <strong>{o.code}</strong>: {o.detail}
          {o.code === 'UNKNOWN_COLUMN' && <div>Which column did you mean? Available: {o.available?.join(', ')}</div>}
          {o.action?.type === 'query' && <div className="ai-actions"><button className="toolbar-btn" onClick={onRerun}>↻ Re-run</button></div>}
        </div>
      )}
      {o?.kind === 'clarify' && <div className="ai-clarify">🤔 {o.question}</div>}
      {o?.kind === 'query' && <QueryCard outcome={{ ...o, engine }} activeLabel={activeLabel} onRerun={onRerun} onInserted={onChange} />}
      {o?.kind === 'format' && <FormatCard outcome={o} engine={engine} onChange={onChange} />}
      {showPlan && o?.action && <pre className="ai-plan">{JSON.stringify(o.action, null, 2)}</pre>}
    </div>
  )
}

export default function AiPanel({ engine, provider, activeLabel, selectionLabel, onClose, onChange }) {
  const [cards, setCards] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const idRef = useRef(0)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [cards.length])

  const submit = async () => {
    const prompt = input.trim()
    if (!prompt || busy) return
    const id = idRef.current++
    const history = cards
      .filter((c) => c.raw)
      .slice(-4)
      .flatMap((c) => [{ role: 'user', content: c.prompt }, { role: 'assistant', content: c.raw }])
    setInput('')
    setBusy(true)
    setCards((cs) => [...cs, { id, prompt, pending: true }])
    const out = await requestAction({ provider, engine, prompt, history, selection: selectionLabel, measure: measureText })
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, pending: false, ...out } : c)))
    setBusy(false)
  }

  // Re-run: same plan, current sheet data, NO model call
  const rerun = (id) =>
    setCards((cs) => cs.map((c) => (c.id === id && c.outcome?.action?.type === 'query' ? { ...c, outcome: runQuery(c.outcome.action, engine) } : c)))

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <strong>Ask AI</strong>
        <span className="ai-provider">{provider.name}</span>
        <label className="ai-toggle"><input type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} /> show plan</label>
        <button className="toolbar-btn" onClick={onClose} title="Close (Ctrl+K)">✕</button>
      </div>
      <div className="ai-body">
        {cards.length === 0 && <div className="ai-meta">Try: “What is the total sales by region?” or “Format this as a clean table” (mock mode answers the prompts in fixtures/ai-eval/).</div>}
        {cards.map((c) => (
          <Card key={c.id} card={c} engine={engine} activeLabel={activeLabel} showPlan={showPlan} onRerun={() => rerun(c.id)} onChange={onChange} />
        ))}
        <div ref={endRef} />
      </div>
      <div className="ai-input-row">
        <input
          className="fm-input ai-input"
          autoFocus
          placeholder="Ask about your data, or say how to format it…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') onClose()
          }}
        />
        <button className="toolbar-btn" onClick={submit} disabled={busy}>Ask</button>
      </div>
    </aside>
  )
}