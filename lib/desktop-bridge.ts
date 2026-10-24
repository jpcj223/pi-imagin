declare global {
  interface Window {
    piImaginDesktop?: {
      chooseDirectory(): Promise<string | null>;
      chooseExecutable?(): Promise<string | null>;
    };
  }
}

export async function chooseDesktopExecutable(): Promise<string | null | undefined> {
  if (typeof window === "undefined") return undefined;
  return window.piImaginDesktop?.chooseExecutable?.();
}

/** 原生选择只提供路径，调用方仍须经过现有目录验证和授权。 */
export async function chooseDesktopDirectory(): Promise<string | null | undefined> {
  if (typeof window === "undefined" || !window.piImaginDesktop) return undefined;
  return window.piImaginDesktop.chooseDirectory();
}
