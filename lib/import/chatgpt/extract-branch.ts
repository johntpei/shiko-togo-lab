import type { ChatGptConversation, ChatGptMappingNode } from "./types";

export function extractCurrentBranch(
  conversation: ChatGptConversation,
): ChatGptMappingNode[] {
  const mapping = conversation.mapping;
  if (!mapping) {
    return [];
  }

  let nodeId = conversation.current_node ?? null;
  const chain: ChatGptMappingNode[] = [];
  const seen = new Set<string>();

  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = mapping[nodeId];
    if (!node) {
      break;
    }
    chain.push(node);
    nodeId = node.parent ?? null;
  }

  return chain.reverse();
}
