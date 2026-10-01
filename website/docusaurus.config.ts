import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ArchGraph',
  tagline: 'Unify agent engineering with one intent architecture graph',
  favicon: 'img/favicon.ico',

  url: 'https://argo.derekworkspacev5.com',
  baseUrl: '/archgraph/',

  organizationName: 'derekhu0002',
  projectName: 'graph-wiki',

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    localeConfigs: {
      en: {label: 'English', direction: 'ltr', htmlLang: 'en'},
      zh: {label: '中文', direction: 'ltr', htmlLang: 'zh-Hans'},
    },
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
          label: 'Onboarding',
          position: 'left',
          items: [
            {to: '/docs/onboarding', label: 'Overview'},
            {to: '/docs/onboarding/create', label: 'Create a project'},
            {to: '/docs/onboarding/join-federation', label: 'Join the federation'},
            {to: '/docs/onboarding/collaborate', label: 'Collaborate'},
          ],
        },
        {to: '/ontologies', label: 'Ontologies', position: 'left'},
        {to: '/federation', label: 'Federation', position: 'left'},
        {
          type: 'localeDropdown',
          position: 'right',
        },
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
          title: 'Project',
          items: [
            {label: 'ArchGraph framework', href: 'https://github.com/derekhu0002/archgraph'},
            {label: 'Graph store (graph-wiki)', href: 'https://github.com/derekhu0002/graph-wiki'},
            {label: 'aBot', href: 'https://github.com/derekhu0002/aBot'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'Overview', to: '/community'},
            {label: 'Ontologies', to: '/ontologies'},
            {label: 'ArchiMate ontology', to: '/ontologies/archimate'},
            {label: 'Subgraph spec', to: '/docs/community/subgraph-spec'},
            {label: 'Contributing', to: '/docs/community/contributing'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'About', to: '/docs/intro'},
            {label: 'Blog', to: '/blog'},
            {label: 'Subgraph library', to: '/graphs'},
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
