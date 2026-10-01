import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function useT() {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  return (en: string, zhStr: string) => (zh ? zhStr : en);
}

function HomepageHeader({t}: {t: (e: string, z: string) => string}) {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">{siteConfig.title}</Heading>
        <p className="hero__subtitle">
          {t('Unify agent engineering with one intent architecture graph', '用一张意图架构图，统一 Agent 工程')}
        </p>
        <p className={styles.heroLead}>
          {t(
            'ArchGraph is a framework plus long-term memory built on one intent architecture graph, reached through one MCP. The graph\'s ontology is pluggable — ArchiMate 3.2 is the base today, and more ontologies can be added. A project is the basic block; the Graph Store federates project graphs into an organization-level knowledge graph.',
            'ArchGraph 是“框架 + 长期记忆”，建立在唯一一张意图架构图之上，经由一个 MCP 访问。图的「本体可插拔」——ArchiMate 3.2 只是当前的基础本体，还可扩展更多本体。以项目为基本 block；Graph Store 再把各项目图联邦为组织级知识图谱。',
          )}
        </p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/onboarding">{t('Get started', '开始使用')}</Link>
          <Link className="button button--outline button--lg" to="/ontologies">{t('Explore ontologies', '浏览本体')}</Link>
          <Link className="button button--outline button--lg" to="/federation">{t('Federation', '联邦')}</Link>
        </div>
      </div>
    </header>
  );
}

const CONSTRAINTS: Array<{en: string; zh: string; enD: string; zhD: string}> = [
  {en: 'Locate first', zh: '定位先行', enD: 'Find the architecture element before changing anything.', zhD: '改动前先在图中定位架构元素。'},
  {en: 'Acceptance first', zh: '验收先行', enD: 'Executable GIVEN-WHEN-THEN before implementation.', zhD: '先写可执行 GIVEN-WHEN-THEN 再实现。'},
  {en: 'Provable change', zh: '变更可证', enD: 'Every commit traces back to the graph.', zhD: '每次 commit 都可回溯到图。'},
  {en: 'Lossless write', zh: '写入无害', enD: 'Gate on dedup / lossless / tombstone.', zhD: '去重/无损/墓碑门禁。'},
];

