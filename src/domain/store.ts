/**
 * 助听器调试闭环 · 领域状态机
 *
 * 不变量（所有写操作后均成立，reload 后由 integrityCheck 复核）：
 *  1. 同客户 + 同耳别至多有一条 pending（等待确认）记录；
 *  2. pending 可确认，confirmed 数值冻结、不可改；
 *  3. 冻结后再调试 = 新建更大版本号的记录，parentId 指向旧版本，旧值保留；
 *  4. 草稿按 客户+耳别 归并，不随页面选择切换而串台；
 *  5. 同客户同耳别已有 pending 时登记新记录属于冲突，冲突列出客户、耳别、增益。
 */
import { validateTuning } from "./rules";
import type {
  Conflict,
  Customer,
  Ear,
  FittingRecord,
  FittingState,
  TuningDraft,
  TuningInput,
} from "./types";

export const SCHEMA_VERSION = 1 as const;
export const STORAGE_KEY = "hxwl-01.fitting.v1";

export function draftKey(customerId: string, ear: Ear): string {
  return `${customerId}::${ear}`;
}

export function createInitialState(customers: Customer[]): FittingState {
  return { schemaVersion: SCHEMA_VERSION, customers, records: [], drafts: {} };
}

let seq = 0;
/** 可注入时间/随机源，保证纯函数式可测 */
export function makeId(prefix: string, now: number): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}_${now.toString(36)}_${seq.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------- 选择器 ---------------- */

/** 同客户同耳别的记录，按版本升序 */
export function recordsForEar(state: FittingState, customerId: string, ear: Ear): FittingRecord[] {
  return state.records
    .filter((r) => r.customerId === customerId && r.ear === ear)
    .sort((a, b) => a.version - b.version);
}

/** 同客户同耳别当前的等待确认记录（至多一条） */
export function pendingRecord(
  state: FittingState,
  customerId: string,
  ear: Ear,
): FittingRecord | null {
  return (
    state.records.find(
      (r) => r.customerId === customerId && r.ear === ear && r.status === "pending",
    ) ?? null
  );
}

/** 同客户同耳别最新已冻结版本（再次调试的基线） */
export function latestFrozen(
  state: FittingState,
  customerId: string,
  ear: Ear,
): FittingRecord | null {
  const confirmed = state.records
    .filter((r) => r.customerId === customerId && r.ear === ear && r.status === "confirmed")
    .sort((a, b) => b.version - a.version);
  return confirmed[0] ?? null;
}

export function getDraft(state: FittingState, customerId: string, ear: Ear): TuningDraft | null {
  return state.drafts[draftKey(customerId, ear)] ?? null;
}

/* ---------------- 草稿 ---------------- */

export const EMPTY_INPUT: TuningInput = {
  gainDb: null,
  feedback: null,
  rating: null,
  rationale: "",
  reason: "",
};

/** 以最新冻结版本为基线新建草稿（无冻结版本时为初配） */
export function startDraft(state: FittingState, customerId: string, ear: Ear, now: number): TuningDraft {
  const existing = getDraft(state, customerId, ear);
  if (existing) return existing;
  const base = latestFrozen(state, customerId, ear);
  return {
    ...EMPTY_INPUT,
    id: makeId("draft", now),
    customerId,
    ear,
    parentId: base ? base.id : null,
    updatedAt: now,
  };
}

export interface DraftResult {
  state: FittingState;
  draft: TuningDraft;
  /** 草稿仅做轻校验：联动必填在正式登记时拦截 */
  errors: ReturnType<typeof validateTuning>;
}

/** 更新草稿槽位（永远写回同一 客户+耳别，避免串台） */
export function updateDraft(
  state: FittingState,
  customerId: string,
  ear: Ear,
  patch: Partial<TuningInput>,
  now: number,
): DraftResult {
  const current = startDraft(state, customerId, ear, now);
  const draft: TuningDraft = { ...current, ...patch, customerId, ear, updatedAt: now };
  const base = latestFrozen(state, customerId, ear);
  const errors = validateTuning(draft, {
    reasonRequired: base !== null,
    partial: true,
  });
  const drafts = { ...state.drafts, [draftKey(customerId, ear)]: draft };
  return { state: { ...state, drafts }, draft, errors };
}

/** 丢弃草稿（保存为正式记录后或手动放弃时调用） */
export function discardDraft(state: FittingState, customerId: string, ear: Ear): FittingState {
  const drafts = { ...state.drafts };
  delete drafts[draftKey(customerId, ear)];
  return { ...state, drafts };
}

/* ---------------- 登记 / 确认 / 冲突 ---------------- */

export interface RegisterResult {
  state: FittingState | null;
  record: FittingRecord | null;
  errors: ReturnType<typeof validateTuning>;
  /** 冲突：同客户同耳别已有等待确认记录 */
  conflict: Conflict | null;
}

/**
 * 正式登记一次调试：
 * - 无 pending 且校验通过 -> 生成 pending 记录，清除该槽位草稿；
 * - 有 pending -> 返回冲突（列出客户、耳别与双方增益），状态不变；
 * - 否则只保留草稿（草稿不动）。
 */
export function registerTuning(
  state: FittingState,
  customerId: string,
  ear: Ear,
  input: TuningInput,
  now: number,
): RegisterResult {
  const blocker = pendingRecord(state, customerId, ear);
  if (blocker) {
    return {
      state: null,
      record: null,
      errors: {},
      conflict: {
        source: "register",
        customerId,
        customerName: customerName(state, customerId),
        ear,
        gainDb: blocker.gainDb,
        recordId: blocker.id,
        blockingGainDb: blocker.gainDb,
        blockingRecordId: blocker.id,
        submittedGainDb: input.gainDb,
      },
    };
  }

  const base = latestFrozen(state, customerId, ear);
  const errors = validateTuning(input, { reasonRequired: base !== null });
  if (Object.keys(errors).length > 0) {
    return { state: null, record: null, errors, conflict: null };
  }

  const record: FittingRecord = {
    id: makeId("rec", now),
    customerId,
    ear,
    version: base ? base.version + 1 : 1,
    status: "pending",
    gainDb: input.gainDb as number,
    feedback: input.feedback as FittingRecord["feedback"],
    rating: input.rating as FittingRecord["rating"],
    rationale: input.rationale.trim(),
    reason: input.reason.trim(),
    parentId: base ? base.id : null,
    createdAt: now,
    confirmedAt: null,
  };
  const next = discardDraft(
    { ...state, records: [...state.records, record] },
    customerId,
    ear,
  );
  return { state: next, record, errors: {}, conflict: null };
}

/** 确认等待确认记录 -> 冻结数值 */
export function confirmRecord(state: FittingState, recordId: string, now: number): FittingState {
  return {
    ...state,
    records: state.records.map((r) =>
      r.id === recordId && r.status === "pending"
        ? { ...r, status: "confirmed", confirmedAt: now }
        : r,
    ),
  };
}

/** 移除一条记录（仅用于修复巡检发现的重复等待确认冲突） */
export function removeRecord(state: FittingState, recordId: string): FittingState {
  return { ...state, records: state.records.filter((r) => r.id !== recordId) };
}

/** 一条记录在某耳版本链中的上一条（旧值查看用） */
export function parentRecord(state: FittingState, record: FittingRecord): FittingRecord | null {
  if (!record.parentId) return null;
  return state.records.find((r) => r.id === record.parentId) ?? null;
}

function customerName(state: FittingState, customerId: string): string {
  return state.customers.find((c) => c.id === customerId)?.name ?? customerId;
}

/* ---------------- 一致性巡检（reload 后复核版本关系） ---------------- */

/**
 * 巡检持久化数据：同客户同耳别出现多条等待确认即视为冲突。
 * 返回冲突列表（列出客户、耳别与增益）；正常为空。
 */
export function integrityCheck(state: FittingState): Conflict[] {
  const conflicts: Conflict[] = [];
  const groups = new Map<string, FittingRecord[]>();
  for (const r of state.records) {
    if (r.status !== "pending") continue;
    const key = draftKey(r.customerId, r.ear);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    // 以最早创建的一条为占位，其余均与它冲突
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
    const first = sorted[0];
    for (const other of sorted.slice(1)) {
      conflicts.push({
        source: "integrity",
        customerId: other.customerId,
        customerName: customerName(state, other.customerId),
        ear: other.ear,
        gainDb: other.gainDb,
        recordId: other.id,
        blockingGainDb: first.gainDb,
        blockingRecordId: first.id,
        submittedGainDb: null,
      });
    }
  }
  return conflicts;
}
