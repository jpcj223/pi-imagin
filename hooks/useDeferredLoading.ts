"use client";

import { useEffect, useState } from "react";

/** 只延后视觉提示，不延后请求、结果或操作保护。 */
export function useDeferredLoading(pending: boolean, delay = 200): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [pending, delay]);
  return pending && visible;
}
