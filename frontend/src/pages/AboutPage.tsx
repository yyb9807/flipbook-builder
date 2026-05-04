import { Link } from 'react-router-dom'
import { Icon } from '../components/shared/Icon'
import { LanguageSwitcher } from '../components/shared/LanguageSwitcher'
import { Footer } from '../components/shared/Footer'
import { useI18n } from '../i18n'

/**
 * 「关于」页：项目缘起、流水线、技术栈、致谢、联系。
 * 风格上与 SettingsPage 一致：sticky nav + 卡片式分区 + i18n 中英切换。
 */
export function AboutPage() {
  const { t } = useI18n()

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        background: 'var(--bg)',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Nav />

      <div
        style={{
          flex: 1,
          maxWidth: 720,
          width: '100%',
          margin: '0 auto',
          padding: '32px 24px 0',
        }}
      >
        {/* Hero */}
        <header style={{ marginBottom: 28 }}>
          <h1
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              margin: '0 0 10px',
              lineHeight: 1.05,
            }}
          >
            flipbook
            <em style={{ fontStyle: 'normal', color: 'var(--blue)' }}>-builder</em>
          </h1>
          <p
            style={{
              fontSize: 17,
              color: 'var(--label-secondary)',
              margin: 0,
              lineHeight: 1.5,
              maxWidth: 580,
            }}
          >
            {t('about.lead')}
          </p>
        </header>

        <Section title={t('about.whyTitle')} body={t('about.whyBody')} />
        <Section title={t('about.howTitle')} body={t('about.howBody')} />

        {/* 多 Agent 编排 */}
        <AgentsSection />

        {/* 技术栈卡片 */}
        <section
          style={{
            background: 'var(--bg-elev)',
            borderRadius: 14,
            padding: '18px 20px',
            marginBottom: 14,
            boxShadow: 'var(--shadow-card)',
            borderLeft: '3px solid var(--blue)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 12px' }}>
            {t('about.stackTitle')}
          </h2>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gap: 8,
              fontSize: 13.5,
              color: 'var(--label-secondary)',
              lineHeight: 1.5,
            }}
          >
            <li>
              <StackTag>Frontend</StackTag> {t('about.stackFrontend')}
            </li>
            <li>
              <StackTag>Backend</StackTag> {t('about.stackBackend')}
            </li>
            <li>
              <StackTag>AI</StackTag> {t('about.stackAi')}
            </li>
            <li>
              <StackTag>Deploy</StackTag> {t('about.stackDeploy')}
            </li>
          </ul>
        </section>

        <Section title={t('about.creditsTitle')} body={t('about.creditsBody')} />

        {/* 联系 */}
        <section
          style={{
            background: 'var(--bg-elev)',
            borderRadius: 14,
            padding: '18px 20px',
            marginBottom: 14,
            boxShadow: 'var(--shadow-card)',
            borderLeft: '3px solid var(--pink)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
            {t('about.contactTitle')}
          </h2>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--label-secondary)',
              lineHeight: 1.55,
              margin: '0 0 10px',
            }}
          >
            {t('about.contactBody')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <a
              href="mailto:yyb980716@gmail.com"
              style={linkPill}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-5)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--gray-6)')}
            >
              📧 yyb980716@gmail.com
            </a>
            <a
              href="https://github.com/yyb9807"
              target="_blank"
              rel="noopener noreferrer"
              style={linkPill}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-5)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--gray-6)')}
            >
              🐙 github.com/yyb9807
            </a>
          </div>
        </section>

        <Footer />
      </div>
    </div>
  )
}

function Nav() {
  const { t } = useI18n()
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.78)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: '0.5px solid var(--separator)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <Link
        to="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 14,
          color: 'var(--blue)',
          textDecoration: 'none',
          fontWeight: 400,
        }}
      >
        <Icon name="arrow-left" size={14} />
        {t('common.back')}
      </Link>
      <span style={{ color: 'var(--label-tertiary)', fontSize: 13 }}>·</span>
      <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>
        {t('about.navTitle')}
      </span>
      <div style={{ flex: 1 }} />
      <LanguageSwitcher />
    </div>
  )
}

