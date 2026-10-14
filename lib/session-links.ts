/**
 * 构造当前实例的会话链接，并保持普通点击在页内导航。
 * 保留来源和部署路径，仅保留 session 查询，清除其他查询和 hash。
 * 旧 cwd 会优先打开新输入框，必须去掉；明确 session 也优先于标签记忆。
 */

/** A same-instance link to one session; the id is encoded, never a URL of its own. */
export function sessionDeepLink(sessionId: string): string {
  return `?session=${encodeURIComponent(sessionId)}`;
}

export interface ActivationEvent {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * A primary-button click (or Enter on a focused link) without modifiers:
 * the page handles it in place. Anything else (Ctrl/Cmd, Shift, Alt, another
 * button) is the browser's: a new tab, a new window, a download, as the user
 * and the browser decide.
 */
export function isPlainActivation(event: ActivationEvent): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.altKey;
}
