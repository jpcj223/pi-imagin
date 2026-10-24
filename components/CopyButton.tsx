"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/** 名称和路径共用的轻量复制按钮，不触发父级导航或拖动。 */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => { if (status === "idle") return; const timer = setTimeout(() => setStatus("idle"), 1800); return () => clearTimeout(timer); }, [status]);
  const message = t(status === "copied" ? "resourcePath.copied" : status === "failed" ? "resourcePath.copyFailed" : "resources.copyName");
  return <span className="resource-copy-control"><button type="button" className="resource-copy-button" aria-label={label ?? t("resources.copyName")} title={status === "idle" ? label ?? message : message} onPointerDown={event => event.stopPropagation()} onClick={async event => {
    event.stopPropagation();
    try { await navigator.clipboard.writeText(value); setStatus("copied"); } catch { setStatus("failed"); }
  }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{status === "copied" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}</svg></button><span className="sr-only" role="status">{status === "idle" ? "" : message}</span></span>;
}
