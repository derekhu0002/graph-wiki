import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import styles from './graphs.module.css';

export default function Community(): JSX.Element {
  const {i18n} = useDocusaurusContext();
  const t = (en: string, zh: string) => (i18n.currentLocale === 'zh' ? zh : en);
  const cards = [
    {title: t('Subgraph library', '子图库'), body: t('Browse community architecture subgraphs (live from the graph MCP).', '浏览社区已收录的架构子图，实时从 GRAPH MCP 拉取。'), to: '/graphs'},
    {title: t('Federation members', '联邦成员'), body: t('Registered members and their authorization graph.', '已登记成员及其授权关系图。'), to: '/federation'},
    {title: t('Subgraph spec', '子图规范'), body: t('Naming, types and quality gates (schema validation).', '子图命名、类型、质量门槛（schema 校验）。'), to: '/docs/community/subgraph-spec'},
    {title: t('Contributing', '贡献指南'), body: t('How to contribute subgraphs and consume others.', '如何贡献项目子图，以及如何获取他人子图。'), to: '/docs/community/contributing'},
  ];

  return (
    <Layout title={t('Community', '社区')} description={t('ArchGraph co-building community', 'ArchGraph 共建共享社区')}>
      <main className="container margin-vert--lg">
        <Heading as="h1">{t('ArchGraph community', 'ArchGraph 社区')}</Heading>
        <p>
          {t(
            "Turn every agent project's architecture knowledge into a shared community asset. Through co-building architecture subgraphs, we form a reusable cross-project architecture language for Agentic Engineering.",
            '让每个 Agent 项目的架构知识成为社区的公共资产。通过架构子图的共建共享，形成一套跨项目可复用的 Agentic Engineering 架构语言。',
          )}
        </p>

        <div className="row">
          {cards.map((c) => (
            <div className="col col--6" key={c.title}>
              <div className={clsx('card', styles.card)}>
                <div className="card__header"><h3>{c.title}</h3></div>
                <div className="card__body"><p>{c.body}</p></div>
                <div className="card__footer"><Link className="button button--primary button--sm" to={c.to}>{t('Open', '进入')}</Link></div>
              </div>
            </div>
          ))}
        </div>

        <Heading as="h2" className="margin-top--lg">{t('How to participate', '如何参与')}</Heading>
        <ol>
          <li>{t('Configure the remote MCP (', '配置远程 MCP（')}<code>graph-mcp</code> → <code>https://argo.derekworkspacev5.com/mcp</code>）</li>
          <li>{t('Fetch community subgraphs with ', '用 ')}<code>graph_list</code> / <code>graph_get</code>{t('', ' 获取社区子图')}</li>
          <li>{t('Trim your intent graph into a subgraph and submit with ', '把你的项目意图图裁剪成子图，用 ')}<code>graph_submit</code>{t('', ' 提交')}</li>
        </ol>

        <Heading as="h2" className="margin-top--lg">{t('Community plan', '总体规划')}</Heading>
        <p>
          {t('The full vision, governance and operations plan is in ', '完整的社区愿景、治理、运营规划见仓库 ')}
          <Link href="https://github.com/derekhu0002/graph-wiki/blob/main/community/PLAN.md"> community/PLAN.md</Link>.
        </p>
      </main>
    </Layout>
  );
}
