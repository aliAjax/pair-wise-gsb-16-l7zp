import { STORAGE_KEY } from "./constants";
import { checkIntegrity, createInitialState } from "./store";
import type {
  Customer,
  Ear,
  FittingDraft,
  FittingRecord,
  FittingState,
} from "./types";

function isRecord(x: unknown): x is FittingRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.customerId === "string" &&
    (r.ear === "left" || r.ear === "right") &&
    (r.status === "pending" || r.status === "confirmed") &&
    typeof r.version === "number" &&
    typeof r.gainDb === "number" &&
    typeof r.feedback === "number" &&
    typeof r.rating === "number" &&
    typeof r.basis === "string" &&
    typeof r.reason === "string" &&
    typeof r.createdAt === "number" &&
    (r.confirmedAt === null || typeof r.confirmedAt === "number") &&
    (r.previousValues === null ||
      (typeof r.previousValues === "object" &&
        typeof (r.previousValues as Record<string, unknown>).gainDb === "number"))
  );
}

function isCustomer(x: unknown): x is Customer {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.name === "string" && typeof c.code === "string";
}

function isDraft(x: unknown, key: string): x is FittingDraft {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Record<string, unknown>;
  const earOk = d.ear === "left" || d.ear === "right";
  return (
    typeof d.customerId === "string" &&
    earOk &&
    key === `${d.customerId}::${d.ear as Ear}` &&
    typeof d.gainDb === "string" &&
    typeof d.feedback === "number" &&
    typeof d.rating === "number" &&
    typeof d.basis === "string" &&
    typeof d.reason === "string"
  );
}

/**
 * 解析持久化数据；任何结构/归属异常都安全回退到空档案，
 * 并通过 checkIntegrity 保证客户、记录、草稿、版本关系一致。
 */
export function loadState(storage: Storage | undefined = safeStorage()): {
  state: FittingState;
  errors: string[];
} {
  const fallback = createInitialState();
  if (!storage) return { state: fallback, errors: [] };
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { state: fallback, errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: fallback, errors: ["存档解析失败，已重置为初始档案"] };
  }
  const root = parsed as Partial<FittingState> | null;
  if (!root || typeof root !== "object" || !Array.isArray(root.customers) || !Array.isArray(root.records)) {
    return { state: fallback, errors: ["存档结构无效，已重置为初始档案"] };
  }

  const customers = root.customers.filter(isCustomer);
  const known = new Set(customers.map((c) => c.id));
  const records = root.records.filter(
    (r): r is FittingRecord => isRecord(r) && known.has(r.customerId),
  );
  const drafts: FittingState["drafts"] = {};
  const draftRoot = root.drafts && typeof root.drafts === "object" ? root.drafts : {};
  for (const [key, value] of Object.entries(draftRoot)) {
    if (isDraft(value, key) && known.has(value.customerId)) {
      drafts[key] = value;
    }
  }

  const state: FittingState = { customers, records, drafts };
  const errors = checkIntegrity(state);
  if (errors.length > 0) {
    // 关系不一致时不冒险恢复：保留客户档案，清空记录与草稿
    return { state: { ...fallback, customers }, errors };
  }
  return { state, errors: [] };
}

export function saveState(
  state: FittingState,
  storage: Storage | undefined = safeStorage(),
): string[] {
  const errors = checkIntegrity(state);
  if (errors.length > 0) return errors;
  storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  return [];
}

/** SSR / 隐私模式下 localStorage 可能不存在 */
function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
