export type OntologyDocLink = {
  label: string;
  description?: string;
  href: string;
};

export type Ontology = {
  id: string;
  name: string;
  version: string;
  summary: string;
  description: string;
  /** 本体的文档/学习入口（原「建模专栏」内容归入此处） */
  docs: OntologyDocLink[];
  /** 外部权威规范/参考 */
  external?: {label: string; href: string};
  /** 是否为占位（建设中） */
  comingSoon?: boolean;
};

export const ONTOLOGIES: Ontology[] = [
  {
    id: 'archimate',
    name: 'ArchiMate',
    version: '3.2',
    summary: '企业架构建模语言：用一种统一语言描述业务、应用、技术各层的结构与关系。',
    description:
      'ArchiMate 是由 The Open Group 定义的企业架构建模语言。ArchGraph 以 ArchiMate 3.2 作为**基础本体**：' +
      '企业架构的要素（元素）按 Business / Application / Technology / Motivation / Strategy / Implementation 分层，' +
      '元素之间用结构关系（组合/聚合/赋值/实现）、依赖关系（服务/访问/影响/关联）与动态关系（触发/流）连接，并以「视图」组织。' +
      'ArchGraph 的意图图谱（SystemArchitecture.json）在 ArchiMate 之上做了扩展（ARGO），例如视图的 parent_element_id、' +
      '元素/视图的富文本描述与验收用例等。',
    docs: [
      {label: '建模总览', description: 'ArchiMate 在 ArchGraph 中的定位与用法', href: '/docs/archimate'},
      {label: '概念与关系', description: '元素分层、关系类型与建模要点', href: '/docs/archimate/concepts'},
      {label: '学习路径', description: '从零开始的 ArchiMate 学习路线', href: '/docs/archimate/learning'},
    ],
    external: {
      label: 'ArchiMate 3.2 规范（The Open Group）',
      href: 'https://pubs.opengroup.org/architecture/archimate3-doc/',
    },
  },
  {
    id: 'more',
    name: '更多本体（建设中）',
    version: '',
    summary: 'ArchGraph 支持接入其它本体（如安全、数据、流程等领域的专门本体）。',
    description:
      'ArchGraph 的图谱结构由工作区的 schema bundle 决定，并不绑定单一本体。' +
      '后续可按需引入新的本体（及其元素/关系类型体系与校验规则），在「本体货架」上一一登记。',
    docs: [],
    comingSoon: true,
  },
];

export function getOntology(id: string): Ontology | undefined {
  return ONTOLOGIES.find((o) => o.id === id);
}
