/** 只接受标题栏颜色和布局尺寸，不能透传任意窗口选项。 */
function titlebarOptions(value, zoom = 1) {
  if (!value || typeof value !== "object" || !/^#[0-9a-f]{6}$/i.test(value.color) || !/^#[0-9a-f]{6}$/i.test(value.symbolColor)) return null;
  if (!Number.isFinite(value.height) || value.height < 24 || value.height > 64 || !Number.isFinite(zoom) || zoom < 0.25 || zoom > 5) return null;
  // 原生按钮覆盖区让出最后一个物理像素，由网页画出连续的底部分隔线。
  return { color: value.color, symbolColor: value.symbolColor, height: Math.max(1, Math.round(value.height * zoom) - 1) };
}
module.exports = { titlebarOptions };
