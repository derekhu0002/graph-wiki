export type GraphElement = {
  id: string;
  name: string;
  type: string;
  description?: string;
};

export type GraphRelationship = {
  id: string;
  name: string;
  type: string;
  source_id: string;
  target_id: string;
  source_name?: string;
  target_name?: string;
  statement?: string;
  description?: string;
};

export type GraphView = {
  view_id: string;
  view_name: string;
  parent_element_id?: string;
  parent_element_name?: string;
  description?: string;
  included_elements?: string[];
  included_relationships?: string[];
};

export type ArchGraph = {
  name: string;
  description: string;
  elements: GraphElement[];
  relationships: GraphRelationship[];
  views: GraphView[];
};

export type GraphAssetMeta = {
  id: string;
  name: string;
  version: string;
  sourceRepo: string;
  sourceCommit: string;
  description: string;
  stats?: {elements?: number; relationships?: number; views?: number};
};

const MCP_URL = '/mcp';

export async function mcpCall(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: {name, arguments: args}}),
  });
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text;
  if (!text) throw new Error('MCP call failed');
  const parsed = JSON.parse(text);
  if (parsed.status === 'failed') throw new Error(parsed.error || parsed.reason || 'MCP tool failed');
  return parsed;
}

export async function graphList(): Promise<GraphAssetMeta[]> {
  const r = await mcpCall('graph_list', {});
  return r.graphs || [];
}

export async function graphGet(id: string): Promise<{asset: GraphAssetMeta; graph: ArchGraph}> {
  const r = await mcpCall('graph_get', {id});
  return {asset: r.asset, graph: r.content};
}
