import { describe, it, expect } from 'vitest'
import { parseAction, extractJson } from './validate.js'

const plan = { type: 'query', groupBy: ['Region'], limit: 3 }

describe('parseAction', () => {
  it('handles bare JSON, fenced JSON, and prose around JSON', () => {
    const j = JSON.stringify(plan)
    expect(parseAction(j).ok).toBe(true)
    expect(parseAction('```json\n' + j + '\n```').ok).toBe(true)
    expect(parseAction('Sure! Here you go:\n' + j + '\nAnything else {maybe}?').ok).toBe(true)
  })
  it('is not fooled by braces inside strings', () => {
    expect(extractJson('x {"a":"}{","b":1} y')).toBe('{"a":"}{","b":1}')
  })
  it('rejects non-JSON, wrong types, unknown properties and bad limits, saying what failed', () => {
    expect(parseAction('no json here')).toMatchObject({ ok: false, code: 'INVALID_RESPONSE' })
    expect(parseAction('{"type":"query","limit":0}').detail).toMatch(/limit/)
    expect(parseAction('{"type":"query","bogus":1}').detail).toMatch(/bogus/)
    expect(parseAction('{"type":"query","filters":[{"column":"A","op":"like"}]}').detail).toMatch(/op/)
  })
  it('rejects any non-allowed action type as READ_ONLY', () => {
    expect(parseAction('{"type":"mutation","action":"deleteRows"}')).toMatchObject({ ok: false, code: 'READ_ONLY' })
    expect(parseAction('{"type":"constructor"}').code).toBe('READ_ONLY')
  })
})