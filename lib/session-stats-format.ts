// 客户端安全的用量格式化，供工具栏统计与代理列表复用。

/** 950 · 18k · 1.2M */
export function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

/** 显示 $0.12 或 <$0.01；没有计费时返回 null。 */
export function formatCostShort(cost: number): string | null {
  if (!(cost > 0)) return null;
  return cost >= 0.01 ? `$${cost.toFixed(2)}` : "<$0.01";
}

/** 0s · 42s · 3m 5s · 1h 20m */
export function formatActiveDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
