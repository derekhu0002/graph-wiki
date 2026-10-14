import {useEffect, useState} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {ontologyList, type OntologyAssetMeta} from '../lib/mcp';
import styles from './ontologies.module.css';

export default function Ontologies(): JSX.Element {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  const t = (en: string, z: string) => (zh ? z : en);
  const [ontologies, setOntologies] = useState<OntologyAssetMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ontologyList()
      .then(setOntologies)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const actor = (b?: OntologyAssetMeta['bundle']) =>
    b && b.actorElementType !== undefined ? String(b.actorElementType) : '—';

  return (
    <Layout
      title={t('Ontology shelf', '本体货架')}
      description={t('Ontologies registered on the graph MCP', '登记在图谱 MCP 上的本体（货架实时同步）')}>
      <main className="container margin-vert--lg">
        <Heading as="h1">{t('Ontology shelf', '本体货架')}</Heading>
        <p>
          {t(
            'A graph is defined by an ontology — the type system and rules of its elements/relationships. The shelf is live from the graph MCP: a project submits an ontology with ontology_submit, then it appears here. Click an ontology to see its detail.',
            'ArchGraph 的图谱由一个本体定义——即元素/关系的类型体系与校验规则。货架实时取自图谱 MCP：项目用 ontology_submit 提交本体后，这里即可见。点击任一本体进入详细介绍。',
          )}
        </p>

        {loading && <p>{t('Loading…', '加载中…')}</p>}
        {error && <p className={styles.error}>{t('Load failed: ', '加载失败：')}{error}</p>}

        {ontologies && (
          <div className="row margin-top--lg">
            {ontologies.length === 0 && <p>{t('No ontologies yet.', '暂无本体。')}</p>}
            {ontologies.map((o) => (
              <div className="col col--6" key={o.id}>
                <div className={clsx('card', styles.card)}>
                  <div className="card__header">
                    <h3>
                      {o.name} {o.version && <span className={styles.version}>v{o.version}</span>}
                      {o.bundle?.extends && <span className={styles.badge}>extends {o.bundle.extends}</span>}
                      {o.placeholder && <span className={styles.badge}>{t('referenced · not uploaded', '占位 · 未上传')}</span>}
                    </h3>
                    <code>{o.id}</code>
                  </div>
                  <div className="card__body">
                    <p>{o.description}</p>
                    {o.bundle && (
                      <p className={styles.meta}>
                        {o.bundle.elementTypeCount ?? '—'} {t('element types', '元素类型')} ·{' '}
                        {o.bundle.relationshipTypeCount ?? '—'} {t('relationship types', '关系类型')} · actor{' '}
                        {actor(o.bundle)}
                        {o.bundle.language ? ` · ${o.bundle.language}` : ''}
                      </p>
                    )}
                    {typeof o.projectCount === 'number' && o.projectCount > 0 && (
                      <p className={styles.meta}>
                        {o.projectCount} {t('projects based on it', '个项目基于它')}
                      </p>
                    )}
                  </div>
                  <div className="card__footer">
                    <Link className="button button--primary button--sm" to={`/ontology-detail?id=${encodeURIComponent(o.id)}`}>
                      {t('View detail →', '查看本详情 →')}
                    </Link>
                  </div>
                </div>
              </div>
            ))}

            <div className="col col--6">
              <div className={clsx('card', styles.card)}>
                <div className="card__header">
                  <h3>
                    {t('More ontologies', '更多本体')}
                    <span className={styles.badge}>{t('open shelf', '开放货架')}</span>
                  </h3>
                </div>
                <div className="card__body">
                  <p>
                    {t(
                      'The shelf is open. Submit a schema bundle (SystemArchitecture.schema.json + schema-bundle.config.json) with ',
                      '货架是开放的。用 ',
                    )}
                    <code>ontology_submit</code>
                    {t(' on the graph MCP, then refresh this page to see it live.', '（图谱 MCP）提交 schema bundle（SystemArchitecture.schema.json + schema-bundle.config.json），刷新本页即可见。')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
}
