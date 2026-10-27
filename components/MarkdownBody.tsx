"use client";

import { Children, createContext, isValidElement, memo, useContext, useMemo, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { isAudioPath, isVideoPath } from "@/lib/file-types";
import { isExternalMarkdownHref, markdownAppUrlTransform, markdownDocumentRehypePlugins, markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, markdownUserRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { splitMarkdownBlocks } from "@/lib/markdown-blocks";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { AssistantHeading } from "./AssistantHeading";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  /** 文档内部导航：相对路径及标题锚点留在阅读器内。 */
  onNavigateLink?: (href: string) => void;
  /** Render every line ending as a line break, for text the user typed. */
  keepLineBreaks?: boolean;
  /** 仅助手聊天正文启用，不影响技能文档、用户消息或文件预览。 */
  decorateHeadings?: boolean;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const mediaSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Markdown 图片语法引用音视频时改用播放器；文件接口已支持范围请求。
  const mediaPath = filePath ?? href?.split(/[?#]/, 1)[0] ?? "";
  const label = alt?.trim() ? alt : undefined;
  if (isAudioPath(mediaPath)) {
    return <audio controls preload="metadata" src={mediaSrc} aria-label={label} />;
  }
  if (isVideoPath(mediaPath)) {
    return <video controls playsInline preload="metadata" src={mediaSrc} aria-label={label} />;
  }
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={mediaSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  if (!mediaSrc || insideLink) return image;
  return (
    <ImagePreview src={mediaSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>
  );
}

interface MarkdownBlockProps {
  markdown: string;
  remarkPlugins: typeof markdownRemarkPlugins;
  urlTransform: typeof markdownUrlTransform;
  rehypePlugins: typeof markdownRehypePlugins;
  components: Components;
}

/** One parse; skipped while its text and renderers stay the same. */
const MarkdownBlock = memo(function MarkdownBlock({ markdown, remarkPlugins, urlTransform, rehypePlugins, components }: MarkdownBlockProps) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={urlTransform}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
});

export const MarkdownBody = memo(function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onNavigateLink, keepLineBreaks, decorateHeadings }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // A streaming reply grows by a few characters per chunk; parsing all of it
  // each time made a long reply quadratic. Its finished blocks keep their
  // parse and only the last is parsed again. A finished message is one block.
  const blocks = useMemo(
    () => (isStreaming ? splitMarkdownBlocks(normalizedMarkdown) : [normalizedMarkdown]),
    [isStreaming, normalizedMarkdown],
  );
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    p({ children, ...props }) {
      delete props.node;
      const parts = Children.toArray(children).filter((child) => typeof child !== "string" || child.trim());
      const standaloneLabel = decorateHeadings && parts.length === 1 && isValidElement(parts[0]) && parts[0].type === "strong";
      return <p {...props} className={standaloneLabel ? "markdown-section-label" : undefined}>{children}</p>;
    },
    h2({ children, ...props }) {
      delete props.node;
      return <h2 {...props}>{decorateHeadings ? <AssistantHeading>{children}</AssistantHeading> : children}</h2>;
    },
    code({ className, children, ...props }) {
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children ?? "");
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return (
            <MermaidBlock
              code={raw.replace(/\n$/, "")}
              isStreaming={isStreaming}
              defaultPreview
            />
          );
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      if (onNavigateLink && href && !isExternalMarkdownHref(href)) {
        // 省略 href，避免中键或新标签操作把文档相对路径解析成应用地址。
        const navigate = () => onNavigateLink(href);
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a {...props} role="link" tabIndex={0} onClick={navigate} onKeyDown={(event) => { if (event.key === "Enter") navigate(); }}>
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, parsePdfPageFragment(href) ?? undefined);
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
    },
    ol({ node, start, style, ...props }) {
      // An outside marker wider than the list's left padding is clipped by
      // .markdown-body's overflow-x, so the padding follows the largest number.
      const items = node?.children.filter((child) => child.type === "element" && child.tagName === "li").length ?? 0;
      const digits = String(Math.abs((start ?? 1) + Math.max(items, 1) - 1)).length;
      return <ol start={start} style={{ ...style, ["--ol-marker-digits" as string]: Math.max(digits, 2) }} {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile, onNavigateLink, decorateHeadings]);

  return (
    <div className={["markdown-body", decorateHeadings && "markdown-assistant-reply", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => (
        <MarkdownBlock
          key={index}
          markdown={block}
          remarkPlugins={keepLineBreaks ? markdownUserRemarkPlugins : markdownRemarkPlugins}
          urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
          rehypePlugins={onNavigateLink ? markdownDocumentRehypePlugins : markdownRehypePlugins}
          components={components}
        />
      ))}
    </div>
  );
});
