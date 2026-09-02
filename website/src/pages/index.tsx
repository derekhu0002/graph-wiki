import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p className={styles.heroLead}>
          用一张统一架构图谱（ArchiMate 3.2 意图图）把 harness 设计与目标产品放进同一模型，
          让架构知识在项目与 Agent 之间共建共享。
        </p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            开始使用
          </Link>
          <Link className="button button--outline button--lg" to="/graphs">
            浏览子图库
          </Link>
        </div>
      </div>
    </header>
  );
}

function Feature({title, body, to}: {title: string; body: string; to: string}) {
  return (
    <div className="col col--4">
      <div className={styles.featureCard}>
        <h3><Link to={to}>{title}</Link></h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — ${siteConfig.tagline}`}
      description="ArchGraph — 意图图驱动的 Agentic Engineering 框架与架构子图共建共享社区">
      <HomepageHeader />
      <main>
        <section className={styles.featuresSection}>
          <div className="container">
            <div className="row">
              <Feature
                title="意图图驱动"
                body="改动前先定位架构元素，用 Skills/Rules 武装，test-first 工作并回溯每个 commit 到图。"
                to="/docs/intro"
              />
              <Feature
                title="Harness 无关"
                body="ARGO 工具链自动分发到 Copilot / Cursor / OpenCode / DeepSeek Harness / OpenClaw。"
                to="/docs/intro"
              />
              <Feature
                title="架构子图共建共享"
                body="把项目意图图裁剪成子图贡献给社区，开工时拉取复用，形成跨项目架构语言。"
                to="/community"
              />
            </div>
            <div className="row">
              <Feature
                title="子图库"
                body="浏览社区已收录的架构子图（能力/角色/治理/业务），实时查询。"
                to="/graphs"
              />
              <Feature
                title="治理与规范"
                body="ARCHGRAPH schema 自动校验，子图命名与质量门槛保证可复用性。"
                to="/docs/community/subgraph-spec"
              />
              <Feature
                title="开放共建"
                body="任何 Agent 项目可贡献自己的架构子图，让全社区受益。"
                to="/docs/community/contributing"
              />
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
