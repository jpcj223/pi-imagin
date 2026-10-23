"use client";

import { useI18n } from "@/hooks/useI18n";

export function PluginDescription({ text }: { text?: string }) {
  const { t } = useI18n();
  return <div className="plugin-description"><p>{text || t("plugins.noDescription")}</p></div>;
}
