"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * 会话下方文件区布局中的侧栏标题。
 * 点击后以字符变化动画显示应用和 pi 版本；停留指定时间或再次点击后恢复名称。
 */

export const BRAND_TEXT = "Pi Imagin";
/**
 * 版本显示停留时间，从首次点击开始计时。
 */
export const VERSION_SHOWN_MS = 3000;
/**
 * 每个字符从左到右稳定所需的动画帧数。
 */
export const SCRAMBLE_FRAMES_PER_CHAR = 4;
export const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

/**
 * 标题显示的版本格式，例如 0.11.0p1.1.0。
 */
export function brandVersionText(appVersion: string | undefined, piVersion: string | undefined): string {
  return `${appVersion ?? "0.0.0"}p${piVersion ?? "0.0.0"}`;
}

/**
 * 计算目标文字完成变化动画需要的帧数。
 */
export function scrambleFrameCount(target: string): number {
  return target.length * SCRAMBLE_FRAMES_PER_CHAR;
}

/**
 * 生成指定帧的动画文字：保留空格，逐字从左到右固定，其余字符随机。
 * 最终帧及之后返回原目标，全过程长度不变，等宽字体下宽度保持稳定。
 */
export function scrambleFrame(target: string, frame: number, random: () => number = Math.random): string {
  const total = scrambleFrameCount(target);
  if (frame >= total) return target;
  const settled = Math.floor((frame / total) * target.length);
  let text = "";
  for (let index = 0; index < target.length; index++) {
    const char = target[index];
    text += char === " " || index < settled ? char : SCRAMBLE_CHARS[Math.floor(random() * SCRAMBLE_CHARS.length)];
  }
  return text;
}

/**
 * 目标变化时播放逐帧动画，首次挂载不播放。
 * 用户偏好减少动态效果时立即切换为最终文字。
 */
function useScramble(target: string): string {
  const [text, setText] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (shownRef.current === target) return;
    shownRef.current = target;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setText(target);
      return;
    }
    const totalFrames = scrambleFrameCount(target);
    let frame = 0;
    let request = 0;
    const step = () => {
      frame += 1;
      setText(scrambleFrame(target, frame));
      if (frame < totalFrames) request = requestAnimationFrame(step);
    };
    // 立即采用新文字长度，在绘制前让标题行重新适配。
    setText(scrambleFrame(target, 0));
    request = requestAnimationFrame(step);
    return () => cancelAnimationFrame(request);
  }, [target]);
  return text;
}

export function PiImaginTitle({ onWidthChange }: {
  /**
 * 文字长度更新后，在下一次绘制前重新适配工具栏标签宽度。
 */
  onWidthChange?: () => void;
}) {
  const { t } = useI18n();
  const [versionShown, setVersionShown] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const piVersion = process.env.NEXT_PUBLIC_PI_VERSION;
  const text = useScramble(versionShown ? brandVersionText(appVersion, piVersion) : BRAND_TEXT);

  useLayoutEffect(() => {
    onWidthChange?.();
  }, [text.length, onWidthChange]);

  useEffect(() => () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
  }, []);

  const handleClick = () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    revertTimerRef.current = null;
    if (versionShown) {
      setVersionShown(false);
      return;
    }
    setVersionShown(true);
    revertTimerRef.current = setTimeout(() => {
      revertTimerRef.current = null;
      setVersionShown(false);
    }, VERSION_SHOWN_MS);
  };

  // 无障碍名称直接说明点击后显示的版本，无需用户先触发动画，
  // 且名称保持稳定，不让读屏朗读随机变化的文字。
  return (
    <button
      type="button"
      className={`sidebar-brand${versionShown ? " is-version" : ""}`}
      aria-label={t("sidebar.brandLabel", { app: appVersion ?? "0.0.0", pi: piVersion ?? "0.0.0" })}
      onClick={handleClick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 本地图标已导出固定尺寸，不需要在线图片优化。 */}
      <img src="/icons/logo-ocean.png" width={24} height={24} alt="" className="sidebar-brand-logo" loading="lazy" decoding="async" />
      <span>{text}</span>
    </button>
  );
}
