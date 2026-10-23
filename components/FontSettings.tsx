"use client";

import { useI18n } from "@/hooks/useI18n";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { FONT_FAMILY_MAX_LENGTH, FONT_WEIGHT_DEFAULT, FONT_WEIGHT_OPTIONS } from "@/lib/font-preferences";
import { ConfigButton } from "./SettingsUi";

const FONT_FIELDS = [
  { kind: "ui", label: "settings.uiFontFamily", placeholder: "settings.uiFontPlaceholder", reset: "settings.resetUiFont", weightLabel: "settings.uiFontWeight" },
  { kind: "mono", label: "settings.monoFontFamily", placeholder: "settings.monoFontPlaceholder", reset: "settings.resetMonoFont", weightLabel: "settings.monoFontWeight" },
] as const;

/** 名称、字重和重置放在同一行，输入内容同时预览所选字体。 */
export function FontSettings() {
  const { t } = useI18n();
  const fonts = useFontPreferences();

  // One grid for both rows, so the name fields start at the same x whatever the labels' widths.
  return <div className="settings-font-rows">{FONT_FIELDS.map(({ kind, label, placeholder, reset, weightLabel }) => {
    const weight = fonts[`${kind}Weight`];
    return (
      <div key={kind} className="settings-chat-option settings-chat-range-option settings-font-row">
        <div className="settings-chat-range-header settings-font-header">
          <label htmlFor={`settings-font-${kind}`}>{t(label)}</label>
          <input
            id={`settings-font-${kind}`}
            className={`settings-font-input${kind === "mono" ? " is-mono" : ""}`}
            type="text"
            value={fonts[kind]}
            placeholder={t(placeholder)}
            maxLength={FONT_FAMILY_MAX_LENGTH}
            aria-describedby="settings-typography-description"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => fonts.setFontPreference(kind, event.target.value)}
          />
          <select
            id={`settings-font-${kind}-weight`}
            className="settings-font-weight"
            value={weight}
            aria-label={t(weightLabel)}
            onChange={(event) => fonts.setFontWeight(kind, Number(event.target.value))}
          >
            {FONT_WEIGHT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)} · {option.value}</option>)}
          </select>
          <ConfigButton
            variant="ghost"
            size="small"
            className="settings-chat-reset"
            title={t(reset)}
            aria-label={t(reset)}
            disabled={!fonts[kind] && weight === FONT_WEIGHT_DEFAULT}
            onClick={() => fonts.resetFontPreference(kind)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
            </svg>
          </ConfigButton>
        </div>
      </div>
    );
  })}</div>;
}
