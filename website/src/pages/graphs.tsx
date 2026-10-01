import {useEffect, useState} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {graphList, type GraphAssetMeta} from '../lib/mcp';
import styles from './graphs.module.css';

export default function Graphs(): JSX.Element {
  const {i18n} = useDocusaurusContext();
  const t = (en: string, zh: string) => (i18n.currentLocale === 'zh' ? zh : en);
  const [graphs, setGraphs] = useState<GraphAssetMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    graphList().then(setGraphs).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  return (
    <Layout title={t('Subgraph library', '子图库')} description={t('Architecture subgraphs collected by the ArchGraph community', 'ArchGraph 社区已收录的架构子图')}>
      <main className="container margin-vert--lg">
        <Heading as="h1">{t('Architecture subgraph library', '架构子图库')}</Heading>
        <p>{t('Architecture subgraphs contributed by community projects (live from the graph MCP).', '社区项目贡献的架构子图（实时从 GRAPH MCP 拉取）。')}</p>

        {loading && <p>{t('Loading…', '加载中…')}</p>}
        {error && <p className={styles.error}>{t('Load failed: ', '加载失败：')}{error}</p>}

        {graphs && (
          <div className="row">
            {graphs.length === 0 && <p>{t('No subgraphs yet.', '暂无子图。')}</p>}
            {graphs.map((g) => (
              <div className="col col--6" key={g.id}>
                <div className={clsx('card', styles.card)}>
                  <div className="card__header">
                    <h3><Link to={`/graph-detail?id=${encodeURIComponent(g.id)}`}>{g.name}</Link></h3>
                    <code>{g.id}</code>
                  </div>
                  <div className="card__body">
                    <p>{g.description}</p>
                    <p className={styles.meta}>
                      {t('version', '版本')} {g.version} · {t('source', '来源')} {g.sourceRepo}
                      {g.stats && ` · ${g.stats.elements} ${t('elements', '元素')} / ${g.stats.relationships} ${t('relationships', '关系')} / ${g.stats.views} ${t('views', '视图')}`}
                    </p>
                  </div>
                  <div className="card__footer">
                    <Link className="button button--primary button--sm" to={`/graph-detail?id=${encodeURIComponent(g.id)}`}>
                      {t('View details & visualization', '查看详情与可视化')}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Heading as="h2" className="margin-top--lg">{t('Contribute your subgraph', '贡献你的子图')}</Heading>
        <p>
          {t('Trim your project intent graph into a reusable subgraph and submit it to the community with ', '把你的项目意图图裁剪成有复用价值的子图，通过 ')}
          <code>graph_submit</code>. {t('See the ', '详见 ')}
          <Link to="/docs/community/contributing">{t('contributing guide', '贡献指南')}</Link>.
        </p>
      </main>
    </Layout>
  );
}
