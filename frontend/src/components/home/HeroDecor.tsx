import { useI18n } from '../../i18n'

/**
 * Home 页右侧的三张错位浮动卡片（L0/L1/L2 装饰）。
 * 纯视觉，无业务逻辑。CSS 类（.float-card / .img-cherry / 等）在 index.css。
 */
export function HeroDecor() {
  const { t } = useI18n()
  return (
    <div className="home-decor" aria-hidden="true">
      <div className="float-card float-card-1 animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <div className="float-card-img img-cherry">
          <div
            style={{
              position: 'absolute',
              top: '32%',
              left: '30%',
              width: 14,
              height: 14,
              border: '1.5px solid white',
              borderRadius: '50%',
              background: 'white',
              zIndex: 1,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '60%',
              left: '64%',
              width: 14,
              height: 14,
              border: '1.5px solid white',
              borderRadius: '50%',
              background: '#D97B8A',
              zIndex: 1,
            }}
          />
        </div>
        <div className="float-card-meta">
          <span>{t('home.decor.l0')}</span>
          <span>3 hotspots</span>
        </div>
      </div>

      <div className="float-card float-card-2 animate-slide-up" style={{ animationDelay: '0.3s' }}>
        <div className="float-card-img img-blossom-detail" />
        <div className="float-card-meta">
          <span>{t('home.decor.l1')}</span>
          <span>AI</span>
        </div>
      </div>

      <div className="float-card float-card-3 animate-slide-up" style={{ animationDelay: '0.45s' }}>
        <div className="float-card-img img-stone-lantern" />
        <div className="float-card-meta">
          <span>{t('home.decor.l2')}</span>
          <span>generated</span>
        </div>
      </div>
    </div>
  )
}
