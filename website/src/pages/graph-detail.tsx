import {useEffect, useState} from 'react';
import {useLocation} from '@docusaurus/router';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';

import '@xyflow/react/dist/style.css';
import GraphVisualizer from '../components/GraphVisualizer';
import {graphGet, type ArchGraph, type GraphAssetMeta, type GraphElement, type GraphRelationship, type GraphView} from '../lib/mcp';
import styles from './graph-detail.module.css';

function getQueryId(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('id') || '';
}

// 计算某视图实际展示的元素与关系（图内成员，回退到全部）
function resolveViewMembers(view: GraphView | undefined, graph: ArchGraph) {
  const elements: GraphElement[] = [];
  const relationships: GraphRelationship[] = [];

  if (view && view.included_elements && view.included_elements.length > 0) {
    for (const id of view.included_elements) {
      const el = graph.elements.find((e) => e.id === id);
      if (el) elements.push(el);
    }
  } else {
    elements.push(...graph.elements);
  }

  if (view && view.included_relationships && view.included_relationships.length > 0) {
    for (const id of view.included_relationships) {
      const r = graph.relationships.find((rel) => rel.id === id);
      if (r) relationships.push(r);
    }
  } else {
    relationships.push(...graph.relationships);
  }
  return {elements, relationships};
}

function ElementTable({elements}: {elements: GraphElement[]}) {
  return (
    <table className={styles.detailTable}>
      <thead>
        <tr><th>#</th><th>名称</th><th>类型</th><th>ID</th><th>描述</th></tr>
      </thead>
      <tbody>
        {elements.map((e, i) => (
          <tr key={e.id}>
            <td>{i + 1}</td>
            <td><strong>{e.name}</strong></td>
            <td><code>{e.type}</code></td>
            <td><code>{e.id}</code></td>
            <td className={styles.desc}>{e.description || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RelationshipTable({relationships, elements}: {relationships: GraphRelationship[]; elements: GraphElement[]}) {
  const nameOf = (id: string) => elements.find((e) => e.id === id)?.name || id;
  return (
    <table className={styles.detailTable}>
      <thead>
        <tr><th>#</th><th>关系</th><th>类型</th><th>来源</th><th>目标</th><th>说明</th></tr>
      </thead>
      <tbody>
        {relationships.map((r, i) => (
          <tr key={r.id}>
            <td>{i + 1}</td>
            <td><strong>{r.name || r.type}</strong></td>
            <td><code>{r.type}</code></td>
            <td>{r.source_name || nameOf(r.source_id)}</td>
            <td>{r.target_name || nameOf(r.target_id)}</td>
            <td className={styles.desc}>{r.statement || r.description || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function GraphDetail(): JSX.Element {
  const location = useLocation();
  const id = getQueryId();
  const [asset, setAsset] = useState<GraphAssetMeta | null>(null);
  const [graph, setGraph] = useState<ArchGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setError('缺少图谱 id 参数');
      setLoading(false);
      return;
    }
    graphGet(id)
      .then((r) => { setAsset(r.asset); setGraph(r.graph); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, location.search]);

  return (
    <Layout
      title={asset ? asset.name : '图谱详情'}
      description={asset?.description || 'ArchGraph 社区图谱详情'}>
      <main className="container margin-vert--lg">
        <Link to="/graphs">← 返回子图库</Link>

        {loading && <p>加载中…</p>}
        {error && <p className={styles.error}>加载失败：{error}</p>}

        {asset && graph && (
          <>
            <Heading as="h1">{asset.name}</Heading>
            <p className={styles.metaLine}>
              <code>{asset.id}</code> · v{asset.version} · 来源 {asset.sourceRepo} · commit {asset.sourceCommit}
            </p>
            <p>{asset.description}</p>
            <p className={styles.statsLine}>
              共 {graph.elements.length} 元素 · {graph.relationships.length} 关系 · {graph.views.length} 视图
            </p>

            {graph.views.map((view) => {
              const {elements, relationships} = resolveViewMembers(view, graph);
              return (
                <section key={view.view_id} className={styles.viewSection}>
                  <Heading as="h2">
                    视图：{view.view_name}
                    <span className={styles.viewMeta}>
                      {view.parent_element_name && ` · 挂载于 ${view.parent_element_name}`}
                      {' '}({elements.length} 元素 / {relationships.length} 关系)
                    </span>
                  </Heading>
                  {view.description && <p>{view.description}</p>}

                  {elements.length > 0 && (
                    <GraphVisualizer elements={elements} relationships={relationships} />
                  )}

                  <div className={styles.tablesWrap}>
                    <section>
                      <Heading as="h3">元素明细（{elements.length}）</Heading>
                      <ElementTable elements={elements} />
                    </section>
                    <section>
                      <Heading as="h3">关系明细（{relationships.length}）</Heading>
                      <RelationshipTable relationships={relationships} elements={elements} />
                    </section>
                  </div>
                </section>
              );
            })}

            {graph.views.length === 0 && (
              <>
                <Heading as="h2">全部元素与关系</Heading>
                <GraphVisualizer elements={graph.elements} relationships={graph.relationships} />
                <Heading as="h3">元素明细</Heading>
                <ElementTable elements={graph.elements} />
                <Heading as="h3">关系明细</Heading>
                <RelationshipTable relationships={graph.relationships} elements={graph.elements} />
              </>
            )}
          </>
        )}
      </main>
    </Layout>
  );
}
