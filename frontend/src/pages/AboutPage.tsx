import { Link } from 'react-router-dom'
import { LanguageSwitcher } from '../components/shared/LanguageSwitcher'
import { Footer } from '../components/shared/Footer'
import { Icon } from '../components/shared/Icon'
import { useCopy } from '../i18n/workspace'

export function AboutPage() {
  const c = useCopy()
  return <div className="workspace-shell"><header className="settings-nav"><Link to="/"><Icon name="arrow-left" />{c('返回工作台', 'Back to workspace')}</Link><span>{c('关于 Flipbook Builder', 'About Flipbook Builder')}</span><LanguageSwitcher /></header>
    <main className="about-content" id="main-content"><h1>{c('把想法连成可以探索的作品。', 'Connect ideas into explorable stories.')}</h1>
      <p className="about-lead">{c('Flipbook Builder 是一个免账号、自托管的视觉知识创作工具。你可以从主题或图片开始，把说明与分支连接起来，再导出给读者。', 'Flipbook Builder is a self-hosted visual knowledge tool with no account required. Start from a topic or an image, connect explanations and branches, then export for your readers.')}</p>
      <section><h2>{c('先体验，再创作', 'Explore, then create')}</h2><p>{c('示例和手动知识页在浏览器内运行，无需模型配置。本地作品保存在此浏览器，清除浏览器数据会删除它们，请及时导出。', 'Examples and manual knowledge pages run in your browser without AI setup. Local projects live in this browser. Export them before clearing browser data.')}</p></section>
      <section><h2>{c('AI 是创作助手', 'AI assists your work')}</h2><p>{c('图片分析与生成使用你自己的模型服务。内容和热点需要检查与校正；生成结果不自动保证事实正确。当前生成需保持页面打开，失败后可重试。', 'Image analysis and generation use your own provider. Review the content and hotspot positions. Generated content can be inaccurate. Keep the page open during generation and retry after a failure.')}</p></section>
      <section><h2>{c('分享作品，保留控制', 'Share your work, keep control')}</h2><p>{c('离线 ZIP 包含只读播放器、内容和图片，不包含 API Key。实例链接需要你的服务保持在线。编辑实例没有用户隔离，适合个人或受信任环境自托管。', 'Offline ZIP files include a read-only player, content and images without API keys. Instance links require your service to stay online. The editing instance has no user isolation and is intended for personal or trusted environments.')}</p></section>
      <section><h2>{c('开放与自托管', 'Open and self-hosted')}</h2><p>{c('项目采用 MIT 许可，使用 React、FastAPI 和 Postgres。你可以部署自己的实例、修改代码并参与改进。', 'The project uses the MIT license and is built with React, FastAPI and Postgres. Host an instance, modify the code and contribute improvements.')}</p><a className="btn" href="https://github.com/yyb9807/flipbook-builder" target="_blank" rel="noreferrer">{c('查看 GitHub 项目', 'View on GitHub')}<Icon name="arrow-right" /></a></section>
    </main><Footer /></div>
}
