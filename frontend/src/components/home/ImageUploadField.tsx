import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20 MB
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp']

interface ValidationError {
  key: TranslationKey
  vars?: Record<string, string | number>
}

/** 校验上传文件，返回错误结构（null 表示通过）。i18n key + vars 由调用方用 t 格式化。 */
function validateImage(file: File): ValidationError | null {
  if (!file.type.startsWith('image/')) {
    return { key: 'home.image.errUnsupportedType', vars: { type: file.type || '__unknownType__' } }
  }
  if (!ACCEPTED_MIME.includes(file.type)) {
    return { key: 'home.image.errFormat', vars: { type: file.type } }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { key: 'home.image.errSize', vars: { mb: (file.size / 1024 / 1024).toFixed(1) } }
  }
  return null
}

interface Props {
  file: File | null
  onFile: (f: File | null) => void
  keywords: string
  onKeywords: (v: string) => void
}

/** 图片上传 + 关键词输入字段。封装 drag-drop / 文件校验 / 关键词输入。 */
export function ImageUploadField({ file, onFile, keywords, onKeywords }: Props) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<ValidationError | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function pick(f: File) {
    const err = validateImage(f)
    if (err) {
      setError(err)
      onFile(null)
      return
    }
    setError(null)
    onFile(f)
  }

  // 把 sentinel "__unknownType__" 替换为已翻译的"未知类型"
  function formatError(e: ValidationError): string {
    const vars = { ...e.vars }
    if (vars.type === '__unknownType__') vars.type = t('home.image.errUnknownType')
    return t(e.key, vars)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) pick(f)
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        style={{
          width: '100%',
          background: file ? 'var(--green-soft)' : dragging ? 'rgba(0,122,255,0.06)' : 'var(--gray-6)',
          borderRadius: 12,
          padding: file ? '14px' : '36px 22px',
          textAlign: file ? 'left' : 'center',
          cursor: file ? 'default' : 'pointer',
          transition: 'background 0.15s',
          border: dragging ? '1.5px dashed var(--blue)' : '1.5px dashed transparent',
          boxSizing: 'border-box',
        }}
      >
        {file ? <FilePreview file={file} onClear={() => onFile(null)} /> : <EmptyHint />}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
        />
      </div>

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(255,59,48,0.08)',
            borderRadius: 8,
            color: 'var(--red, #FF3B30)',
            fontSize: 12.5,
            lineHeight: 1.4,
          }}
        >
          ⚠ {formatError(error)}
        </div>
      )}

      <input
        type="text"
        value={keywords}
        onChange={(e) => onKeywords(e.target.value)}
        placeholder={t('home.image.keywordsPlaceholder')}
        style={{
          width: '100%',
          marginTop: 12,
          padding: '11px 14px',
          background: 'var(--gray-6)',
          border: 'none',
          borderRadius: 10,
          fontSize: 13.5,
          color: 'var(--label)',
          outline: 'none',
          fontFamily: 'var(--sans)',
          transition: 'background 0.15s, box-shadow 0.15s',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => {
          e.target.style.background = 'white'
          e.target.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.25)'
        }}
        onBlur={(e) => {
          e.target.style.background = 'var(--gray-6)'
          e.target.style.boxShadow = 'none'
        }}
      />
    </>
  )
}

function FilePreview({ file, onClear }: { file: File; onClear: () => void }) {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 48, height: 48, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--gray-4)' }}>
          <img src={URL.createObjectURL(file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
            {(file.size / 1024 / 1024).toFixed(1)} MB
          </div>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClear()
        }}
        style={{
          padding: '5px 10px',
          background: 'var(--gray-6)',
          border: 'none',
          borderRadius: 999,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'var(--sans)',
          color: 'var(--label)',
          flexShrink: 0,
        }}
      >
        {t('home.image.replace')}
      </button>
    </div>
  )
}

function EmptyHint() {
  const { t } = useI18n()
  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="var(--gray)" strokeWidth="1.5" style={{ display: 'inline-block' }}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <path d="M17 8l-5-5-5 5M12 3v12" />
        </svg>
      </div>
      <div style={{ fontWeight: 500, fontSize: 14.5 }}>{t('home.image.dropHint')}</div>
      <div style={{ fontSize: 12, color: 'var(--label-tertiary)', marginTop: 3 }}>
        {t('home.image.dropMeta')}
      </div>
    </>
  )
}
