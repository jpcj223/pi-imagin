"use client";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const schema = { ...defaultSchema, strip: [...(defaultSchema.strip ?? []), "script", "iframe", "style", "form", "input", "button", "object"] };
// 外部说明不能访问本地文件接口、应用深链或执行事件；相对地址落在公开来源。
function sourceUrl(value: string, base: string): string {
  try { const url = new URL(value, base); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}

export function PublicCatalogReadme({ html, base }: { html: string; base: string }) {
  return <div className="plugin-readme"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]} urlTransform={value => sourceUrl(value, base)} components={{
      a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      // eslint-disable-next-line @next/next/no-img-element -- 公开说明图片不经过本地文件或优化代理。
      img: ({ src, alt }) => typeof src === "string" && /^https:\/\//.test(src) ? <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt}</span>,
    }}>{html}</ReactMarkdown></div>;
}
