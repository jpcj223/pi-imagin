"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { useI18n } from "@/hooks/useI18n";
import type { SkillInfo, SkillInstallScope } from "@/lib/api-types";
import type { CatalogSkill, CatalogSkillDetail, SkillCatalogPage } from "@/lib/skill-catalog-types";
import { loadBrowserSkillPage, peekSkillPage, loadBrowserSkillDetail, peekCatalogSkillDetail, loadInstalledSkillContent } from "@/lib/skills-browser-cache";
import { ResourcePath } from "./ResourcePath";
import { findInstalledCatalogSkill } from "@/lib/skill-selection";
import { ConfigButton, ConfigSaveTarget } from "./SettingsUi";
import { useInstallTasks } from "@/hooks/useInstallTasks";
import { PublicCatalogReadme } from "./PublicCatalogReadme";

function CatalogDetail({ skill }: { skill: CatalogSkill }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<CatalogSkillDetail | null>(() => peekCatalogSkillDetail(skill.package) ?? null);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    void loadBrowserSkillDetail(skill, controller.signal, attempt > 0).then(value => { if (!controller.signal.aborted) setData(value); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [skill, attempt]);
  return <div className="skills-catalog-detail">
    <div className="skills-catalog-detail-heading"><div><div className="resource-name-row"><h3>{skill.name}</h3><CopyButton value={skill.name} /></div><p>{skill.source}</p></div></div>
    <div className="skills-detail-meta"><span>{t("skills.catalog.installs", { count: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(skill.installs) })}</span>{data?.documentPath && <span>{data.documentPath}</span>}</div>
    {data?.description && <p className="skills-detail-description">{data.description}</p>}
    {error ? <div role="alert" className="skills-catalog-state"><p>{t("skills.catalog.detailFailed")}</p><ConfigButton onClick={() => setAttempt(value => value + 1)}>{t("plugins.retry")}</ConfigButton></div> : !data && <p role="status">{t("i18n.loading")}</p>}
    {data?.truncated && <div className="skills-detail-preview" role="status"><p>{t(data.fullUnavailable ? "skills.detail.fullUnavailable" : "skills.catalog.preview")}</p><ConfigButton size="small" onClick={() => setAttempt(value => value + 1)}>{t("plugins.retry")}</ConfigButton></div>}
    {data && <PublicCatalogReadme html={data.markdown ?? data.readmeHtml} base={data.documentUrl ?? skill.url} />}
  </div>;
}

export function SkillCatalog({ cwd, targetScope, targetPending = false, renderInstallTarget, installedPackages, projectResourcesLoaded, onInstalled, active, sectionActive, navigation, globalSkillsPath, installedSkills, onOpenInstalled, resetKey = 0 }: {
  cwd: string | null;
  targetScope?: SkillInstallScope;
  targetPending?: boolean;
  renderInstallTarget?: (path?: string, state?: { loading?: boolean; busy?: boolean }) => ReactNode;
  installedSkills: readonly SkillInfo[];
  onOpenInstalled: (filePath: string) => void;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  onInstalled: () => Promise<unknown>;
  active: boolean;
  sectionActive: boolean;
  navigation?: ReactNode;
  globalSkillsPath: string;
  resetKey?: number;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState(""), [term, setTerm] = useState("");
  const [page, setPage] = useState<SkillCatalogPage | null>(() => peekSkillPage() ?? null);
  const [items, setItems] = useState<CatalogSkill[]>(() => peekSkillPage()?.items ?? []);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const tasks = useInstallTasks();
  const installKey = (skill: CatalogSkill) => JSON.stringify([cwd, scope, skill.package]);
  const [localScope, setScope] = useState<SkillInstallScope>("global");
  const scope = targetScope ?? localScope;
  const [detail, setDetail] = useState<CatalogSkill | null>(null);
  const scroller = useRef<HTMLDivElement>(null), sentinel = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null), inFlight = useRef(false);
  const lastRequest = useRef({ number: 0, append: false });
  const scrollPosition = useRef(0);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null), warming = useRef(false);
  useEffect(() => { if (sectionActive) setDetail(null); }, [sectionActive, resetKey]);
  useEffect(() => { if (!cwd || !projectResourcesLoaded) setScope("global"); }, [cwd, projectResourcesLoaded]);
  useLayoutEffect(() => { if (active && !detail && scroller.current) scroller.current.scrollTop = scrollPosition.current; }, [active, detail]);
  useEffect(() => { const timer = setTimeout(() => setTerm(query.trim()), query.trim() ? 350 : 0); return () => clearTimeout(timer); }, [query]);

  const load = useCallback((number: number, append: boolean, force = false) => {
    request.current?.abort();
    lastRequest.current = { number, append };
    const controller = new AbortController(); request.current = controller;
    inFlight.current = true; setLoading(true); setError(false);
    if (!append) {
      const cached = peekSkillPage(term); setPage(cached ?? null); setItems(cached?.items ?? []);
      scrollPosition.current = 0;
      if (scroller.current) scroller.current.scrollTop = 0;
    }
    void loadBrowserSkillPage(term, number, controller.signal, force).then(data => {
      if (controller.signal.aborted) return;
      setPage(data);
      setItems(previous => append ? [...previous, ...data.items.filter(item => !previous.some(entry => entry.package === item.package))] : data.items);
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => {
      if (!controller.signal.aborted) { inFlight.current = false; setLoading(false); }
    });
  }, [term]);
  useEffect(() => { load(0, false); return () => request.current?.abort(); }, [load]);
  useEffect(() => () => { if (warmTimer.current) clearTimeout(warmTimer.current); }, []);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !active || detail || loading || error || !page?.hasNext || term !== query.trim()) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !inFlight.current) load(page.page + 1, true);
    }, { root: scroller.current, rootMargin: "600px" });
    observer.observe(target); return () => observer.disconnect();
  }, [active, detail, loading, error, page, term, query, load]);

  const openSkill = (skill: CatalogSkill) => {
    const local = findInstalledCatalogSkill(installedSkills, skill.package, scope);
    if (local) { setDetail(null); onOpenInstalled(local.filePath); }
    else setDetail(skill);
    stopWarm();
  };
  useEffect(() => {
    if (!detail) return;
    const local = findInstalledCatalogSkill(installedSkills, detail.package, scope);
    if (local) { setDetail(null); onOpenInstalled(local.filePath); }
  }, [detail, installedSkills, scope, onOpenInstalled]);
  const isInstalled = (skill: CatalogSkill) => installedPackages[scope].has(skill.package) || (scope === "project" && installedPackages.global.has(skill.package));
  const install = async (skill: CatalogSkill) => {
    if (targetPending || !skill.source.includes("/") || isInstalled(skill) || (scope === "project" && !projectResourcesLoaded)) return;
    const targetScope = scope, targetCwd = cwd;
    await tasks.run(`${targetScope}:${skill.package}`, async () => {
      const response = await fetch("/api/skills/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: skill.package, scope: targetScope, cwd: targetCwd }) });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await onInstalled();
    });
  };
  const warm = (skill: CatalogSkill) => {
    if (warmTimer.current) clearTimeout(warmTimer.current);
    warmTimer.current = setTimeout(() => {
      if (warming.current) return;
      warming.current = true;
      const local = findInstalledCatalogSkill(installedSkills, skill.package, scope);
      const pending = local ? loadInstalledSkillContent(cwd, local.filePath) : loadBrowserSkillDetail(skill);
      void pending.catch(() => {}).finally(() => { warming.current = false; });
    }, 180);
  };
  const stopWarm = () => { if (warmTimer.current) clearTimeout(warmTimer.current); };
  return <div className="skills-catalog">
    <div className="skills-catalog-tools">
      {detail ? <div className="skills-detail-toolbar">{navigation}<ConfigButton size="small" onClick={() => setDetail(null)}>{t("resources.back")}</ConfigButton><a href={detail.url} target="_blank" rel="noopener noreferrer">skills.sh ↗</a>{detail.source.includes("/") && <ConfigButton variant="primary" onClick={() => void install(detail)} disabled={targetPending || isInstalled(detail) || tasks.pending.has(installKey(detail)) || (scope === "project" && !projectResourcesLoaded)}>{isInstalled(detail) ? t("i18n.installed") : tasks.pending.has(installKey(detail)) ? t("i18n.installing") : t("i18n.install")}</ConfigButton>}</div> : <>
      <div className="skills-directory-toolbar"><div className="skills-mobile-navigation">{navigation}</div><a href="https://skills.sh" target="_blank" rel="noopener noreferrer">skills.sh ↗</a></div>
      <header className="skills-catalog-heading resource-catalog-heading"><div><h2>{t("skills.catalog.title")}</h2><p>{t("skills.catalog.intro")}</p></div>
      <form className="skills-catalog-search resource-catalog-search" onSubmit={event => { event.preventDefault(); if (term === query.trim()) load(0, false, true); else setTerm(query.trim()); setDetail(null); }}>
        <input className="plugins-search-input" type="search" aria-label={t("skills.catalog.search")} placeholder={t("skills.catalog.search")} value={query} maxLength={150} onChange={event => setQuery(event.target.value)} />
      </form></header>
      <div className="skills-catalog-options">{renderInstallTarget ? renderInstallTarget(scope === "global" ? globalSkillsPath : `${cwd ?? ""}/.pi/skills/`, { busy: tasks.pending.size > 0 }) : <ConfigSaveTarget value={scope} label={t("config.saveTo")} options={[
        { value: "global", label: t("skills.scope.global") }, { value: "project", label: t("skills.scope.project"), disabled: !cwd || !projectResourcesLoaded },
      ]} path={<ResourcePath path={scope === "global" ? globalSkillsPath : `${cwd ?? ""}/.pi/skills/`} />} disabledReason={t(cwd ? "trust.projectScopeUnavailable" : "settings.projectRequired")} onChange={setScope} />}
      <p className="skills-catalog-summary" role="status">{t("skills.catalog.count", { count: items.length, total: page?.total ?? "…" })}{loading && items.length > 0 ? ` · ${t("i18n.loading")}` : ""}</p></div>
      </>}
      {detail && renderInstallTarget && <div className="skills-catalog-options">{renderInstallTarget(scope === "global" ? globalSkillsPath : `${cwd ?? ""}/.pi/skills/`, { busy: tasks.pending.size > 0 })}</div>}
      {detail && !isInstalled(detail) && tasks.errors[installKey(detail)] && <div role="alert" className="skills-catalog-error">{tasks.errors[installKey(detail)]}</div>}
    </div>
    <div className="skills-catalog-scroll" ref={scroller} hidden={detail !== null} onScroll={event => { if (active && !detail && event.currentTarget.clientHeight > 0) scrollPosition.current = event.currentTarget.scrollTop; }}>

      <div className="skills-card-grid" aria-busy={loading}>
        {items.map(skill => <article className="skills-catalog-card" key={skill.package}>
          <button type="button" className="skills-card-open" onClick={() => openSkill(skill)} onPointerEnter={() => warm(skill)} onPointerLeave={stopWarm} onFocus={() => warm(skill)} onBlur={stopWarm}>
            <span className="skills-card-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg></span>
            <span className="skills-card-name">{skill.name}</span>
            <span className="skills-card-source">{skill.source}</span>
          </button>
          <div className="skills-card-footer"><span>{t("skills.catalog.installs", { count: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(skill.installs) })}</span>{skill.source.includes("/") ? <ConfigButton size="small" onClick={() => void install(skill)} disabled={targetPending || isInstalled(skill) || tasks.pending.has(installKey(skill)) || (scope === "project" && !projectResourcesLoaded)}>{isInstalled(skill) ? t("i18n.installed") : tasks.pending.has(installKey(skill)) ? t("i18n.installing") : t("i18n.install")}</ConfigButton> : <a href={skill.url} target="_blank" rel="noopener noreferrer">{t("skills.catalog.external")} ↗</a>}</div>
          {!isInstalled(skill) && tasks.errors[installKey(skill)] && <p role="alert" className="skills-install-error">{tasks.errors[installKey(skill)]}</p>}
        </article>)}
      </div>
      <div className="skills-catalog-state" ref={sentinel}>
        {loading && <p role="status">{t("i18n.loading")}</p>}
        {error && <div role="alert"><p>{t("skills.catalog.failed")}</p><ConfigButton onClick={() => load(lastRequest.current.number, lastRequest.current.append, true)}>{t("plugins.retry")}</ConfigButton></div>}
        {!loading && !error && (items.length === 0 ? <p>{t("skills.catalog.empty")}</p> : page?.searchLimited ? <p>{t("skills.catalog.limited")}</p> : !page?.hasNext ? <p>{t("plugins.allLoaded")}</p> : <ConfigButton onClick={() => load(page.page + 1, true)}>{t("plugins.loadMore")}</ConfigButton>)}
      </div>
    </div>
    {detail && <div className="skills-catalog-scroll"><CatalogDetail key={detail.package} skill={detail} /></div>}
  </div>;
}
