import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ArchGraph',
  tagline: 'An architecture-graph driven framework for Agentic Engineering',
  favicon: 'img/favicon.ico',

  url: 'https://argo.derekworkspacev5.com',
  baseUrl: '/archgraph/',

  organizationName: 'derekhu0002',
  projectName: 'graph-wiki',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans', 'en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/derekhu0002/graph-wiki/tree/main/website/',
          routeBasePath: 'docs',
        },
        blog: {
          showReadingTime: true,
          editUrl: 'https://github.com/derekhu0002/graph-wiki/tree/main/website/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ArchGraph',
      logo: {
        alt: 'ArchGraph Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'dropdown',
          label: '新项目接入',
          position: 'left',
          items: [
            {to: '/docs/onboarding', label: '概览'},
            {to: '/docs/onboarding/create', label: '创建新项目'},
            {to: '/docs/onboarding/join-federation', label: '加入联邦'},
            {to: '/docs/onboarding/collaborate', label: '共享与协作'},
          ],
        },
        {to: '/ontologies', label: '本体货架', position: 'left'},
        {to: '/community', label: '社区', position: 'left'},
        {to: '/federation', label: '联邦成员', position: 'left'},
        {
          href: 'https://github.com/derekhu0002/archgraph',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '项目',
          items: [
            {label: 'ArchGraph 框架', href: 'https://github.com/derekhu0002/archgraph'},
            {label: '图谱共享库', href: 'https://github.com/derekhu0002/graph-wiki'},
            {label: 'aBot', href: 'https://github.com/derekhu0002/aBot'},
          ],
        },
        {
          title: '社区',
          items: [
            {label: '社区总览', to: '/community'},
            {label: '本体货架', to: '/ontologies'},
            {label: 'ArchiMate 本体', to: '/ontologies/archimate'},
            {label: '子图规范', to: '/docs/community/subgraph-spec'},
            {label: '贡献指南', to: '/docs/community/contributing'},
          ],
        },
        {
          title: '更多',
          items: [
            {label: '说明', to: '/docs/intro'},
            {label: '博客', to: '/blog'},
            {label: '子图库', to: '/graphs'},
            {label: 'GitHub', href: 'https://github.com/derekhu0002'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ArchGraph Community. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
