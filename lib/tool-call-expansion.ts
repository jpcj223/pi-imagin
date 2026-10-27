/** 按 toolCallId 保存工具卡片展开状态，使流式结束、文件重读和移入过程详情时保持用户选择。 */
const expandedToolCalls = new Set<string>();

export function isToolCallExpanded(toolCallId: string | undefined): boolean {
  return toolCallId !== undefined && expandedToolCalls.has(toolCallId);
}

export function setToolCallExpanded(toolCallId: string | undefined, expanded: boolean): void {
  if (!toolCallId) return;
  if (expanded) expandedToolCalls.add(toolCallId);
  else expandedToolCalls.delete(toolCallId);
}

export function clearExpandedToolCalls(): void {
  expandedToolCalls.clear();
}
