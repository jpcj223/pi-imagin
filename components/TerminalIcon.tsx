import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  down: <path d="m6 9 6 6 6-6" />,
  up: <path d="m6 15 6-6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  more: <><circle cx="5" cy="12" r=".8" /><circle cx="12" cy="12" r=".8" /><circle cx="19" cy="12" r=".8" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />,
  restore: <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5" />,
  restart: <><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" /></>,
  clear: <><path d="m9 4 11 11-6 6H8l-5-5L15 4M8 21h13M7 12l8 8" /></>,
  duplicate: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>,
  cmd: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
  powershell: <><path d="M6 4h15l-3 16H3L6 4Z" /><path d="m9 8 4 4-5 4m5 0h3" /></>,
  bash: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M11 8H9a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4H8m2-9v10m5-1h3" /></>,
  linux: <><path d="M8 10V7a4 4 0 0 1 8 0v3l3 8-4 3-3-2-3 2-4-3 3-8Z" /><path d="m10 11 2 2 2-2M10 8h.01M14 8h.01" /></>,
};

export function TerminalIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
