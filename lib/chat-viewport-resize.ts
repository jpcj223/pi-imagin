/** 高度变化沿用变化前的阅读意图，不能拿缩小后的距离判断是否在底部。 */
export function observeChatViewport(container: HTMLElement, onAdjusted: () => void): () => void {
  let height = container.clientHeight;
  let width = container.clientWidth;
  let top = container.scrollTop;
  let tail = container.scrollHeight - top - height <= 32;
  let hidden = height === 0;
  const remember = () => {
    if (!container.clientHeight || container.clientHeight !== height || container.clientWidth !== width) return;
    top = container.scrollTop;
    tail = container.scrollHeight - top - height <= 32;
  };
  const observer = new ResizeObserver(() => {
    const nextHeight = container.clientHeight, nextWidth = container.clientWidth;
    if (!nextHeight || !nextWidth) { hidden = true; return; }
    if (hidden || nextHeight !== height || nextWidth !== width) {
      // 历史阅读保留顶部位置；最新消息随底部移动。全屏隐藏期间不覆盖快照。
      container.scrollTop = tail ? container.scrollHeight - nextHeight : top;
      height = nextHeight;
      width = nextWidth;
      hidden = false;
      onAdjusted();
      remember();
    }
  });
  observer.observe(container);
  container.addEventListener("scroll", remember, { passive: true });
  return () => { observer.disconnect(); container.removeEventListener("scroll", remember); };
}