function ConstraintStrip({t}: {t: (e: string, z: string) => string}) {
  const zh = t('x', 'y') === 'y';
  return (
    <section className={styles.strip}>
      <div className="container">
        <div className="row">
          {CONSTRAINTS.map((c, i) => (
            <div className="col col--3" key={i}>
              <div className={styles.constraint}>
                <strong>{zh ? c.zh : c.en}</strong>
                <p>{zh ? c.zhD : c.enD}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


function Capability({title, body, to}: {title: string; body: string; to: string}) {
  return (
    <div className="col col--4">
      <div className={styles.featureCard}>
        <h3><Link to={to}>{title}</Link></h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function Layer({kicker, title, intro, items}: {kicker: string; title: string; intro: string; items: Array<{title: string; body: string; to: string}>}) {
  return (
    <section className={styles.layerSection}>
      <div className="container">
        <p className={styles.kicker}>{kicker}</p>
        <Heading as="h2">{title}</Heading>
        <p className={styles.layerIntro}>{intro}</p>
        <div className="row">
          {items.map((it, i) => (<Capability key={i} title={it.title} body={it.body} to={it.to} />))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const t = useT();
  return (
    <Layout
      title={`${siteConfig.title} — ${siteConfig.tagline}`}
      description={t(
        'ArchGraph: intent-graph–driven Agentic Engineering, org-level knowledge federation, and a Graph Store for hosted project knowledge graphs.',
        'ArchGraph：意图图驱动的 Agentic Engineering、组织级知识联邦，以及托管项目知识图谱的 Graph Store。',
      )}>
      <HomepageHeader t={t} />
      <ConstraintStrip t={t} />
      <main>
        <Layer
          kicker={t('Project level · single project / agent', '项目级 · 单个项目 / 智能体')}
          title={t('A project knowledge graph, driven by intent', '以意图驱动的项目知识图谱')}
          intro={t(
            'Each project keeps one intent graph — in the ontology of your choice (ArchiMate 3.2 today, more to come) — as the source of truth. Agents locate the architecture element first, arm themselves with its skills/rules, work test-first, and trace every commit back to the graph.',
            '每个项目维护一张意图图——采用你选择的本体（当前为 ArchiMate 3.2，后续可换/可加）——作为事实源。智能体先定位架构元素，用其 Skills/Rules 武装自己，test-first 工作，并把每次 commit 回溯到图。',
          )}
          items={[
            {title: t('Intent-graph driven', '意图图驱动'), body: t('Locate the element before changing anything; arm with Skills/Rules; test-first; trace every commit to the graph.', '改动前先定位元素；用 Skills/Rules 武装；test-first；每次 commit 回溯到图。'), to: '/docs/onboarding/create'},
            {title: t('Harness-agnostic', 'Harness 无关'), body: t('One ARGO toolchain distributes to Copilot / Cursor / OpenCode / DeepSeek Harness / OpenClaw.', '一套 ARGO 工具链分发到 Copilot / Cursor / OpenCode / DeepSeek Harness / OpenClaw。'), to: '/docs/intro'},
            {title: t('Executable acceptance', '可执行验收'), body: t('GIVEN-WHEN-THEN acceptance lives in the graph; validation and regression run against it.', 'GIVEN-WHEN-THEN 验收写入图中；校验与回归据此执行。'), to: '/docs/intro'},
          ]}
        />

        <Layer
          kicker={t('Memory & retrieval · the AI line', '记忆与检索 · AI 线')}
          title={t('The graph is the memory', '图谱即记忆')}
          intro={t(
            'Beyond documentation, the graph is the agent\'s long-term memory: three-tier recall, GraphRAG with dual-channel retrieval, write governance, and lean, cost-aware reads.',
            '图谱不只是文档，更是 Agent 的长期记忆：三层记忆回忆、GraphRAG 双通道检索、写入治理，以及精益、可观测成本的读取。',
          )}
          items={[
            {title: t('Three-tier memory', '三层记忆'), body: t('T1 working / T2 long-term / T3 archive, recalled on demand (search by meaning, then read full context).', 'T1 工作记忆 / T2 长期记忆 / T3 归档，按需回忆（先按语义定位，再读全文）。'), to: '/docs/archimate/concepts'},
            {title: t('GraphRAG · dual channel', 'GraphRAG · 双通道'), body: t('Hybrid retrieval (vector + graph) with rerank and a recall threshold; token-lean reads via subgraph scoping.', '向量 + 图谱混合检索，配 rerank 与召回阈值；通过子图限定实现 Token 精益读取。'), to: '/docs/intro'},
            {title: t('Write governance', '写入治理'), body: t('Gate on write: dedup / lossless / tombstone — so knowledge is never silently lost.', '写入门禁：去重 / 无损 / 墓碑——知识不会被悄悄丢失。'), to: '/docs/intro'},
          ]}
        />

        <Layer
          kicker={t('Organization level · many projects sharing knowledge', '组织级 · 多项目知识共享')}
          title={t('From project graph to organization-level knowledge graph', '从项目图谱到组织级知识图谱')}
          intro={t(
            "The Graph Store adds a federation on top of individual projects: a registry for membership and authorization, an always-online mirror host that projects a member's graph into Neo4j with embeddings, and one query API so any project can read another's knowledge (with authorization).",
            'Graph Store 在单个项目之上增加一层联邦：成员与授权注册中心、始终在线的镜像宿主（把成员图投影进 Neo4j 并做 embedding），以及一个查询 API，让任一项目在授权后读取他方知识。',
          )}
          items={[
            {title: t('Federation registry', '联邦注册中心'), body: t('Self-register, discover members, authorize cross-project reads — default deny.', '自注册、发现成员、授权跨项目读取——默认拒绝。'), to: '/federation'},
            {title: t('Graph Store (mirror host)', 'Graph Store（镜像宿主）'), body: t('The center hosts reviewed, queryable replicas of project graphs (one Neo4j database per project); projects need not be online.', '中心托管经审核、可查询的项目图副本（每项目一个 Neo4j 库）；项目无需在线。'), to: '/docs/onboarding/join-federation'},
            {title: t('Cross-project query', '跨项目查询'), body: t('One endpoint, five read tools, optional projectId — structural and semantic (embeddings) reads across projects.', '一个端点、五个读工具、可选 projectId——跨项目的结构 + 语义（embedding）读取。'), to: '/docs/onboarding/collaborate'},
          ]}
        />
        <Layer
          kicker={t('Ecosystem · ontologies, subgraphs, community', '生态 · 本体、子图、社区')}
          title={t('A governed, extensible ecosystem', '受治理、可扩展的生态')}
          intro={t(
            'ArchiMate 3.2 is the base ontology; the shelf is extensible. Reusable architecture fragments become shared subgraphs — validated by the service on submit and browsable in the community site.',
            'ArchiMate 3.2 是基础本体，货架可扩展。可复用的架构片段成为共享子图——提交时由服务校验，并在社区站浏览。',
          )}
          items={[
            {title: t('Ontology shelf', '本体货架'), body: t('ArchiMate 3.2 as the base, with room for more ontologies (security, data, process…).', '以 ArchiMate 3.2 为基础，可扩展更多本体（安全、数据、流程…）。'), to: '/ontologies'},
            {title: t('Subgraph library', '子图库'), body: t('Contribute reusable graph fragments; consume them at project kickoff. Auto schema-validated.', '贡献可复用图片段；开工时复用。自动 schema 校验。'), to: '/graphs'},
            {title: t('Open community', '开放社区'), body: t('Any agent project can register, contribute subgraphs and participate in the federation.', '任何 Agent 项目都能注册、贡献子图、参与联邦。'), to: '/community'},
          ]}
        />
        <section className={styles.insightSection}>
          <div className="container">
            <Heading as="h2">{t('Why this matters', '为什么重要')}</Heading>
            <p>
              {t(
                'Agentic engineering needs more than prompts: it needs a durable, queryable model of the system. Knowledge graphs plus retrieval (Graph RAG) give agents grounded, inspectable context, and MCP makes that context callable by any agent. ArchGraph takes this a step further — the architecture graph is the artifact agents read and write, and the federation turns isolated project graphs into an organization-level knowledge graph, with membership, authorization and hosted availability. Architecture stops being a document and becomes shared, executable knowledge.',
                'Agentic Engineering 不止需要提示词，还需要一个持久、可查询的系统模型。知识图谱 + 检索（Graph RAG）为智能体提供有据可查的上下文，MCP 让该上下文可被任意智能体调用。ArchGraph 更进一步：架构图就是智能体读写的事实源，联邦把孤立的项目图汇聚为组织级知识图谱，并带来成员、授权与托管可用性。架构不再是文档，而成为共享的、可执行的 knowledge。',
              )}
            </p>
          </div>
        </section>
      </main>
    </Layout>
  );
}
