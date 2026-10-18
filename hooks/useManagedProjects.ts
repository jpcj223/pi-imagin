"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyManagedProjects, type ManagedProjectState, type ProjectChange } from "@/lib/managed-projects-shared";

export function useManagedProjects(refreshKey?: number) {
  const [state, setState] = useState<ManagedProjectState>(emptyManagedProjects);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(false);
  const accept = useCallback((next: ManagedProjectState) => {
    if (mounted.current) setState(previous => next.revision >= previous.revision ? next : previous);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/projects", { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取项目失败");
      accept(data.state);
      if (mounted.current) setError(null);
    } catch (error) { if (!signal?.aborted && mounted.current) setError(String(error)); }
    finally { if (!signal?.aborted && mounted.current) setLoaded(true); }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const reload = () => { void refresh(controller.signal); };
    reload();
    window.addEventListener("focus", reload);
    window.addEventListener("pi-imagin:projects-changed", reload);
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("pi-imagin-projects") : null;
    if (channel) channel.onmessage = reload;
    return () => { mounted.current = false; controller.abort(); channel?.close(); window.removeEventListener("focus", reload); window.removeEventListener("pi-imagin:projects-changed", reload); };
  }, [refresh, refreshKey]);
  const change = useCallback(async (request: ProjectChange) => {
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保存项目失败");
    accept(data.state);
    window.dispatchEvent(new Event("pi-imagin:projects-changed"));
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("pi-imagin-projects");
      channel.postMessage("changed");channel.close();
    }
    return data.state as ManagedProjectState;
  }, [accept]);
  return { state, error, loaded, refresh, change };
}
