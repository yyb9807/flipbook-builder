import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { ImageUploadField } from './ImageUploadField'

/** 测试用 wrapper：把组件挂到本地 state 模拟父组件的受控用法。 */
function Harness({ initialFile = null as File | null }: { initialFile?: File | null }) {
  const [file, setFile] = useState<File | null>(initialFile)
  const [keywords, setKeywords] = useState('')
  return (
    <ImageUploadField
      file={file}
      onFile={setFile}
      keywords={keywords}
      onKeywords={setKeywords}
    />
  )
}

/** 创建一个伪造的 File，可控类型/大小（不需要真二进制）。 */
function makeFile(name: string, type: string, sizeMB = 1): File {
  const f = new File([new Blob([new Uint8Array(1)])], name, { type })
  Object.defineProperty(f, 'size', { value: sizeMB * 1024 * 1024 })
  return f
}

describe('ImageUploadField', () => {
  afterEach(cleanup)

  describe('校验', () => {
    it('接受 image/jpeg', () => {
      const { container } = render(<Harness />)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = makeFile('a.jpg', 'image/jpeg', 1)
      fireEvent.change(input, { target: { files: [file] } })
      // 通过校验后会显示文件名
      expect(screen.getByText('a.jpg')).toBeInTheDocument()
    })

    it('接受 image/png', () => {
      const { container } = render(<Harness />)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [makeFile('a.png', 'image/png', 1)] } })
      expect(screen.getByText('a.png')).toBeInTheDocument()
    })

    it('接受 image/webp', () => {
      const { container } = render(<Harness />)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [makeFile('a.webp', 'image/webp', 1)] } })
      expect(screen.getByText('a.webp')).toBeInTheDocument()
    })

    it('拒绝非图片类型', () => {
      const { container } = render(<Harness />)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [makeFile('x.txt', 'text/plain', 1)] } })
      expect(screen.getByRole('alert')).toHaveTextContent(/请上传图片|不支持/)
      expect(screen.queryByText('x.txt')).not.toBeInTheDocument()
    })

    it('拒绝 image/gif（不在白名单）', () => {
      const { container } = render(<Harness />)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [makeFile('x.gif', 'image/gif', 1)] } })
      expect(screen.getByText(/仅支持 JPG/)).toBeInTheDocument()
    })

    it('拒绝 > 20MB 文件', () => {
      const { container } = render(<Harness />)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [makeFile('big.png', 'image/png', 25)] } })
      expect(screen.getByText(/超过 20 MB 上限/)).toBeInTheDocument()
    })

    it('校验失败后再上传合法文件，错误消失', () => {
      const { container } = render(<Harness />)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [makeFile('big.png', 'image/png', 25)] } })
      expect(screen.getByText(/超过 20 MB/)).toBeInTheDocument()
      // 上传一个合法的
      fireEvent.change(input, { target: { files: [makeFile('ok.png', 'image/png', 1)] } })
      expect(screen.queryByText(/超过 20 MB/)).not.toBeInTheDocument()
      expect(screen.getByText('ok.png')).toBeInTheDocument()
    })
  })

  describe('UI 状态', () => {
    it('未选文件时显示拖拽提示', () => {
      render(<Harness />)
      expect(screen.getByText(/拖入图片或点击上传/)).toBeInTheDocument()
      expect(screen.getByText(/JPG, PNG, WEBP — 最大 20MB/)).toBeInTheDocument()
    })

    it('已选文件后显示文件名 + 大小 + 更换按钮', () => {
      const file = makeFile('test.png', 'image/png', 2)
      render(<Harness initialFile={file} />)
      expect(screen.getByText('test.png')).toBeInTheDocument()
      expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument()
      expect(screen.getByText('更换')).toBeInTheDocument()
    })

    it('点击「更换」清空文件', () => {
      const onFile = vi.fn()
      // 需要外部 onFile，这里用 stub harness
      render(
        <ImageUploadField
          file={makeFile('a.png', 'image/png', 1)}
          onFile={onFile}
          keywords=""
          onKeywords={() => {}}
        />,
      )
      fireEvent.click(screen.getByText('更换'))
      expect(onFile).toHaveBeenCalledWith(null)
    })
  })

  describe('关键词输入', () => {
    it('总是显示关键词输入框', () => {
      render(<Harness />)
      expect(screen.getByPlaceholderText(/关键词（可选）/)).toBeInTheDocument()
    })

    it('输入触发 onKeywords 回调', () => {
      const onKeywords = vi.fn()
      render(
        <ImageUploadField
          file={null}
          onFile={() => {}}
          keywords=""
          onKeywords={onKeywords}
        />,
      )
      const input = screen.getByPlaceholderText(/关键词（可选）/)
      fireEvent.change(input, { target: { value: '建筑, 历史' } })
      expect(onKeywords).toHaveBeenCalledWith('建筑, 历史')
    })
  })

  describe('accessible upload lifecycle', () => {
    it('exposes a focusable native image chooser and a named keyword field', async () => {
      const user = userEvent.setup()
      render(<Harness />)
      await user.tab()
      const chooser = screen.getByLabelText('选择图片')
      expect(chooser).toHaveFocus()
      expect(chooser).toHaveAttribute('type', 'file')
      expect(chooser).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
      expect(screen.getByRole('textbox', { name: '关键词（可选）' })).toBeInTheDocument()
    })

    it('accepts a dropped image and refuses it while creation is disabled', () => {
      const onFile = vi.fn()
      const file = makeFile('drop.png', 'image/png', 1)
      const { rerender } = render(<ImageUploadField file={null} onFile={onFile} keywords="" onKeywords={() => {}} />)
      fireEvent.drop(screen.getByRole('group', { name: '图片上传' }), { dataTransfer: { files: [file] } })
      expect(onFile).toHaveBeenCalledWith(file)
      onFile.mockClear()
      rerender(<ImageUploadField file={null} onFile={onFile} keywords="" onKeywords={() => {}} disabled />)
      fireEvent.drop(screen.getByRole('group', { name: '图片上传' }), { dataTransfer: { files: [file] } })
      expect(onFile).not.toHaveBeenCalled()
      expect(screen.getByLabelText('选择图片')).toBeDisabled()
    })

    it('reuses a preview while keywords change and releases its object URL when removed', () => {
      const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const file = makeFile('preview.png', 'image/png', 1)
      const { rerender, unmount } = render(<ImageUploadField file={file} onFile={() => {}} keywords="" onKeywords={() => {}} />)
      expect(create).toHaveBeenCalledTimes(1)
      rerender(<ImageUploadField file={file} onFile={() => {}} keywords="water" onKeywords={() => {}} />)
      expect(create).toHaveBeenCalledTimes(1)
      unmount()
      expect(revoke).toHaveBeenCalledWith('blob:preview')
      create.mockRestore()
      revoke.mockRestore()
    })
  })
})
