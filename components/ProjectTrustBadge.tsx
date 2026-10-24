"use client";

import { useI18n } from "@/hooks/useI18n";
import type { ProjectTrustStatus } from "@/lib/api-types";

/** 主页、插件和技能共用状态入口，详细原因由现有信任对话框说明。 */
export function ProjectTrustBadge({ status, onClick }: { status?: ProjectTrustStatus | null; onClick?: () => void }) {
  const { t } = useI18n();
  if (!status?.requiresTrust || status.trusted || status.defaultWorkspace) return null;
  return <button type="button" className="project-trust-badge" onClick={onClick} title={t("trust.resourcesNotLoaded")} aria-label={t("trust.resourcesNotLoaded")}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="M12 8v4M12 16h.01" /></svg>
    <span>{t("trust.resourcesNotLoaded")}</span>
  </button>;
}
