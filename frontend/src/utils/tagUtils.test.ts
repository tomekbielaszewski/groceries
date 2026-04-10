import { describe, it, expect } from 'vitest'
import { normalizeTag } from './tagUtils'

describe('normalizeTag', () => {
  it('lowercases ASCII input', () => {
    expect(normalizeTag('Fruit')).toBe('fruit')
    expect(normalizeTag('DAIRY')).toBe('dairy')
    expect(normalizeTag('MixedCase')).toBe('mixedcase')
  })

  it('trims whitespace', () => {
    expect(normalizeTag('  fruit  ')).toBe('fruit')
    expect(normalizeTag('\ttag\n')).toBe('tag')
  })

  it('replaces Polish diacritics', () => {
    expect(normalizeTag('ą')).toBe('a')
    expect(normalizeTag('ć')).toBe('c')
    expect(normalizeTag('ę')).toBe('e')
    expect(normalizeTag('ł')).toBe('l')
    expect(normalizeTag('ń')).toBe('n')
    expect(normalizeTag('ó')).toBe('o')
    expect(normalizeTag('ś')).toBe('s')
    expect(normalizeTag('ź')).toBe('z')
    expect(normalizeTag('ż')).toBe('z')
  })

  it('replaces uppercase Polish diacritics', () => {
    expect(normalizeTag('Ą')).toBe('a')
    expect(normalizeTag('Ć')).toBe('c')
    expect(normalizeTag('Ę')).toBe('e')
    expect(normalizeTag('Ł')).toBe('l')
    expect(normalizeTag('Ń')).toBe('n')
    expect(normalizeTag('Ó')).toBe('o')
    expect(normalizeTag('Ś')).toBe('s')
    expect(normalizeTag('Ź')).toBe('z')
    expect(normalizeTag('Ż')).toBe('z')
  })

  it('normalizes mixed input', () => {
    expect(normalizeTag('Słodycze')).toBe('slodycze')
    expect(normalizeTag('Świeże Owoce')).toBe('swieze owoce')
    expect(normalizeTag('ŻÓŁTY SER')).toBe('zolty ser')
    expect(normalizeTag('nabiał')).toBe('nabial')
    expect(normalizeTag('Mięso')).toBe('mieso')
  })
})
