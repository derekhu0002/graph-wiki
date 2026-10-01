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
        <p className="hero__subtitle">{t('Unify agent engineering with one intent architecture graph', '用一张意图架构图，统一 Agent 工程')}</p>
        <p className={styles.heroLead}>
          {t(
            'A framework plus long-term memory on one intent graph, reached through one MCP. Build a project knowledge graph, compose many into an organization-level graph — on a flexible architecture.',
            '一个“框架 + 长期记忆”，建立在唯一一张意图图之上，经由一个 MCP 访问。可为单个项目构建知识图谱，再把众多项目组合成组织级图谱——一切都建立在灵活可插拔的架构上。',
          )}
        </p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/onboarding">{t('Get started', '开始使用')}</Link>
          <Link className="button button--outline button--lg" to="/docs/architecture">{t('Architecture', '架构')}</Link>
          <Link className="button button--outline button--lg" to="/federation">{t('Federation', '联邦')}</Link>
        </div>
      </div>
    </header>
  );
}

function ValueStream({
  no,
  kicker,
  title,
  problem,
  capability,
  value,
  links,
}: {
  no: string;
  kicker: string;
  title: string;
  problem: string;
  capability: string;
  value: string;
  links: Array<{label: string; to: string}>;
}) {
  return (
    <section className={styles.stream}>
      <div className="container">
        <div className="row">
          <div className="col col--2">
            <div className={styles.streamNo}>{no}</div>
          </div>
          <div className="col col--10">
            <p className={styles.kicker}>{kicker}</p>
            <Heading as="h2">{title}</Heading>
            <div className={styles.streamGrid}>
              <div><h4>{'!'}</h4><p>{problem}</p></div>
              <div><h4>{'→'}</h4><p>{capability}</p></div>
              <div><h4>{'✓'}</h4><p>{value}</p></div>
            </div>
            <p className={styles.streamLinks}>
              {links.map((l) => (
                <Link key={l.to} className="button button--secondary button--sm margin-right--sm" to={l.to}>{l.label} →</Link>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Advantage({t, tk, tb, td, to}: {t: (e: string, z: string) => string; tk: string; tb: string; td: string; to: string}) {
  return (
    <div className="col col--4">
      <div className={styles.featureCard}>
        <h3>{t(tk, tb)}</h3>
        <p>{t('', '')}{td}</p>
        <Link className="button button--outline button--sm" to={to}>{t('Learn more', '了解详情')} →</Link>
      </div>
    </div>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const t = useT();
  return (
    <Layout
      title={`${siteConfig.title} — ${siteConfig.tagline}`}
      description={t(
        'ArchGraph: build a project knowledge graph, compose an organization-level graph, on a flexible architecture with a pluggable ontology and a decoupled read/write MCP.',
        'ArchGraph：为项目构建知识图谱、组合组织级图谱，架构灵活——本体可插拔、读写 MCP 与图谱解耦。',
      )}>
      <HomepageHeader t={t} />
      <main>
        <ValueStream
          no="1"
          kicker={t('Value stream · project level', '价值流 · 项目级')}
          title={t('Build a project knowledge graph', '为单个项目构建知识图谱')}
          problem={t('Project context is scattered across prompts and files; agents are ungrounded and knowledge is not durable.', '项目上下文散落在提示词与文件里；智能体缺乏依据，知识也无法沉淀。')}
          capability={t('One intent graph as the source of truth (locate → arm → accept, trace every commit), plus long-term memory with GraphRAG and write governance.', '以唯一意图图为事实源（定位 → 武装 → 验收，每次 commit 可回溯），并配长期记忆：GraphRAG 与写入治理。')}
          value={t('Agents work grounded and under control; architecture becomes executable, inspectable, reusable knowledge — a closed loop of write → read → verify.', '智能体有图可依、可控；架构变成可执行、可检查、可复用的知识——形成「写 → 读 → 验」的闭环。')}
          links={[{label: t('Create a project', '创建项目'), to: '/docs/onboarding/create'}, {label: t('Architecture', '架构'), to: '/docs/architecture'}]}
        />

        <ValueStream
          no="2"
          kicker={t('Value stream · organization level', '价值流 · 组织级')}
          title={t('Compose project graphs into an organization graph', '把项目图谱组合成组织级图谱')}
          problem={t('Many projects, siloed knowledge; no shared, governed way to reuse each other\'s context.', '项目众多、知识孤岛；缺乏共享且受治理的复用方式。')}
          capability={t('Project = the basic building block. A federation registry plus a Graph Store host queryable replicas and serve cross-project reads under authorization (default deny).', '项目 = 基本积木。联邦注册中心 + Graph Store 托管可查询副本，并在授权下提供跨项目读取（默认拒绝）。')}
          value={t('Assemble an organization-level knowledge graph from projects — flexible, modular, without merging graphs or losing content sovereignty.', '把零散项目“搭积木”式拼成组织级知识图谱——灵活、模块化，且不合并图谱、不丢失内容主权。')}
          links={[{label: t('Join the federation', '加入联邦'), to: '/docs/onboarding/join-federation'}, {label: t('Federation page', '联邦页'), to: '/federation'}]}
        />

        <ValueStream
          no="3"
          kicker={t('Value stream · the enabling architecture', '价值流 · 支撑架构')}
          title={t('A flexible architecture that powers both', '支撑上述场景的灵活架构')}
          problem={t('A rigid, single-ontology, tightly-coupled design would lock you in and be hard to evolve.', '单一本体、紧耦合的僵化设计会造成锁定、难以演进。')}
          capability={t('A unified MCP reads/writes the graph; the ontology is pluggable and the MCP is decoupled from the graph/ontology.', '统一 MCP 读写图谱；本体可插拔，且 MCP 与图谱/本体解耦。')}
          value={t('Open-closed and evolvable: swap ontologies per project, and keep improving read/write capabilities independently.', '开闭原则、可演进：每个项目可自定本体；读写能力可独立持续优化。')}
          links={[{label: t('Architecture', '架构'), to: '/docs/architecture'}, {label: t('Metrics & evaluation', '指标与评测'), to: '/docs/metrics'}]}
        />

        <section className={styles.advantagesSection}>
          <div className="container">
            <Heading as="h2">{t('Architecture advantages', '架构优势')}</Heading>
            <div className="row">
              <Advantage t={t}
                tk="Pluggable ontology" tb="本体可插拔"
                td={t('The graph\'s ontology is replaceable and customizable — each project defines its own graph. Open-closed: extend or swap without rewriting the framework.', '图谱本体可替换、可自定义——每个项目都能定义自己的图谱。开闭原则：可扩展、可替换，无需重写框架。')}
                to="/ontologies" />
              <Advantage t={t}
                tk="Decoupled read/write" tb="读写解耦"
                td={t('The read/write MCP is decoupled from any graph/ontology; it owns ontology-agnostic but critical capabilities: write governance, read/write performance, retrieval precision & recall — and their measurement.', '读写 MCP 与图谱/本体解耦；它负责与本体无关但极其关键的能力：写入治理、读写性能与效率、检索准确率与召回率，以及这些指标的度量。')}
                to="/docs/architecture" />
              <Advantage t={t}
                tk="Measured, comparable" tb="可度量、可对比"
                td={t('A profile evaluation framework (scenario × scale × metrics) and fair comparisons against RAG baselines (e.g., LightRAG) under the same agent.', '剖面评测框架（场景 × 规模 × 指标），并在同一 Agent 下与 RAG 基线（如 LightRAG）做公平对照。')}
                to="/docs/metrics" />
            </div>
            <p className={styles.ontologyNote}>
              {t(
                'Default ontology: ArchiMate 3.2 — a widely adopted, formally specified enterprise-architecture standard with a defined relationship matrix. More ontologies live on the ',
                '默认本体：ArchiMate 3.2——一个被广泛采用、有正式规范与关系矩阵的企业架构标准。更多本体见 ',
              )}
              <Link to="/ontologies">{t('ontology shelf', '本体货架')}</Link>{t('.', '。')}
            </p>
          </div>
        </section>

        <section className={styles.insightSection}>
          <div className="container">
            <Heading as="h2">{t('Why this matters', '为什么重要')}</Heading>
            <p>
              {t(
                'Agentic engineering needs a durable, queryable model of the system, not just prompts. Knowledge graphs plus retrieval give agents grounded context; MCP makes it callable by any agent. ArchGraph makes the architecture graph the artifact agents read and write, and the federation turns isolated project graphs into an organization-level knowledge graph — architecture stops being a document and becomes shared, executable knowledge.',
                'Agentic Engineering 需要一个持久、可查询的系统模型，而不只是提示词。知识图谱 + 检索为智能体提供有据可依的上下文，MCP 让它可被任意智能体调用。ArchGraph 让架构图成为智能体读写的事实源，联邦把孤立的项目图汇聚为组织级知识图谱——架构不再是文档，而是共享的、可执行的 knowledge。',
              )}
            </p>
          </div>
        </section>
      </main>
    </Layout>
  );
}
