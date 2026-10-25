"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { PiCommandSettings as Settings } from "@/lib/pi-command";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

export function PiCommandSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = async (enabled?: boolean) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pi-command", enabled === undefined ? undefined : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
      setSettings(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void request(); }, []);
  return <div className="pi-command-settings">
    <div className="pi-command-setting-row">
      <div><span>{t("shell.externalPi")}</span><p id="external-pi-description" className="settings-general-description">{t(settings && !settings.supported ? "shell.externalPiUnsupported" : "shell.externalPiHint")}</p></div>
      <ConfigSwitch checked={settings?.enabled ?? true} disabled={disabled || !settings?.supported} loading={busy} label={t("shell.externalPi")} describedBy="external-pi-description" onChange={enabled => void request(enabled)} />
    </div>
    {settings?.supported && settings.enabled && !settings.registered && !error && <ConfigButton size="small" variant="ghost" disabled={busy || disabled} onClick={() => void request(true)}>{t("shell.externalPiRepair")}</ConfigButton>}
    {error && <p role="alert" className="settings-general-error">{error} <ConfigButton size="small" variant="ghost" disabled={busy} onClick={() => void request()}>{t("shell.refresh")}</ConfigButton></p>}
  </div>;
}
