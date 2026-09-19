import { describe, expect, it } from 'vitest'
import { diffLines, diffStats } from './lineDiff.js'

describe('diffLines', () => {
  it('marks unchanged, added and removed lines in order', () => {
    const d = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(d).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ])
    expect(diffStats(d)).toEqual({ same: 2, add: 2, del: 1 })
  })

  it('treats an empty original as all additions, and identical text as all same', () => {
    expect(diffLines('', 'x\ny').every((l) => l.type === 'add')).toBe(true)
    expect(diffLines('x\ny', 'x\ny').every((l) => l.type === 'same')).toBe(true)
  })

  it('is stable across CRLF input', () => {
    expect(diffLines('a\r\nb', 'a\nb').every((l) => l.type === 'same')).toBe(true)
  })
})