/** 多 Agent 流水线可视化：5 个步骤 + 箭头 + 节省说明。 */
function AgentsSection() {
  const { t } = useI18n()
  const agents: { key: 'inputAnalysis' | 'composition' | 'pageGeneration' | 'imageGeneration' | 'hotspotLocalization'; emoji: string; tone: string }[] = [
    { key: 'inputAnalysis', emoji: '👁', tone: 'var(--blue)' },
    { key: 'composition', emoji: '🗺', tone: 'var(--purple, #AF52DE)' },
    { key: 'pageGeneration', emoji: '✍️', tone: 'var(--green)' },
    { key: 'imageGeneration', emoji: '🎨', tone: 'var(--pink)' },
    { key: 'hotspotLocalization', emoji: '📍', tone: 'var(--orange)' },
  ]

  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        borderRadius: 14,
        padding: '18px 20px',
        marginBottom: 14,
        boxShadow: 'var(--shadow-card)',
        borderLeft: '3px solid var(--purple, #AF52DE)',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
        {t('about.agentsTitle')}
      </h2>
      <p
        style={{
          fontSize: 13.5,
          color: 'var(--label-secondary)',
          lineHeight: 1.6,
          margin: '0 0 16px',
        }}
      >
        {t('about.agentsIntro')}
      </p>

      {/* 流水线步骤 */}
      <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {agents.map((a, i) => (
          <li key={a.key}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '8px 0',
              }}
            >
              {/* 序号 + emoji */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'var(--gray-6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                  border: `1.5px solid ${a.tone}`,
                  position: 'relative',
                }}
              >
                {a.emoji}
                <span
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: -6,
                    width: 18,
                    height: 18,
                    background: a.tone,
                    color: 'white',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {i + 1}
                </span>
              </div>

              {/* 标题 + 描述 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--label)', marginBottom: 2 }}>
                  {t(`about.agent.${a.key}` as 'about.agent.inputAnalysis')}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--label-secondary)',
                    fontFamily: 'var(--mono)',
                    lineHeight: 1.5,
                  }}
                >
                  {t(`about.agent.${a.key}.desc` as 'about.agent.inputAnalysis.desc')}
                </div>
              </div>
            </div>

            {/* 箭头连接线 */}
            {i < agents.length - 1 && (
              <div
                aria-hidden="true"
                style={{
                  marginLeft: 17,
                  width: 2,
                  height: 12,
                  background: 'var(--separator)',
                }}
              />
            )}
          </li>
        ))}
      </ol>

      {/* 缓存节省说明 */}
      <div
        style={{
          background: 'rgba(52,199,89,0.08)',
          border: '0.5px solid rgba(52,199,89,0.2)',
          borderRadius: 10,
          padding: '10px 12px',
          fontSize: 12.5,
          color: 'var(--label)',
          lineHeight: 1.55,
        }}
      >
        💰 {t('about.agent.savings')}
      </div>
    </section>
  )
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        borderRadius: 14,
        padding: '18px 20px',
        marginBottom: 14,
        boxShadow: 'var(--shadow-card)',
        borderLeft: '3px solid var(--gray-4)',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
        {title}
      </h2>
      <p
        style={{
          fontSize: 13.5,
          color: 'var(--label-secondary)',
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {body}
      </p>
    </section>
  )
}

function StackTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: 'var(--gray-6)',
        color: 'var(--label)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 6,
        marginRight: 8,
        fontWeight: 600,
        minWidth: 64,
        textAlign: 'center',
      }}
    >
      {children}
    </span>
  )
}

const linkPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'var(--gray-6)',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--label)',
  textDecoration: 'none',
  fontFamily: 'var(--sans)',
  transition: 'background 0.15s',
}
