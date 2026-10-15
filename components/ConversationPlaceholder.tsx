/** 保持标题、正文与输入区的占位，加载期间不显示会跳位的空白页。 */
export function ConversationPlaceholder({ heading = false }: { heading?: boolean }) {
  return <div className="workspace-conversation-loading" role="status" aria-label="正在恢复会话" aria-busy="true">
    {heading && <div className="workspace-loading-heading"><i /><i /></div>}
    <div className="workspace-loading-messages" aria-hidden="true"><i className="workspace-loading-user" /><i /><i /><i /><i /><i /></div>
    <div className="workspace-loading-composer" aria-hidden="true"><i /><span>正在恢复会话…</span></div>
  </div>;
}
