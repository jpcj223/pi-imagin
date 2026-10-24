"use client";
import { useI18n } from "@/hooks/useI18n";
import type { TerminalSearchOptions } from "@/lib/terminal-search";

/** 区域查找与会话检索使用相同的三个可组合匹配开关。 */
export function FindOptions({ value, onChange }: { value: TerminalSearchOptions; onChange: (value: TerminalSearchOptions) => void }) {
  const { t } = useI18n();
  return <span className="find-options">{([['caseSensitive', 'Aa'], ['wholeWord', 'ab'], ['regex', '.*']] as const).map(([key, text]) => <button type="button" key={key} className={`terminal-search-option is-${key}`} title={t(`terminal.${key}`)} aria-label={t(`terminal.${key}`)} aria-pressed={Boolean(value[key])} onClick={() => onChange({ ...value, [key]: !value[key] })}>{text}</button>)}</span>;
}
