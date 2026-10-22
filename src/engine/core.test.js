// Starter tests for the engine. Extend this file (or add more *.test.js
// files) for every behaviour you implement. Graders run `npm test` and add
// their own hidden tests against the public engine API you document in
// DESIGN_NOTES.md.
//import { describe, it, expect } from 'vitest'
//import { createEngine } from './core.js'
import { describe, it, expect } from 'vitest'
import { createEngine, shiftCellReferences, shiftFormulaForFill, parseCellKey } from './core.js'

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

describe('formula parser', () => {
    const calc = (formula) => {
        const e = createEngine(20, 20)
        e.setCell(0, 0, '5')
        e.setCell(1, 0, '10')
        e.setCell(0, 1, formula)
        return e.getCell(0, 1)
    }
    it('handles a function before and after an operator', () => {
        expect(calc('=SUM(A1:A2)*2').computed).toBe(30)
        expect(calc('=2*SUM(A1:A2)').computed).toBe(30)
        expect(calc('=1+SUM(A1:A2)').computed).toBe(16)
    })
    it('handles parentheses and unary minus', () => {
        expect(calc('=(1+2)*2').computed).toBe(6)
        expect(calc('=-A1').computed).toBe(-5)
    })
    it('treats blank cells as 0 in arithmetic', () => {
        expect(calc('=C5*2').computed).toBe(0)
    })
})

describe('absolute references', () => {
    it('parses $ markers', () => {
        expect(parseCellKey('$A$1')).toMatchObject({ row: 0, col: 0, colAbs: true, rowAbs: true })
        expect(parseCellKey('A$1')).toMatchObject({ colAbs: false, rowAbs: true })
    })
    it('fill keeps $ parts pinned', () => {
        expect(shiftFormulaForFill('=G2*H2', 1, 0)).toBe('=G3*H3')
        expect(shiftFormulaForFill('=$G$2*H2', 1, 0)).toBe('=$G$2*H3')
        expect(shiftFormulaForFill('=$G2*H$2', 1, 1)).toBe('=$G3*I$2')
    })
    it('structural edits shift even $ references', () => {
        expect(shiftCellReferences('=$G$2*H32', 1, 0, 9)).toBe('=$G$2*H33')
        expect(shiftCellReferences('=$G$20+1', 1, 0, 9)).toBe('=$G$21+1')
    })
    it('insertRow keeps =$G$2*H33 acceptance case', () => {
        const e = createEngine(50, 20)
        e.setCell(31, 11, '=$G$2*H32') // L32
        e.insertRow(9)
        expect(e.getRaw(32, 11)).toBe('=$G$2*H33')
    })
})