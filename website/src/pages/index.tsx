import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function useT() {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  return (en: string, zhStr: string) => (zh ? zhStr : en);
}

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  const t = useT();
  const heroImageSrc = useBaseUrl('/img/hero-archgraph.jpg');

  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <div className={styles.heroContent}>
          <Link to="/docs/architecture" className={styles.announcementBadge}>
            <span>✨</span>
            <span>{t('ArchGraph 0.29 Released · Intent Graph for Agentic Engineering', 'ArchGraph 0.29 正式版 · 面向 Agent 工程的意图架构图')}</span>
            <span>→</span>
          </Link>

          <Heading as="h1" className={styles.heroTitle}>
            {siteConfig.title}
          </Heading>

          <p className={styles.heroSubtitle}>
            {t('Unify agent engineering with one intent architecture graph', '用一张意图架构图，统一 Agent 工程')}
          </p>

          <p className={styles.heroLead}>
            {t(
              'A framework plus long-term memory on one intent graph, reached through one decoupled MCP. Ground your coding agents with an executable blueprint, compose sovereign project graphs into an enterprise-wide knowledge graph.',
              '一个“框架 + 长期记忆”，建立在唯一一张意图图之上，经由解耦的 MCP 访问。为智能体提供可执行的架构蓝图，并把自治项目图谱拼装为组织级图谱——一切都建立在开闭演进的灵活架构上。',
            )}
          </p>

          <div className={styles.buttons}>
            <Link className={clsx('button button--lg', styles.btnPrimary)} to="/docs/onboarding">
              {t('Get Started', '快速起步')} →
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/architecture">
              {t('Architecture', '核心架构')}
            </Link>
            <Link className="button button--outline button--lg" to="/federation">
              {t('Explore Federation', '探索联邦')}
            </Link>
            <Link className="button button--outline button--lg" to="/ontologies">
              {t('Ontologies', '本体货架')}
            </Link>
          </div>

          <div className={styles.heroVisualWrapper}>
            <img
              src={heroImageSrc}
              alt={t('ArchGraph Intent Architecture Knowledge Graph', 'ArchGraph 意图架构知识图谱')}
              className={styles.heroImage}
              loading="eager"
            />
          </div>

          <div className={styles.statsStrip}>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>1</div>
              <div className={styles.statLabel}>{t('Single Source of Truth', '唯一意图事实源')}</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>100%</div>
              <div className={styles.statLabel}>{t('Executable TDD Acceptance', '架构可执行验收')}</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>Closed Loop</div>
              <div className={styles.statLabel}>{t('Locate · Arm · Accept · Commit', '定位 · 武装 · 验收 · 闭环')}</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>Federated</div>
              <div className={styles.statLabel}>{t('Sovereign Knowledge Mesh', '去中心化主权联邦')}</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function WorkflowSection() {
  const t = useT();
  const steps = [
    {
      step: '1',
      title: t('Locate', '定位'),
      desc: t(
        'Find the target architecture element and view in the graph before touching any code.',
        '动工前先在图中依据语义找到受影响的架构元素与视图，确立任务边界。',
      ),
    },
    {
      step: '2',
      title: t('Arm', '武装'),
      desc: t(
        'Load the required skills, rules, and contextual memories for the assigned Business Actor.',
        '检索该元素与角色所需的能力技能、工程规范和历史经验，进入会话记忆。',
      ),
    },
    {
      step: '3',
      title: t('Accept', '验收'),
      desc: t(
        'Define or update executable GIVEN-WHEN-THEN acceptance tests before implementation.',
        '先行编写或更新外部视角的验收测试用例，坚持 TDD 驱动行为正确性。',
      ),
    },
    {
      step: '4',
      title: t('Verify & Commit', '闭环'),
      desc: t(
        'Run full regression, git commit all changes, and register the hash onto the architecture element.',
        '全量跑通验收，提交 Git 并将 commit id 与文件回填登记入架构图，形成闭环。',
      ),
    },
  ];

  return (
    <section className={styles.workflowSection}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.kicker}>{t('Engineered Reliability', '工程可靠性')}</p>
          <Heading as="h2">{t('Closed-Loop Agentic Workflow', '闭环 Agent 工程流')}</Heading>
          <p>
            {t(
              'Say goodbye to prompt drift and untracked code changes. ArchGraph enforces strict architectural governance.',
              '告别提示词漂移与脱缰的代码修改。ArchGraph 通过意图图谱确保智能体有图可依、每次提交皆可追溯。',
            )}
          </p>
        </div>

        <div className={styles.workflowGrid}>
          {steps.map((s) => (
            <div key={s.step} className={styles.workflowCard}>
              <div className={styles.workflowStep}>{s.step}</div>
              <Heading as="h3">{s.title}</Heading>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ShowcasePanelProps {
  no: string;
  kicker: string;
  title: string;
  lead: string;
  problem: string;
  capability: string;
  value: string;
  imageSrc: string;
  imageAlt: string;
  reverse?: boolean;
  altBg?: boolean;
  links: Array<{label: string; to: string; primary?: boolean}>;
}

function ShowcasePanel({
  kicker,
  title,
  lead,
  problem,
  capability,
  value,
  imageSrc,
  imageAlt,
  reverse = false,
  altBg = false,
  links,
}: ShowcasePanelProps) {
  const t = useT();

  return (
    <section className={clsx(styles.streamSection, altBg && styles.streamSectionAlt)}>
      <div className="container">
        <div className={clsx(styles.streamRow, reverse && styles.streamRowReverse)}>
          <div className={styles.streamColVisual}>
            <div className={styles.streamImageWrapper}>
              <img src={imageSrc} alt={imageAlt} className={styles.streamImage} loading="lazy" />
            </div>
          </div>

          <div className={styles.streamColContent}>
            <p className={styles.kicker}>{kicker}</p>
            <Heading as="h2" className={styles.streamTitle}>{title}</Heading>
            <p className={styles.streamLead}>{lead}</p>

            <div className={styles.streamTrio}>
              <div className={styles.trioItem}>
                <span className={styles.trioBadgeProblem}>{t('Problem', '痛点')}</span>
                <p className={styles.trioText}>{problem}</p>
              </div>

              <div className={styles.trioItem}>
                <span className={styles.trioBadgeCapability}>{t('Capability', '方案')}</span>
                <p className={styles.trioText}>{capability}</p>
              </div>

              <div className={styles.trioItem}>
                <span className={styles.trioBadgeValue}>{t('Value', '收益')}</span>
                <p className={styles.trioText}>{value}</p>
              </div>
            </div>

            <div className={styles.streamActions}>
              {links.map((link) => (
                <Link
                  key={link.to}
                  className={clsx(
                    'button',
                    link.primary ? clsx('button--primary', styles.btnPrimary) : 'button--outline',
                  )}
                  to={link.to}
                >
                  {link.label} →
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AdvantagesSection() {
  const t = useT();

  const advantages = [
    {
      icon: '🧩',
      title: t('Pluggable Ontology', '本体可插拔'),
      desc: t(
        'The graph’s ontology is replaceable and customizable. Extend or swap type systems (ArchiMate 3.2, custom bundles) without modifying the framework.',
        '图谱本体可替换、可自定义——支持默认 ArchiMate 3.2 标准及项目专属类型，遵循开闭原则，扩展无需重写框架。',
      ),
      linkText: t('Explore Ontologies', '浏览本体货架'),
      to: '/ontologies',
    },
    {
      icon: '⚡',
      title: t('Decoupled Read/Write MCP', '读写解耦与治理'),
      desc: t(
        'The read/write MCP is decoupled from specific ontologies. It enforces write governance (lossless gate, tombstone ledger) and provides high-performance retrieval.',
        '读写 MCP 与图谱/本体深度解耦；负责写入无损防丢、变更墓碑治理、读写吞吐以及 GraphRAG 混合检索召回。',
      ),
      linkText: t('Architecture Deep Dive', '深入核心架构'),
      to: '/docs/architecture',
    },
    {
      icon: '📊',
      title: t('Profiled & Measurable', '指标度量与对比'),
      desc: t(
        'Rigorous profile evaluation framework (scenario × scale × metrics) with fair, reproducible benchmarks against RAG baselines (e.g., LightRAG).',
        '多维剖面评测框架（场景 × 规模 × 指标），支持在同一 Agent 下与 RAG 基线进行公平可重复的客观对比与度量。',
      ),
      linkText: t('View Metrics & Evals', '查看评测指标'),
      to: '/docs/metrics',
    },
  ];

  return (
    <section className={styles.advantagesSection}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.kicker}>{t('Technical Advantages', '技术优势')}</p>
          <Heading as="h2">{t('Why Developers & Teams Choose ArchGraph', '为什么开发者与团队选择 ArchGraph')}</Heading>
          <p>
            {t(
              'Designed from first principles for grounded agent collaboration and decentralized knowledge management.',
              '从第一性原理出发，为可靠的智能体工程与去中心化知识沉淀打造。',
            )}
          </p>
        </div>

        <div className={styles.featuresGrid}>
          {advantages.map((adv) => (
            <div key={adv.to} className={styles.featureCard}>
              <div>
                <div className={styles.featureIcon}>{adv.icon}</div>
                <Heading as="h3">{adv.title}</Heading>
                <p>{adv.desc}</p>
              </div>
              <Link className="button button--secondary button--sm margin-top--md" to={adv.to}>
                {adv.linkText} →
              </Link>
            </div>
          ))}
        </div>

        <p className={styles.ontologyNote}>
          {t(
            'Default enterprise standard: ArchiMate 3.2 (64 element types, 11 relationship types). Discover and upload community ontologies in the ',
            '默认工业级标准：ArchiMate 3.2（64 元素类型，11 关系矩阵）。发现或上传社区本体请前往 ',
          )}
          <Link to="/ontologies">{t('Ontology Shelf', '本体货架')}</Link>
          {t('.', '。')}
        </p>
      </div>
    </section>
  );
}

function InsightSection() {
  const t = useT();

  return (
    <section className={styles.insightSection}>
      <div className="container">
        <div className={styles.insightCard}>
          <p className={styles.kicker}>{t('Core Philosophy', '核心理念')}</p>
          <Heading as="h2">{t('Architecture as Executable Knowledge', '架构即活体知识，而非僵化文档')}</Heading>
          <p>
            {t(
              'Agentic engineering requires a durable, queryable model of the system, not transient prompt injections. Knowledge graphs plus hybrid retrieval provide grounded context; MCP standardizes agent interactions. ArchGraph transforms system architecture from static diagrams into an executable source of truth that agents read, verify, and advance — across projects, teams, and federations.',
              'Agentic Engineering 需要一个持久、可查询的系统模型，而不只是临时拼接的提示词。知识图谱 + 混合检索为智能体提供坚实依据，MCP 让其被任意 Agent 统一调用。ArchGraph 让架构图成为智能体持续读写与闭环验证的唯一事实源——跨越项目、团队与组织联邦，架构不再是陈旧的文档，而是共享、可执行的活体知识。',
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function BottomCtaSection() {
  const t = useT();

  return (
    <section className={styles.bottomCtaSection}>
      <div className="container">
        <div className={styles.bottomCtaCard}>
          <Heading as="h2">
            {t('Ready to Upgrade Your Agent Engineering?', '准备好升级你的 Agent 工程范式了吗？')}
          </Heading>
          <p>
            {t(
              'Initialize your first project intent graph in minutes, or connect to the federation network.',
              '只需几分钟即可为你的项目初始化第一张意图架构图，或接入去中心化联邦网络。',
            )}
          </p>
          <div className={styles.buttons}>
            <Link className={clsx('button button--lg', styles.btnPrimary)} to="/docs/onboarding/create">
              {t('Create Your First Project', '创建首个项目')} →
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/onboarding/join-federation">
              {t('Join the Federation', '加入联邦网格')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const t = useT();

  const feature1Img = useBaseUrl('/img/feature-project-graph.jpg');
  const feature2Img = useBaseUrl('/img/feature-federation-graph.jpg');
  const feature3Img = useBaseUrl('/img/feature-ontology-mcp.jpg');

  return (
    <Layout
      title={`${siteConfig.title} — ${siteConfig.tagline}`}
      description={t(
        'ArchGraph: build a project knowledge graph, compose an organization-level graph, on a flexible architecture with a pluggable ontology and a decoupled read/write MCP.',
        'ArchGraph：为项目构建知识图谱、组合组织级图谱，架构灵活——本体可插拔、读写 MCP 与图谱解耦。',
      )}
    >
      <HomepageHeader />
      <main>
        <WorkflowSection />

        <ShowcasePanel
          no="1"
          kicker={t('Value Stream 01 · Project Level', '价值流 01 · 项目级')}
          title={t('Build a Project Knowledge Graph & Closed Loop', '为单个项目构建意图图谱与闭环记忆')}
          lead={t(
            'Ground AI coding agents on one intent graph as the single source of truth, tracing every change back to architecture and commits.',
            '以唯一意图图为事实源（定位 → 武装 → 验收，每次 Commit 可回溯），搭配长期记忆 GraphRAG 与写入治理。',
          )}
          problem={t(
            'Project context is scattered across prompts and files; agents suffer from hallucinations and knowledge is not durable.',
            '项目上下文散落在提示词与代码文件中；智能体缺乏依据产生幻觉，系统架构与知识断层难以沉淀。',
          )}
          capability={t(
            'One intent graph as the source of truth (locate → arm → accept, trace every commit), plus long-term memory with GraphRAG and write governance.',
            '以唯一意图图为事实源，建立闭环治理机制：语义定位、技能武装、TDD 先行验收与提交追溯，融合 GraphRAG 混合检索。',
          )}
          value={t(
            'Agents work grounded and under control; architecture becomes executable, inspectable, reusable knowledge — a complete loop of write → read → verify.',
            '智能体有图可依、行为可控；架构成为可执行、可检查、可复用的活体知识，形成「写 → 读 → 验」的严密工程闭环。',
          )}
          imageSrc={feature1Img}
          imageAlt={t('Single-Project Intent Architecture Graph for AI Coding Agents', '单项目意图架构图与 AI 智能体闭环')}
          links={[
            {label: t('Create a project', '创建项目'), to: '/docs/onboarding/create', primary: true},
            {label: t('Architecture', '架构详解'), to: '/docs/architecture'},
          ]}
        />

        <ShowcasePanel
          no="2"
          kicker={t('Value Stream 02 · Organization Level', '价值流 02 · 组织级')}
          title={t('Compose Project Graphs into an Organization Federation', '把项目图谱组合成组织级联邦知识图谱')}
          lead={t(
            'Assemble modular project building blocks into an enterprise-wide knowledge graph while preserving content sovereignty and autonomy.',
            '将项目作为积木，通过联邦注册中心与 Graph Store 构建跨项目网络，不合并图谱、不丢失内容主权。',
          )}
          problem={t(
            'Teams and projects operate in silos with redundant context; no governed or secure mechanism exists to share architectural knowledge.',
            '多项目间彼此孤立、知识竖井严重；缺乏受安全治理、带权限保护的跨项目与跨团队上下文共享方式。',
          )}
          capability={t(
            'Project = the basic building block. A federation registry plus a Graph Store host queryable replicas and serve cross-project reads under authorization (default deny).',
            '项目 = 基本积木。联邦注册中心 + Graph Store 托管可查询副本，在严格授权契约（默认拒绝）下提供跨项目安全读取。',
          )}
          value={t(
            'Assemble an organization-level knowledge graph from projects — flexible, modular, without merging graphs or losing content sovereignty.',
            '把零散项目“搭积木”式拼装成组织级知识图谱——灵活、模块化，且数据自主、各团队保持完整主权。',
          )}
          imageSrc={feature2Img}
          imageAlt={t('Decentralized Organization-Level Knowledge Graph Federation', '去中心化组织级知识图谱联邦与数据主权')}
          reverse
          altBg
          links={[
            {label: t('Join the federation', '加入联邦'), to: '/docs/onboarding/join-federation', primary: true},
            {label: t('Federation page', '联邦成员页'), to: '/federation'},
          ]}
        />

        <ShowcasePanel
          no="3"
          kicker={t('Value Stream 03 · Enabling Architecture', '价值流 03 · 支撑架构')}
          title={t('Pluggable Ontology & Decoupled Read/Write Engine', '本体可插拔与读写解耦的先进支撑架构')}
          lead={t(
            'Open-closed and evolvable: swap domain ontologies per project while read/write performance and governance improve independently.',
            '统一 MCP 读写图谱；本体可插拔，且 MCP 核心能力与具体图谱/本体深度解耦，两者独立演进。',
          )}
          problem={t(
            'A rigid, single-ontology, tightly-coupled design creates vendor lock-in and prevents technical stack evolution across diverse teams.',
            '单一本体、紧耦合的僵化设计会导致系统锁定，难以支持异构领域模型的灵活适配与技术演化。',
          )}
          capability={t(
            'A unified MCP reads/writes the graph; the ontology is pluggable and the MCP is decoupled from the graph/ontology with lossless write governance.',
            '统一 MCP 接口抽象；支持 ArchiMate 3.2 工业标准与自定义本体一键热插拔；负责无损写入守护与多维指标度量。',
          )}
          value={t(
            'Open-closed and evolvable: swap ontologies per project, and keep improving read/write capabilities independently with benchmarked precision & recall.',
            '开闭原则、灵活扩展：每个项目可自定本体；读写性能、检索准确率与召回率持续优化并公开可度量。',
          )}
          imageSrc={feature3Img}
          imageAlt={t('Pluggable Ontology and Decoupled MCP Architecture', '本体可插拔与解耦读写 MCP 架构')}
          links={[
            {label: t('Browse ontologies', '探索本体货架'), to: '/ontologies', primary: true},
            {label: t('Metrics & evaluation', '指标与评测'), to: '/docs/metrics'},
          ]}
        />

        <AdvantagesSection />
        <InsightSection />
        <BottomCtaSection />
      </main>
    </Layout>
  );
}
