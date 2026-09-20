import { EARS } from "./constants";
import type {
  DraftInput,
  Ear,
  FittingConflict,
  FittingDraft,
  FittingRecord,
  FittingState,
  FittingValues,
} from "./types";
import { canConfirm, parseGain, validateRegister } from "./validation";

let seq = 0;
/** 生成稳定但唯一的记录 id（时间戳 + 进程内自增） */
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function draftKey(customerId: string, ear: Ear): string {
  return `${customerId}::${ear}`;
}

/**
 * 同一客户同一耳别至多一条等待确认记录；它是登记新调试的唯一阻塞项。
 * 未达登记条件（缺调整依据等）的输入只存在 drafts，不进入 records。
 */
export function findPendingRecord(
  records: FittingRecord[],
  customerId: string,
  ear: Ear,
): FittingRecord | undefined {
  return records.find(
    (r) => r.customerId === customerId && r.ear === ear && r.status === "pending",
  );
}

/** 该耳最新的已确认记录（用于版本链 / 旧值保留） */
export function findLatestConfirmed(
  records: FittingRecord[],
  customerId: string,
  ear: Ear,
): FittingRecord | undefined {
  return records
    .filter((r) => r.customerId === customerId && r.ear === ear && r.status === "confirmed")
    .sort((a, b) => b.version - a.version)[0];
}

export function earHistory(
  records: FittingRecord[],
  customerId: string,
  ear: Ear,
): FittingRecord[] {
  return records
    .filter((r) => r.customerId === customerId && r.ear === ear)
    .sort((a, b) => b.version - a.version || b.createdAt - a.createdAt);
}

/** 下一个版本号：无任何记录时为 1 */
export function nextVersion(
  records: FittingRecord[],
  customerId: string,
  ear: Ear,
): number {
  return earHistory(records, customerId, ear).reduce(
    (max, r) => Math.max(max, r.version),
    0,
  ) + 1;
}

export function getDraft(
  state: FittingState,
  customerId: string,
  ear: Ear,
): FittingDraft | undefined {
  return state.drafts[draftKey(customerId, ear)];
}

function emptyDraft(customerId: string, ear: Ear): FittingDraft {
  return {
    customerId,
    ear,
    gainDb: "",
    feedback: 0,
    rating: 0,
    basis: "",
    reason: "",
    updatedAt: Date.now(),
  };
}

/** 读取草稿，不存在则返回该客户该耳的空白草稿（不写入状态） */
export function getOrInitDraft(
  state: FittingState,
  customerId: string,
  ear: Ear,
): FittingDraft {
  return getDraft(state, customerId, ear) ?? emptyDraft(customerId, ear);
}

/**
 * 保存草稿（按客户+耳隔离）。草稿不经过「调整依据」强制校验——
 * 规则不满足的输入只能停在草稿；切换客户时只按 key 读取，天然不串台。
 */
export function saveDraft(
  state: FittingState,
  customerId: string,
  ear: Ear,
  input: DraftInput,
): FittingState {
  const draft: FittingDraft = {
    customerId,
    ear,
    ...input,
    updatedAt: Date.now(),
  };
  return {
    ...state,
    drafts: { ...state.drafts, [draftKey(customerId, ear)]: draft },
  };
}

export function discardDraft(
  state: FittingState,
  customerId: string,
  ear: Ear,
): FittingState {
  const drafts = { ...state.drafts };
  delete drafts[draftKey(customerId, ear)];
  return { ...state, drafts };
}

/** 某客户是否存在任意已保存草稿（用于切换客户前提示） */
export function customerHasDraft(state: FittingState, customerId: string): boolean {
  return Object.values(state.drafts).some((d) => d.customerId === customerId);
}

export interface RegisterSuccess {
  ok: true;
  state: FittingState;
  record: FittingRecord;
}

export interface RegisterFailure {
  ok: false;
  issues: ReturnType<typeof validateRegister>;
}

/**
 * 登记：表单（草稿）→ 等待确认记录。
 * 成功后清掉该客户该耳的草稿；记录确认前不冻结，确认后才冻结。
 */
export function registerFitting(
  state: FittingState,
  customerId: string,
  ear: Ear,
  input: DraftInput,
): RegisterSuccess | RegisterFailure {
  const pending = findPendingRecord(state.records, customerId, ear);
  const latestConfirmed = findLatestConfirmed(state.records, customerId, ear);
  const issues = validateRegister(input, {
    hasConfirmedVersion: Boolean(latestConfirmed),
    hasOpenRecord: Boolean(pending),
  });
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const gain = parseGain(input.gainDb);
  if (!gain.ok || input.rating === 0) {
    return {
      ok: false,
      issues: gain.ok
        ? [{ field: "rating", code: "RATING_REQUIRED", message: "请选择听声评分" }]
        : [{ field: "gainDb", code: gain.code, message: gain.message }],
    };
  }

  const values: FittingValues = {
    gainDb: gain.value,
    feedback: input.feedback,
    rating: input.rating,
  };
  const record: FittingRecord = {
    id: uid("fit"),
    customerId,
    ear,
    status: "pending",
    version: nextVersion(state.records, customerId, ear),
    ...values,
    basis: input.basis.trim(),
    reason: input.reason.trim(),
    previousValues: latestConfirmed
      ? {
          gainDb: latestConfirmed.gainDb,
          feedback: latestConfirmed.feedback,
          rating: latestConfirmed.rating,
        }
      : null,
    createdAt: Date.now(),
    confirmedAt: null,
  };

  const next: FittingState = {
    ...state,
    records: [...state.records, record],
  };
  return { ok: true, state: discardDraft(next, customerId, ear), record };
}

