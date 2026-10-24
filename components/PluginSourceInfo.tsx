"use client";

import { PublicCatalogReadme } from "./PublicCatalogReadme";
import type { PluginSourceDetail } from "@/lib/plugin-detail";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "./SettingsUi";

export function PluginSourceInfo({ data, loading, error, retry }: { data: PluginSourceDetail | null; loading: boolean; error: boolean; retry: () => void }) {
  const { t } = useI18n();
  if (loading && !data) return <div className="plugins-state" role="status">{t("plugins.loadingDetail")}</div>;
  if (!data) return <div className="plugins-state" role="alert"><p>{t("plugins.detailFailed")}</p><ConfigButton onClick={retry}>{t("plugins.retry")}</ConfigButton></div>;
  const base = data.homepage ?? data.repository ?? `https://pi.dev/packages/${data.name}`;
  const fields: [string, string | undefined][] = [["plugins.sourceVersion", data.version], ["plugins.author", data.author], ["plugins.published", data.published], ["plugins.license", data.license], ["plugins.dependencies", data.dependencies]];
  return <section className="plugin-source-info">
    {(error || data.partial) && <p className="plugins-action-error" role="status">{t("plugins.partialDetail")} <button type="button" onClick={retry}>{t("plugins.retry")}</button></p>}
    <dl className="plugin-metadata">{fields.filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}
      {data.engines && Object.keys(data.engines).length > 0 && <div><dt>{t("plugins.runtimeRequirements")}</dt><dd>{Object.entries(data.engines).map(([engine, version]) => `${engine} ${version}`).join(" · ")}</dd></div>}
    </dl>
    <div className="plugin-source-links">
      <a href={`https://pi.dev/packages/${data.name}`} target="_blank" rel="noopener noreferrer">{t("plugins.catalogSource")} ↗</a>
      {data.repository && <a href={data.repository} target="_blank" rel="noopener noreferrer">{t("plugins.repository")} ↗</a>}
      {data.homepage && <a href={data.homepage} target="_blank" rel="noopener noreferrer">{t("plugins.homepage")} ↗</a>}
    </div>
    <h3>{t("plugins.documentation")}</h3>
    {data.readmeTruncated && <p className="plugins-resource-note">{t("plugins.documentationLimited")}</p>}
    {data.readmeHtml ? <PublicCatalogReadme html={data.readmeHtml} base={base} /> : <p className="plugins-resource-note">{t("plugins.noDocumentation")}</p>}
  </section>;
}
