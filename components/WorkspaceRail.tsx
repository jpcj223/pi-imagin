"use client";

export function WorkspaceRail({ onHome }: { onHome: () => void }) {
  return <nav className="workspace-rail" aria-label="全局导航">
    <button type="button" className="workspace-home" onClick={onHome} aria-label="主页" aria-current="page" title="主页">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>
    </button>
  </nav>;
}
