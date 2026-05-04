import { useProjectStore } from '../store/projectStore'
import { Topbar } from '../components/shared/Topbar'
import { ApiKeyWarning } from '../components/shared/ApiKeyWarning'
import { LoadingSpinner } from '../components/shared/LoadingSpinner'
import { useToast } from '../components/shared/Toast'
import { UploadZone } from '../components/home/UploadZone'
import { ProjectList } from '../components/home/ProjectList'
import { useBuilderActions } from '../hooks/useBuilderActions'
import { useI18n } from '../i18n'

/**
 * 首页 / Dashboard：无项目状态。
 * 顶栏 + ApiKey 警告 + 创作卡片 + 浮动装饰 + 历史项目网格。
 */
export function HomePage() {
  const analyzing = useProjectStore((s) => s.analyzing)
  const genProgress = useProjectStore((s) => s.genProgress)
  const { show: showToast, ToastEl } = useToast()
  const { handleUpload, cancelInflight } = useBuilderActions(showToast)
  const { t } = useI18n()

  return (
    <div
      className="animate-page-in"
      style={{
        width: '100%',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <div>
        <Topbar />
        <ApiKeyWarning />
      </div>

      {analyzing ? (
        <LoadingSpinner
          overlay
          steps={[t('home.steps.0'), t('home.steps.1'), t('home.steps.2'), t('home.steps.3')]}
          currentStep={genProgress?.step ?? 0}
          currentPct={genProgress?.pct ?? 5}
          onCancel={cancelInflight}
        />
      ) : (
        <UploadZone
          onFile={(f, kw) => handleUpload(f, undefined, kw)}
          onText={(t) => handleUpload(undefined, t)}
          loading={analyzing}
          projectList={<ProjectList />}
        />
      )}

      {ToastEl}
    </div>
  )
}
