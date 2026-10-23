export type ThemeTransitionOrigin = { x: number; y: number };

let active: { transition?: ViewTransition; animation?: Animation } | undefined;

/** 新选择覆盖旧动画；旧快照的异步回调不能再次修改主题。 */
export function cancelThemeTransition(): void {
  const previous = active;
  active = undefined;
  previous?.animation?.cancel();
  previous?.transition?.skipTransition();
  if (typeof document !== "undefined") delete document.documentElement.dataset.themeTransition;
}

export function runThemeTransition(apply: () => void, origin?: ThemeTransitionOrigin): void {
  cancelThemeTransition();
  const root = document.documentElement;
  if (typeof document.startViewTransition !== "function"
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }

  const current: NonNullable<typeof active> = {};
  active = current;
  // 原生标题栏据此延后同步颜色，直到网页扩散完成。
  root.dataset.themeTransition = "true";
  let applied = false;
  const commit = () => {
    if (active !== current || applied) return;
    applied = true;
    apply();
  };
  const finish = () => {
    if (active !== current) return;
    active = undefined;
    delete root.dataset.themeTransition;
  };
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  // 快照伪元素在桌面缩放下的像素坐标可能不同；百分比同时适配中心、半径与点击位置。
  const center = `${x / window.innerWidth * 100}% ${y / window.innerHeight * 100}%`;
  const radiusPercent = radius / (Math.hypot(window.innerWidth, window.innerHeight) / Math.SQRT2) * 100;

  try {
    const transition = document.startViewTransition(commit);
    current.transition = transition;
    void transition.ready.then(() => {
      if (active !== current) return;
      current.animation = root.animate({ clipPath: [
        `circle(0% at ${center})`, `circle(${radiusPercent}% at ${center})`,
      ] }, {
        duration: 450,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        pseudoElement: "::view-transition-new(root)",
      });
    }).catch(() => { /* 跳过或浏览器不支持快照时，仍保留选中的主题。 */ });
    void transition.finished.then(finish, finish);
  } catch {
    commit();
    finish();
  }
}
