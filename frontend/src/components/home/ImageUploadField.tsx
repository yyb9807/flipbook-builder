import { useEffect, useId, useState } from 'react'
import type { DragEvent } from 'react'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { useCopy } from '../../i18n/workspace'
import { Icon } from '../shared/Icon'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp']

interface ValidationError {
  key: TranslationKey
  vars?: Record<string, string | number>
}

function validateImage(file: File): ValidationError | null {
  if (!file.type.startsWith('image/')) return { key: 'home.image.errUnsupportedType', vars: { type: file.type || '__unknownType__' } }
  if (!ACCEPTED_MIME.includes(file.type)) return { key: 'home.image.errFormat', vars: { type: file.type } }
  if (file.size > MAX_IMAGE_BYTES) return { key: 'home.image.errSize', vars: { mb: (file.size / 1024 / 1024).toFixed(1) } }
  return null
}

interface Props {
  file: File | null
  onFile: (file: File | null) => void
  keywords: string
  onKeywords: (value: string) => void
  disabled?: boolean
}

export function ImageUploadField({ file, onFile, keywords, onKeywords, disabled = false }: Props) {
  const { t } = useI18n()
  const c = useCopy()
  const id = useId()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<ValidationError | null>(null)
  function pick(next: File) {
    if (disabled) return
    const invalid = validateImage(next)
    setError(invalid)
    onFile(invalid ? null : next)
  }
  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const next = event.dataTransfer.files[0]
    if (next) pick(next)
  }
  const errorVars = { ...error?.vars }
  if (errorVars.type === '__unknownType__') errorVars.type = t('home.image.errUnknownType')
  return <>
    <div className={`image-upload${dragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`} role="group" aria-label={c('图片上传', 'Image upload')}
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <input id={id} className="visually-hidden" type="file" disabled={disabled} accept={ACCEPTED_MIME.join(',')} aria-label={c('选择图片', 'Choose an image')} aria-describedby={`${id}-hint`} aria-invalid={Boolean(error) || undefined}
        onChange={(event) => { const next = event.target.files?.[0]; if (next) pick(next); event.currentTarget.value = '' }} />
      {file ? <FilePreview file={file} disabled={disabled} onClear={() => { onFile(null); setError(null); document.getElementById(id)?.focus() }} /> : <label className="image-upload-pick" htmlFor={id}>
        <Icon name="image" size={26} /><strong>{t('home.image.dropHint')}</strong><span id={`${id}-hint`}>{t('home.image.dropMeta')}</span>
      </label>}
      {file && <span id={`${id}-hint`} className="visually-hidden">{t('home.image.dropMeta')}</span>}
    </div>
    {error && <p className="image-upload-error" role="alert"><Icon name="warning" size={16} />{t(error.key, errorVars)}</p>}
    <label className="field image-keywords">{c('关键词（可选）', 'Keywords (optional)')}<input type="text" disabled={disabled} value={keywords} onChange={(event) => onKeywords(event.target.value)} placeholder={t('home.image.keywordsPlaceholder')} /></label>
    <p className="field-hint image-upload-note">{c('手动标注的图片请小于 2 MB；AI 上传支持最大 20 MB。', 'Use an image under 2 MB for manual annotation. AI uploads support up to 20 MB.')}</p>
  </>
}

function FilePreview({ file, onClear, disabled }: { file: File; onClear: () => void; disabled: boolean }) {
  const { t } = useI18n()
  const [preview, setPreview] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return <div className="image-file-preview"><div className="image-file-summary">
    <div className="image-file-thumbnail">{preview && <img src={preview} alt="" />}</div>
    <div className="image-file-copy"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
  </div><button type="button" className="btn btn-sm" disabled={disabled} onClick={onClear}>{t('home.image.replace')}</button></div>
}
