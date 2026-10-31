import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import SocketStatusIndicator from '../../../Shared/components/SocketStatusIndicator'
import { getCrr, formatOverFigure } from '../utils/matchHelpers'

// A tiny stand-in for a socket.io client: the indicator only subscribes to
// connect/disconnect/connect_error, so the test emits those events by hand.
const makeSocket = () => {
  const handlers = new Map()
  return {
    connected: false,
    active: true,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) || []), handler])
    },
    off() {},
    io: { on() {}, off() {} },
    emit(event, payload) {
      for (const handler of handlers.get(event) || []) handler(payload)
    },
  }
}

describe('SocketStatusIndicator', () => {
  it('shows no bar for a socket that was never connected', () => {
    const socket = makeSocket()
    render(<SocketStatusIndicator getSocket={() => socket} />)
    expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument()
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
  })

  it('shows Reconnecting... only after a real connection dropped, then hides it again', () => {
    const socket = makeSocket()
    render(<SocketStatusIndicator getSocket={() => socket} />)

    act(() => socket.emit('connect'))
    expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument()

    act(() => socket.emit('disconnect'))
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument()

    act(() => socket.emit('connect'))
    expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument()
  })

  it('renders nothing when there is no socket at all', () => {
    render(<SocketStatusIndicator getSocket={() => null} />)
    expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument()
  })
})

describe('scorecard run rate and fall-of-wicket overs', () => {
  it('derives the run rate from balls, not overs plus balls', () => {
    // 199/4 in 15.0 overs (90 balls) used to print 6.63 because overs and balls
    // were added together; the correct rate is 199 / 15 = 13.27.
    expect(getCrr({ runs: 199, wickets: 4, overs: 15, balls: 90 })).toBe('13.27')
    expect(getCrr({ runs: 120, wickets: 6, overs: 15 })).toBe('8.00')
    expect(getCrr({ runs: 0, wickets: 0, overs: 0, balls: 0 })).toBe('0.00')
  })

  it('prints fall-of-wicket overs as the stored over figure and hides an empty one', () => {
    expect(formatOverFigure(2.1)).toBe('2.1')
    expect(formatOverFigure(8.3)).toBe('8.3')
    expect(formatOverFigure(5)).toBe('5.0')
    expect(formatOverFigure(0)).toBe('')
    expect(formatOverFigure(null)).toBe('')
  })
})
