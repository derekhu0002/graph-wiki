import {useEffect, useState} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './graphs.module.css';

type GraphAsset = {
  id: string;
  name: string;
  version: string;
  sourceRepo: string;
  sourceCommit: string;
  description: string;
  stats?: {elements?: number; relationships?: number; views?: number};
};

const MCP_URL = '/mcp';

async function mcpCall(name: string, args: Record<string, unknown>) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: {name, arguments: args}}),
  });
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text;
  if (!text) throw new Error('MCP call failed');
  return JSON.parse(text);
}

export default function Graphs(): JSX.Element {
  const [graphs, setGraphs] = useState<GraphAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    mcpCall('graph_list', {})
      .then((r) => setGraphs(r.graphs || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout
      title="子图库"
      description="ArchGraph 社区已收录的架构子图">
      <main className="container">
        <Heading as="h1">架构子图库</Heading>
        <p>社区项目贡献的架构子图（实时从 GRAPH MCP 拉取）。</p>

        {loading && <p>加载中…</p>}
        {error && <p className={styles.error}>加载失败：{error}</p>}

        {graphs && (
          <div className="row">
            {graphs.length === 0 && <p>暂无子图。</p>}
            {graphs.map((g) => (
              <div className="col col--6" key={g.id}>
                <div className={clsx('card', styles.card)}>
                  <div className="card__header">
                    <h3>{g.name}</h3>
                    <code>{g.id}</code>
                  </div>
                  <div className="card__body">
                    <p>{g.description}</p>
                    <p className={styles.meta}>
                      版本 {g.version} · 来源 {g.sourceRepo}
                      {g.stats && ` · ${g.stats.elements} 元素 / ${g.stats.relationships} 关系 / ${g.stats.views} 视图`}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2>贡献你的子图</h2>
        <p>
          把你的项目意图图裁剪成有复用价值的子图，通过 <code>graph_submit</code> 提交给社区。
          详见 <a href="/docs/community/contributing">贡献指南</a>。
        </p>
      </main>
    </Layout>
  );
}