export interface ConfirmResult {
  state: FittingState;
  record: FittingRecord;
}

/**
 * 确认等待确认记录：冻结增益/反馈/评分。冻结后数值不可变；
 * 再调只能由 registerFitting 另建下一版本（带 reason + previousValues）。
 */
export function confirmFitting(state: FittingState, recordId: string): ConfirmResult {
  const target = state.records.find((r) => r.id === recordId);
  if (!target || !canConfirm(target)) {
    throw new Error("只有等待确认的记录可以确认");
  }
  const record: FittingRecord = { ...target, status: "confirmed", confirmedAt: Date.now() };
  return {
    state: {
      ...state,
      records: state.records.map((r) => (r.id === recordId ? record : r)),
    },
    record,
  };
}

/** 撤回等待确认记录：记录删除，数值退回该客户该耳草稿，可改后重新登记 */
export function withdrawPending(state: FittingState, recordId: string): FittingState {
  const target = state.records.find((r) => r.id === recordId);
  if (!target || target.status !== "pending") {
    return state;
  }
  const without = {
    ...state,
    records: state.records.filter((r) => r.id !== recordId),
  };
  return saveDraft(without, target.customerId, target.ear, {
    gainDb: String(target.gainDb),
    feedback: target.feedback,
    rating: target.rating,
    basis: target.basis,
    reason: target.reason,
  });
}

function customerName(state: FittingState, customerId: string): string {
  return state.customers.find((c) => c.id === customerId)?.name ?? customerId;
}

/**
 * 针对「本次尝试写入」列出冲突：同客户同耳存在等待确认记录即冲突。
 * 每条冲突固定带出 客户、耳别、增益（被阻塞值 + 尝试值）。
 */
export function listConflicts(
  state: FittingState,
  attempts: Array<{ customerId: string; ear: Ear; gainDb: number }>,
): FittingConflict[] {
  const conflicts: FittingConflict[] = [];
  for (const attempt of attempts) {
    const blocked = findPendingRecord(state.records, attempt.customerId, attempt.ear);
    if (blocked) {
      conflicts.push({
        customerId: attempt.customerId,
        customerName: customerName(state, attempt.customerId),
        ear: attempt.ear,
        blockedGainDb: blocked.gainDb,
        blockedRecordId: blocked.id,
        attemptedGainDb: attempt.gainDb,
      });
    }
  }
  return conflicts;
}

/** 某客户某耳当前是否被等待确认记录阻塞 */
export function isBlocked(
  state: FittingState,
  customerId: string,
  ear: Ear,
): boolean {
  return Boolean(findPendingRecord(state.records, customerId, ear));
}

/** 列出全部等待确认冲突（全局冲突面板用，尝试增益未知） */
export function listAllPendingConflicts(state: FittingState): FittingConflict[] {
  return state.records
    .filter((r) => r.status === "pending")
    .map((r) => ({
      customerId: r.customerId,
      customerName: customerName(state, r.customerId),
      ear: r.ear,
      blockedGainDb: r.gainDb,
      blockedRecordId: r.id,
      attemptedGainDb: NaN,
    }));
}

/** 初始化示例状态（与原页面示例客户对应） */
export function createInitialState(): FittingState {
  return {
    customers: [
      { id: "c-liu", name: "刘先生", code: "Liu-024", note: "双耳高频下降" },
      { id: "c-chen", name: "陈女士", code: "Chen-118", note: "单侧传导性损失" },
      { id: "c-zhao", name: "赵老伯", code: "Zhao-077", note: "老人语频区下降" },
    ],
    records: [],
    drafts: {},
  };
}

/**
 * 一致性自检（重载恢复后使用）：
 *  - 草稿 key 必须与其负载的客户/耳一致（防串台）
 *  - 同客户同耳至多一条等待确认记录
 *  - 版本号连续且每版至多一条
 *  - 冻结记录 previousValues 必须指向上一确认版
 */
export function checkIntegrity(state: FittingState): string[] {
  const errors: string[] = [];
  for (const [key, draft] of Object.entries(state.drafts)) {
    if (key !== draftKey(draft.customerId, draft.ear)) {
      errors.push(`草稿串台：键 ${key} 的实际归属为 ${draft.customerId}::${draft.ear}`);
    }
  }
  for (const customer of state.customers) {
    for (const ear of EARS) {
      const history = earHistory(state.records, customer.id, ear);
      const pending = history.filter((r) => r.status === "pending");
      if (pending.length > 1) {
        errors.push(`${customer.name} ${ear} 存在 ${pending.length} 条等待确认记录（至多 1 条）`);
      }
      const versions = history.map((r) => r.version).sort((a, b) => a - b);
      versions.forEach((v, i) => {
        if (v !== i + 1) errors.push(`${customer.name} ${ear} 版本号不连续：${versions.join(",")}`);
      });
      const ascending = [...history].reverse();
      ascending.forEach((r) => {
        if (r.version > 1) {
          const prev = ascending.find((x) => x.version === r.version - 1 && x.status === "confirmed");
          if (!prev) {
            errors.push(`${customer.name} ${ear} v${r.version} 缺少上一确认版本`);
          } else if (
            !r.previousValues ||
            r.previousValues.gainDb !== prev.gainDb ||
            r.previousValues.feedback !== prev.feedback ||
            r.previousValues.rating !== prev.rating
          ) {
            errors.push(`${customer.name} ${ear} v${r.version} 保留的旧值与 v${prev.version} 不一致`);
          }
        }
      });
    }
  }
  return errors;
}
