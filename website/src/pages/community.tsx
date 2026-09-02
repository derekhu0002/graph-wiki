import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';

import styles from './graphs.module.css';

const cards = [
  {
    title: '子图库',
    body: '浏览社区已收录的架构子图，实时从 GRAPH MCP 拉取。',
    to: '/graphs',
  },
  {
    title: '子图规范',
    body: '子图命名、类型、质量门槛（schema 校验）。',
    to: '/docs/community/subgraph-spec',
  },
  {
    title: '贡献指南',
    body: '如何把你的项目子图贡献给社区，以及如何获取他人子图。',
    to: '/docs/community/contributing',
  },
];

export default function Community(): JSX.Element {
  return (
    <Layout
      title="社区"
      description="ArchGraph 共建共享社区">
      <main className="container margin-vert--lg">
        <Heading as="h1">ArchGraph 社区</Heading>
        <p>
          让每个 Agent 项目的架构知识成为社区的公共资产。通过<strong>架构子图</strong>的
          共建共享，形成一套跨项目可复用的 Agentic Engineering 架构语言。
        </p>

        <div className="row">
          {cards.map((c) => (
            <div className="col col--4" key={c.title}>
              <div className={clsx('card', styles.card)}>
                <div className="card__header"><h3>{c.title}</h3></div>
                <div className="card__body"><p>{c.body}</p></div>
                <div className="card__footer">
                  <Link className="button button--primary button--sm" to={c.to}>进入</Link>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Heading as="h2" className="margin-top--lg">如何参与</Heading>
        <ol>
          <li>配置远程 MCP（<code>graph-mcp</code> → <code>https://argo.derekworkspacev5.com/mcp</code>）</li>
          <li>用 <code>graph_list</code> / <code>graph_get</code> 获取社区子图</li>
          <li>把你的项目意图图裁剪成子图，用 <code>graph_submit</code> 提交</li>
        </ol>

        <Heading as="h2" className="margin-top--lg">总体规划</Heading>
        <p>
          完整的社区愿景、治理、运营规划见仓库
          <Link href="https://github.com/derekhu0002/graph-wiki/blob/main/community/PLAN.md"> community/PLAN.md</Link>。
        </p>
      </main>
    </Layout>
  );
}
