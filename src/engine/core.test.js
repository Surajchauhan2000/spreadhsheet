// Starter tests for the engine. Extend this file (or add more *.test.js
// files) for every behaviour you implement. Graders run `npm test` and add
// their own hidden tests against the public engine API you document in
// DESIGN_NOTES.md.
import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'

describe('engine basics', () => {
    it('evaluates arithmetic and ranges', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM(A1:A2)*2')
        expect(engine.getCell(2, 0).computed).toBe(60)
    })

    it('reports a cycle instead of hanging', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '=B1')
        engine.setCell(0, 1, '=A1')
        expect(engine.getCell(0, 1).error).toBe('#CYCLE!')
    })

    it('undoes and redoes a single edit', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'hello')
        engine.setCell(0, 0, 'world')
        engine.undo()
        expect(engine.getCell(0, 0).raw).toBe('hello')
        engine.redo()
        expect(engine.getCell(0, 0).raw).toBe('world')
    })

    it('shifts references when a row is inserted above them', () => {
        const engine = createEngine(10, 10)
        engine.setCell(2, 0, '5')       // A3
        engine.setCell(4, 0, '=A3+1')   // A5
        engine.insertRow(1)             // A3 -> A4, A5 -> A6
        expect(engine.getCell(5, 0).raw).toBe('=A4+1')
        expect(engine.getCell(5, 0).computed).toBe(6)
    })
})

describe('range parsing bug fix', () => {
    it('evaluates SUM(A1:A2) inside function call', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM(A1:A2)')
        expect(engine.getCell(2, 0).computed).toBe(30)
    })

    it('evaluates SUM(A1:A2)*2', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM(A1:A2)*2')
        expect(engine.getCell(2, 0).computed).toBe(60)
    })

    it('evaluates SUM(A1:A2)+1', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM(A1:A2)+1')
        expect(engine.getCell(2, 0).computed).toBe(31)
    })
})
