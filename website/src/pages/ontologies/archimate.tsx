import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';
import {Fragment} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {getOntology} from '../../data/ontologies';
import styles from '../ontologies.module.css';

function renderBold(text: string) {
  const parts = text.split('**');
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>));
}

export default function ArchiMateOntology(): JSX.Element {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  const t = (en: string, z: string) => (zh ? z : en);
  const L = (v: {en: string; zh: string}) => (zh ? v.zh : v.en);
  const o = getOntology('archimate');
  if (!o) {
    return (
      <Layout title={t('Ontology not found', '本体未找到')}>
        <main className="container margin-vert--lg">
          <p>{t('Ontology not found.', '本体未找到。')}</p>
          <Link to="/ontologies">← {t('Back to ontology shelf', '返回本体货架')}</Link>
        </main>
      </Layout>
    );
  }

  return (
    <Layout title={`${o.name} ${o.version}`} description={L(o.summary)}>
      <main className="container margin-vert--lg">
        <p className={styles.breadcrumb}>
          <Link to="/ontologies">{t('Ontology shelf', '本体货架')}</Link> / {o.name} {o.version}
        </p>
        <Heading as="h1">
          {o.name} {o.version && <span className={styles.version}>v{o.version}</span>}
        </Heading>
        <p className="lead">{L(o.summary)}</p>

        <section className="margin-top--lg">
          <Heading as="h2">{t('Introduction', '介绍')}</Heading>
          {L(o.description).split('\n').map((line, i) => (<p key={i}>{renderBold(line)}</p>))}
        </section>

        <section className="margin-top--lg">
          <Heading as="h2">{t('Docs & learning', '文档与学习')}</Heading>
          <div className="row">
            {o.docs.map((d) => (
              <div className="col col--4" key={d.href}>
                <div className={`card ${styles.card}`}>
                  <div className="card__body">
                    <h3>{L(d.label)}</h3>
                    {d.description && <p>{L(d.description)}</p>}
                    <Link className="button button--secondary button--sm" to={d.href}>{t('Open →', '进入 →')}</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {o.external && (
          <section className="margin-top--lg">
            <Heading as="h2">{t('Authoritative spec', '权威规范')}</Heading>
            <p><a href={o.external.href} target="_blank" rel="noopener noreferrer">{L(o.external.label)}</a></p>
          </section>
        )}

        <p className="margin-top--lg"><Link to="/ontologies">← {t('Back to ontology shelf', '返回本体货架')}</Link></p>
      </main>
    </Layout>
  );
}
