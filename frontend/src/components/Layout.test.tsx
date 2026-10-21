import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from './Layout'

// Stubs window.visualViewport so tests can simulate the on-screen keyboard
// shrinking the visible area (a real event the browser fires on mobile).
let vvHeight = 0
let vvListener: (() => void) | null = null

const installVisualViewport = () => {
  vvHeight = window.innerHeight
  const vv = {
    get height() { return vvHeight },
    addEventListener: (_type: string, cb: () => void) => { vvListener = cb },
    removeEventListener: () => { vvListener = null },
  }
  vi.stubGlobal('visualViewport', vv)
  return vv
}

const resizeKeyboard = (h: number) => {
  vvHeight = h
  act(() => vvListener?.())
}

afterEach(() => {
  vi.unstubAllGlobals()
  vvListener = null
})

const renderLayout = () =>
  render(
    <MemoryRouter>
      <Layout>
        <div>content</div>
      </Layout>
    </MemoryRouter>,
  )

describe('Layout — keeps bottom panel visible above the on-screen keyboard', () => {
  it('sizes the shell to the full visual viewport height', () => {
    window.innerHeight = 568
    installVisualViewport()
    renderLayout()
    const shell = screen.getByText('content').parentElement!.parentElement!
    expect(shell.style.height).toBe('568px')
  })

  it('shrinks the shell when the virtual keyboard reduces the visual viewport', () => {
    window.innerHeight = 568
    installVisualViewport()
    renderLayout()
    const shell = screen.getByText('content').parentElement!.parentElement!

    // The on-screen keyboard covers the bottom ~40%: the browser reports a
    // smaller visualViewport.height but leaves innerHeight (layout) unchanged.
    resizeKeyboard(320)

    expect(shell.style.height).toBe('320px')
  })
})
