"use client";

import {useEffect, useId, useMemo, useRef, useState, type CSSProperties} from "react";
import {useI18n} from "@/hooks/useI18n";

interface Candidate { id: string; name?: string }

/** 仅提供 ID 候选，不修改名称、能力、价格或保存状态。 */
export function ModelIdInput({value, onChange, providerName, provider, existingModels, style}: {
  value: string;
  onChange: (id: string) => void;
  providerName: string;
  provider: object;
  existingModels: Candidate[];
  style: CSSProperties;
}) {
  const {t} = useI18n();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [discovered, setDiscovered] = useState<Candidate[]>([]);
  // 输入 ID 只改变 models；不能因此反复获取供应商列表。
  const connection = JSON.stringify({...provider, models: undefined});

  useEffect(() => {
    requestRef.current?.abort();
    loadedRef.current = false;
    setDiscovered([]);
    setPhase("idle");
    setOpen(false);
    setQuery("");
    setActive(-1);
    return () => requestRef.current?.abort();
  }, [providerName, connection]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const candidates = useMemo(() => {
    const unique = new Map<string, Candidate>();
    for (const model of [...discovered, ...existingModels]) {
      if (typeof model.id === "string" && model.id.trim() && !unique.has(model.id)) unique.set(model.id, model);
    }
    const filter = query.trim().toLocaleLowerCase();
    return [...unique.values()].filter(model => !filter || `${model.id} ${model.name ?? ""}`.toLocaleLowerCase().includes(filter));
  }, [discovered, existingModels, query]);

  useEffect(() => {setActive(-1);}, [value, discovered]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({block: "nearest"});
  }, [active, listId, open]);

  const load = async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setPhase("loading");
    try {
      const response = await fetch("/api/models-config/discover", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({providerName, provider: JSON.parse(connection)}), signal: controller.signal,
      });
      const data = await response.json() as {models?: Candidate[]; error?: string};
      if (controller.signal.aborted) return;
      if (!response.ok || data.error || !Array.isArray(data.models)) throw new Error("discovery");
      setDiscovered(data.models.filter(model => model && typeof model.id === "string"));
      setPhase("ready");
    } catch {
      if (!controller.signal.aborted) setPhase("error");
    }
  };
  const show = () => {
    if (!open) {setQuery(""); setActive(-1);}
    setOpen(true); void load();
  };
  const choose = (model: Candidate) => {onChange(model.id); setOpen(false); setActive(-1);};

  return (
    <div ref={rootRef} className="model-id-combobox" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <input role="combobox" aria-label="ID" aria-autocomplete="list" aria-expanded={open}
        aria-controls={listId} aria-activedescendant={open && active >= 0 && candidates[active] ? `${listId}-${active}` : undefined}
        value={value} placeholder="model-id" autoComplete="off" spellCheck={false}
        style={{...style, fontFamily: "var(--font-mono)"}}
        onFocus={show} onClick={show} onChange={event => {onChange(event.target.value); setQuery(event.target.value); setOpen(true);}}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
            if (!open) return;
            setActive(index => candidates.length ? (index + (event.key === "ArrowDown" ? 1 : index < 0 ? 0 : -1) + candidates.length) % candidates.length : -1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false);
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (active >= 0 && candidates[active]) choose(candidates[active]);
            else setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
        }} />
      {open && <div className="model-id-popup">
        <div id={listId} role="listbox" aria-label={t("models.idOptions")} className="model-id-options">
          {candidates.map((model, index) => (
            <button type="button" role="option" id={`${listId}-${index}`} key={model.id} tabIndex={-1}
              aria-selected={model.id === value} data-active={active === index || undefined}
              title={model.id} onMouseDown={event => event.preventDefault()} onClick={() => choose(model)}>
              <code>{model.id}</code>
              {model.name && model.name !== model.id && <span>{model.name}</span>}
            </button>
          ))}
          {candidates.length === 0 && <div className="model-id-status" role="status">{t(phase === "loading" ? "i18n.loading" : "models.idNoMatches")}</div>}
        </div>
        <div className="model-id-status" role="status">
          <span>{t(phase === "error" ? "models.idLoadFailed" : phase === "loading" ? "i18n.loading" : "models.idManualAllowed")}</span>
          {phase === "error" && <button type="button" onClick={() => {loadedRef.current = false; void load();}}>{t("i18n.refresh")}</button>}
        </div>
      </div>}
    </div>
  );
}
