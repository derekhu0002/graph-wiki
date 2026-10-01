export type L10n = {en: string; zh: string};

export type OntologyDocLink = {
  label: L10n;
  description?: L10n;
  href: string;
};

export type Ontology = {
  id: string;
  name: string;
  version: string;
  summary: L10n;
  description: L10n;
  docs: OntologyDocLink[];
  external?: {label: L10n; href: string};
  comingSoon?: boolean;
};

export const ONTOLOGIES: Ontology[] = [
  {
    id: 'archimate',
    name: 'ArchiMate',
    version: '3.2',
    summary: {
      en: 'The enterprise-architecture modeling language: one vocabulary for business, application and technology structure and relationships.',
      zh: '企业架构建模语言：用一套统一语言描述业务、应用、技术各层的结构与关系。',
    },
    description: {
      en: 'ArchiMate is The Open Group standard for enterprise architecture. ArchGraph uses ArchiMate 3.2 as its base ontology: elements are organized across Business / Application / Technology / Motivation / Strategy / Implementation layers, connected by structural (composition/aggregation/assignment/realization), dependency (serving/access/influence/association) and dynamic (triggering/flow) relationships, and organized into views. ArchGraph extends it (ARGO): view parent_element_id, rich element/view descriptions and acceptance cases.',
      zh: 'ArchiMate 是由 The Open Group 定义的企业架构建模语言。ArchGraph 以 ArchiMate 3.2 作为基础本体：要素按 Business / Application / Technology / Motivation / Strategy / Implementation 分层，元素之间用结构关系（组合/聚合/赋值/实现）、依赖关系（服务/访问/影响/关联）与动态关系（触发/流）连接，并以「视图」组织。ArchGraph 在其上做了扩展（ARGO）：视图的 parent_element_id、元素/视图的富文本描述与验收用例等。',
    },
    docs: [
      {label: {en: 'Modeling overview', zh: '建模总览'}, description: {en: 'ArchiMate in ArchGraph', zh: 'ArchiMate 在 ArchGraph 中的定位与用法'}, href: '/docs/archimate'},
      {label: {en: 'Concepts & relationships', zh: '概念与关系'}, description: {en: 'Layers, elements, relationships', zh: '元素分层、关系类型与建模要点'}, href: '/docs/archimate/concepts'},
      {label: {en: 'Learning path', zh: '学习路径'}, description: {en: 'A path from zero', zh: '从零开始的 ArchiMate 学习路线'}, href: '/docs/archimate/learning'},
    ],
    external: {label: {en: 'ArchiMate 3.2 specification (The Open Group)', zh: 'ArchiMate 3.2 规范（The Open Group）'}, href: 'https://pubs.opengroup.org/architecture/archimate3-doc/'},
  },
  {
    id: 'more',
    name: 'More ontologies',
    version: '',
    summary: {
      en: 'ArchGraph can host other ontologies (security, data, process…).',
      zh: 'ArchGraph 支持接入其它本体（如安全、数据、流程等领域的专门本体）。',
    },
    description: {
      en: 'A graph is defined by its workspace schema bundle and is not bound to a single ontology. New ontologies (with their element/relationship types and validation rules) can be registered on the shelf over time.',
      zh: '图谱结构由工作区的 schema bundle 决定，并不绑定单一本体。后续可按需引入新的本体（及其元素/关系类型体系与校验规则），在「本体货架」上一一登记。',
    },
    docs: [],
    comingSoon: true,
  },
];

export function getOntology(id: string): Ontology | undefined {
  return ONTOLOGIES.find((o) => o.id === id);
}
