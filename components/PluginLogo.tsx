"use client";
import { useState } from "react";
import { pluginLogoUrl } from "@/lib/plugin-presentation";

export function PluginLogo({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const safe = pluginLogoUrl(url);
  const initials = (name.replace(/^@/, "").split("/").pop() || "P").slice(0, 2).toUpperCase();
  return <span className="plugin-logo" aria-hidden="true">
    {(!safe || failed === safe || loaded !== safe) && <span>{initials}</span>}
    {safe && failed !== safe &&
    // eslint-disable-next-line @next/next/no-img-element -- 第三方插件图片可缺失，固定盒子及回退占位避免布局跳动。
      <img src={safe} alt="" className={loaded === safe ? "is-loaded" : undefined} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(safe)} onError={() => setFailed(safe)} />}
  </span>;
}
