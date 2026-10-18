import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmHost, confirm } from './ConfirmDialog'

describe('Confirm singleton', () => {
  afterEach(cleanup)

  it('confirm() 返回 Promise，点确认 resolves true', async () => {
    render(<ConfirmHost />)
    const promise = confirm({ title: '删除？', confirmText: '删除' })
    const btn = await screen.findByText('删除')
    fireEvent.click(btn)
    await expect(promise).resolves.toBe(true)
  })

  it('点取消 resolves false', async () => {
    render(<ConfirmHost />)
    const promise = confirm({ title: '删除？' })
    const btn = await screen.findByText('取消')
    fireEvent.click(btn)
    await expect(promise).resolves.toBe(false)
  })

  it('ESC 键取消（resolves false）', async () => {
    render(<ConfirmHost />)
    const promise = confirm({ title: '删除？' })
    await screen.findByText('删除？')
    fireEvent.keyDown(window, { key: 'Escape' })
    await expect(promise).resolves.toBe(false)
  })

  it('初始聚焦取消，Enter 激活取消而非删除', async () => {
    const user = userEvent.setup()
    render(<ConfirmHost />)
    const promise = confirm({ title: '删除？', tone: 'danger' })
    expect(await screen.findByText('取消')).toHaveFocus()
    await user.keyboard('{Enter}')
    await expect(promise).resolves.toBe(false)
  })

  it('Tab 焦点保持在弹窗内，确认按钮获得焦点后 Enter 才确认', async () => {
    const user = userEvent.setup()
    render(<><button>外部</button><ConfirmHost /></>)
    const promise = confirm({ title: '删除？', confirmText: '删除' })
    expect(await screen.findByText('取消')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByText('删除')).toHaveFocus()
    await user.tab()
    expect(screen.getByText('取消')).toHaveFocus()
    await user.tab()
    await user.keyboard('{Enter}')
    await expect(promise).resolves.toBe(true)
  })

  it('关闭后恢复触发控件焦点', async () => {
    const user = userEvent.setup()
    render(<><button>触发</button><ConfirmHost /></>)
    const trigger = screen.getByText('触发')
    trigger.focus()
    const promise = confirm({ title: '删除？' })
    await screen.findByText('取消')
    await user.keyboard('{Escape}')
    await expect(promise).resolves.toBe(false)
    expect(trigger).toHaveFocus()
  })

  it('点击背景关闭 (cancel)', async () => {
    render(<ConfirmHost />)
    const promise = confirm({ title: '删除？' })
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(dialog) // 点击 backdrop
    await expect(promise).resolves.toBe(false)
  })

  it('展示自定义文案', async () => {
    render(<ConfirmHost />)
    confirm({
      title: '永久删除',
      message: '此操作不可撤销',
      confirmText: '确认删除',
      cancelText: '保留',
      tone: 'danger',
    })
    expect(await screen.findByText('永久删除')).toBeInTheDocument()
    expect(screen.getByText('此操作不可撤销')).toBeInTheDocument()
    expect(screen.getByText('确认删除')).toBeInTheDocument()
    expect(screen.getByText('保留')).toBeInTheDocument()
  })

  it('关闭后再次 confirm() 能正常工作', async () => {
    render(<ConfirmHost />)
    const p1 = confirm({ title: 'first' })
    fireEvent.click(await screen.findByText('确定'))
    await expect(p1).resolves.toBe(true)
    await waitFor(() => {
      expect(screen.queryByText('first')).not.toBeInTheDocument()
    })

    const p2 = confirm({ title: 'second' })
    expect(await screen.findByText('second')).toBeInTheDocument()
    fireEvent.click(screen.getByText('取消'))
    await expect(p2).resolves.toBe(false)
  })
})
