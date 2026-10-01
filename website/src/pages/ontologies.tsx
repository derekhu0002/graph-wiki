import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {ONTOLOGIES} from '../data/ontologies';
import styles from './ontologies.module.css';

export default function Ontologies(): JSX.Element {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  const t = (en: string, z: string) => (zh ? z : en);
  const L = (v: {en: string; zh: string}) => (zh ? v.zh : v.en);

  return (
    <Layout title={t('Ontology shelf', '本体货架')} description={t('Ontologies supported by ArchGraph: ArchiMate 3.2 and more', 'ArchGraph 支持的建模本体：ArchiMate 3.2 等')}>
      <main className="container margin-vert--lg">
        <Heading as="h1">{t('Ontology shelf', '本体货架')}</Heading>
        <p>
          {t(
            'A graph is defined by an ontology — the type system and rules of its elements/relationships. ArchiMate 3.2 is our base ontology, and the shelf is extensible. Click an ontology to see its detail.',
            'ArchGraph 的图谱由一个本体定义——即元素/关系的类型体系与校验规则。我们以 ArchiMate 3.2 为基础本体，并支持接入其它本体。下面按货架陈列，点击任一本体进入详细介绍。',
          )}
        </p>

        <div className="row margin-top--lg">
          {ONTOLOGIES.map((o) => (
            <div className="col col--6" key={o.id}>
              <div className={`card ${styles.card}`}>
                <div className="card__header">
                  <h3>
                    {o.name} {o.version && <span className={styles.version}>v{o.version}</span>}
                    {o.comingSoon && <span className={styles.badge}>{t('planned', '建设中')}</span>}
                  </h3>
                </div>
                <div className="card__body">
                  <p>{L(o.summary)}</p>
                  {o.comingSoon ? (
                    <p className={styles.meta}>{t('Coming soon.', '敬请期待。')}</p>
                  ) : (
                    <Link className="button button--primary button--sm" to={`/ontologies/${o.id}`}>
                      {t('View detail →', '查看本详情 →')}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </Layout>
  );
}
