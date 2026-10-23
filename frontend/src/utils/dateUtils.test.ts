import { describe, it, expect } from 'vitest'
import { formatISODate } from './dateUtils'

describe('formatISODate', () => {
  it('formats as yyyy-mm-dd with zero-padded month and day', () => {
    expect(formatISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatISODate(new Date(2026, 9, 21))).toBe('2026-10-21')
    expect(formatISODate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
