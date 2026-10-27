interface TimingEntry {
  type: string;
  id?: string;
  timestamp: string;
  message?: { role?: string };
}

interface TimingEntriesSource {
  getEntries(): readonly TimingEntry[];
}

/**
 * Estimate active wall-clock time from the append-only session log.
 *
 * Raw entries preserve compacted history and every executed branch exactly
 * once. Gaps ending at user messages are treated as human idle. User-initiated
 * bash entries are also boundaries because the log records only their finish
 * time, so counting the incoming gap could include arbitrary human idle.
 */
export function computeSessionTotalActiveMs(entries: readonly TimingEntry[]): number {
  let totalActiveMs = 0;
  let previousTimestamp: number | undefined;

  for (const entry of entries) {
    if (!isTimingEntry(entry.type)) continue;

    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const role = entry.type === "message" ? entry.message?.role : undefined;
    // 恢复会话会在用户消息前补系统快照；它是元数据，不能把此前空闲算成工作时间。
    if (role === "system") continue;
    if (role === "user" || role === "bashExecution") {
      previousTimestamp = timestamp;
      continue;
    }

    if (previousTimestamp !== undefined && timestamp > previousTimestamp) {
      totalActiveMs += timestamp - previousTimestamp;
    }
    previousTimestamp = timestamp;
  }

  return totalActiveMs;
}

function isTimingEntry(type: string): boolean {
  return type === "message"
    || type === "compaction"
    || type === "branch_summary"
    || type === "custom_message";
}

const activeMsBySession = new WeakMap<TimingEntriesSource, { entryCount: number; lastEntryId: string | undefined; totalActiveMs: number }>();

/** 缓存实时会话的活跃时间，条目变化才重算，避免频繁状态轮询反复遍历全部历史。 */
export function computeLiveSessionTotalActiveMs(manager: TimingEntriesSource): number {
  const entries = manager.getEntries();
  const lastEntryId = entries[entries.length - 1]?.id;
  const cached = activeMsBySession.get(manager);
  if (cached && cached.entryCount === entries.length && cached.lastEntryId === lastEntryId) {
    return cached.totalActiveMs;
  }

  const totalActiveMs = computeSessionTotalActiveMs(entries);
  activeMsBySession.set(manager, { entryCount: entries.length, lastEntryId, totalActiveMs });
  return totalActiveMs;
}
