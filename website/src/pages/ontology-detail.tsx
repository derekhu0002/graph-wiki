import {useEffect, useState} from 'react';
import {useLocation} from '@docusaurus/router';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';

import {ontologyGet, type OntologyAssetMeta} from '../lib/mcp';
import styles from './ontology-detail.module.css';

type SchemaDoc = {$defs?: Record<string, {enum?: unknown[]}>};
type ConfigDoc = {
  language?: string;
  elementTypeEnumKey?: string;
  relationshipTypeEnumKey?: string;
  actorElementType?: string | null;
  extends?: string;
  guide?: string;
  id?: string;
};

function getQueryId(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('id') || '';
}

function TypeChips({title, values}: {title: string; values: string[]}) {
  return (
    <section className={styles.section}>
      <Heading as="h3">{title}（{values.length}）</Heading>
      <div className={styles.chips}>
        {values.map((v) => (
          <code key={v} className={styles.chip}>{v}</code>
        ))}
      </div>
    </section>
  );
}

export default function OntologyDetail(): JSX.Element {
  const location = useLocation();
  const id = getQueryId();
  const [asset, setAsset] = useState<OntologyAssetMeta | null>(null);
  const [files, setFiles] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setError('缺少本体 id 参数');
      setLoading(false);
      return;
    }
    ontologyGet(id)
      .then((r) => { setAsset(r.asset); setFiles(r.files); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, location.search]);

  const schema = files['SystemArchitecture.schema.json'] as SchemaDoc | undefined;
  const config = (files['schema-bundle.config.json'] as ConfigDoc | undefined) || {};
  const elementKey = config.elementTypeEnumKey || 'archimateElementType';
  const relKey = config.relationshipTypeEnumKey || 'archimateRelationshipType';
  const elementTypes = ((schema?.$defs?.[elementKey]?.enum || []) as unknown[]).map(String);
  const relationshipTypes = ((schema?.$defs?.[relKey]?.enum || []) as unknown[]).map(String);
  const rules = files['schema-bundle.rules.json'] as {dialect?: string} | undefined;
  const guide = typeof files['GUIDE.md'] === 'string' ? (files['GUIDE.md'] as string) : undefined;

  return (
    <Layout
      title={asset ? asset.name : '本体详情'}
      description={asset?.description || 'ArchGraph 本体资产详情'}>
      <main className="container margin-vert--lg">
        <Link to="/ontologies">← 返回本体货架</Link>

        {loading && <p>加载中…</p>}
        {error && <p className={styles.error}>加载失败：{error}</p>}

        {asset && (
          <>
            <Heading as="h1">
              {asset.name} {asset.version && <span className={styles.version}>v{asset.version}</span>}
            </Heading>
            <p className={styles.metaLine}>
              <code>{asset.id}</code>
              {asset.sourceRepo && <> · 来源 {asset.sourceRepo}</>}
              {asset.sourceCommit && <> · commit <code>{asset.sourceCommit}</code></>}
            </p>
            {asset.description && <p>{asset.description}</p>}

            <section className={styles.section}>
              <Heading as="h2">本体概况</Heading>
              <table className={styles.table}>
                <tbody>
                  <tr><td>类型</td><td>{config.extends ? `extends ${config.extends}` : 'standalone'}</td></tr>
                  <tr><td>语言</td><td>{config.language || asset.bundle?.language || '—'}</td></tr>
                  <tr><td>Actor 元素类型</td><td><code>{config.actorElementType === null ? 'null（无 actor 概念）' : (config.actorElementType || '—')}</code></td></tr>
                  <tr><td>元素类型</td><td>{asset.bundle?.elementTypeCount ?? elementTypes.length}</td></tr>
                  <tr><td>关系类型</td><td>{asset.bundle?.relationshipTypeCount ?? relationshipTypes.length}</td></tr>
                  {rules?.dialect && <tr><td>规则方言</td><td><code>{rules.dialect}</code></td></tr>}
                </tbody>
              </table>
            </section>

            {elementTypes.length > 0 && <TypeChips title="元素类型" values={elementTypes} />}
            {relationshipTypes.length > 0 && <TypeChips title="关系类型" values={relationshipTypes} />}

            {guide && (
              <section className={styles.section}>
                <Heading as="h2">Guide</Heading>
                <pre className={styles.guide}>{guide}</pre>
              </section>
            )}
          </>
        )}

        <p className="margin-top--lg"><Link to="/ontologies">← 返回本体货架</Link></p>
      </main>
    </Layout>
  );
}
