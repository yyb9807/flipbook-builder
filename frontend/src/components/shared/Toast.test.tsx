import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { ToastHost, toast } from './Toast'

describe('Toast singleton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('toast.show 弹出消息后由 ToastHost 渲染到 DOM', () => {
    render(<ToastHost />)
    act(() => {
      toast.show('hello world', 'success')
    })
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('多条 toast 堆叠（不互相覆盖）', () => {
    render(<ToastHost />)
    act(() => {
      toast.show('first')
      toast.show('second')
      toast.show('third')
    })
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.getByText('third')).toBeInTheDocument()
  })

  it('4 秒后自动消失', () => {
    render(<ToastHost />)
    act(() => {
      toast.show('temp message')
    })
    expect(screen.getByText('temp message')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4001)
    })
    expect(screen.queryByText('temp message')).not.toBeInTheDocument()
  })

  it('toast.error / toast.success 是 toast.show 的快捷方式', () => {
    render(<ToastHost />)
    act(() => {
      toast.error('boom')
    })
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('没消息时 ToastHost 渲染 null（DOM 干净）', () => {
    const { container } = render(<ToastHost />)
    expect(container.firstChild).toBeNull()
  })
})
