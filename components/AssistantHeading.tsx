import { Children, isValidElement, type ReactNode } from "react";
import { SectionIcon } from "./SidebarIcons";

function headingText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? headingText(child.props.children) : "";
  }).join("");
}

/** 仅装饰显示结果，图标不进入标题文本、复制内容或目录定位索引。 */
export function AssistantHeading({ children }: { children: ReactNode }) {
  const text = headingText(children);
  const hasEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(text);
  // 流式输出可能暂时只有 Emoji 的高代理项，先不显示额外图标。
  const partialEmoji = /[\uD800-\uDBFF]$/.test(text);
  return <>{text.trim() && !hasEmoji && !partialEmoji && <SectionIcon className="assistant-heading-icon" size={16} />}{children}</>;
}
