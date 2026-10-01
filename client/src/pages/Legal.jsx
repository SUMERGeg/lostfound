import { Link } from 'react-router-dom'
import { LEGAL_DOCUMENT_LIST } from '../legal/documents.js'
import { isPrivacyEmailConfigured, replacePrivacyEmail, usePrivacyEmail } from '../privacyConfig.js'

function PlaceholderNotice() {
  return (
    <aside className="lf-legal__notice" role="note">
      <strong>Черновик для согласования</strong>
      <p>Реквизиты в квадратных скобках должен заполнить владелец сервиса. Эта редакция не является заявлением о полном юридическом соответствии.</p>
    </aside>
  )
}

export default function LegalPage({ document }) {
  const privacyEmail = usePrivacyEmail()
  const showPublicVersion = document.path !== '/terms' && document.path !== '/personal-data-consent'
  return (
    <div className="lf-legal-layout">
      <aside className="lf-legal-nav" aria-label="Юридические документы">
        <p>Документы сервиса</p>
        {LEGAL_DOCUMENT_LIST.map(item => (
          <Link key={item.path} className={item.path === document.path ? 'is-active' : ''} to={item.path}>
            {item.shortTitle}
          </Link>
        ))}
      </aside>

      <article className="lf-legal">
        <header className="lf-legal__header">
          <span className="lf-legal__eyebrow">Lost&amp;Found · юридическая информация</span>
          <h1>{document.title}</h1>
          <p>{document.intro}</p>
          <dl className="lf-legal__meta">
            {showPublicVersion && <div><dt>Версия</dt><dd>{document.version}</dd></div>}
            <div><dt>Вступает в силу</dt><dd>{document.effectiveDate}</dd></div>
          </dl>
        </header>

        <PlaceholderNotice />

        <div className="lf-legal__body">
          {document.sections.map(section => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map(paragraph => <p key={paragraph}>{replacePrivacyEmail(paragraph, privacyEmail)}</p>)}
              {section.items && <ul>{section.items.map(item => <li key={item}>{replacePrivacyEmail(item, privacyEmail)}</li>)}</ul>}
            </section>
          ))}
        </div>

        <footer className="lf-legal__document-footer">
          <p>Вопросы по документу:{' '}{isPrivacyEmailConfigured(privacyEmail) ? <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a> : <strong>{privacyEmail}</strong>}</p>
          <div><Link to="/privacy-request">Запрос по персональным данным →</Link><Link to="/ads">Вернуться к объявлениям →</Link></div>
        </footer>
      </article>
    </div>
  )
}
