/** 本地持久化：客户、记录、草稿与版本关系统一存一个快照，重载后整体恢复 */
import { integrityCheck, SCHEMA_VERSION, STORAGE_KEY } from "./store";
import type { Conflict, FittingState } from "./types";

const hasStorage = (): boolean =>
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";

export function loadState(): { state: FittingState | null; conflicts: Conflict[] } {
  if (!hasStorage()) return { state: null, conflicts: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: null, conflicts: [] };
    const parsed = JSON.parse(raw) as FittingState;
    if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.records)) {
      return { state: null, conflicts: [] };
    }
    // 防御性补齐，保证缺字段的旧快照也能恢复出一致结构
    parsed.drafts = parsed.drafts ?? {};
    parsed.customers = parsed.customers ?? [];
    return { state: parsed, conflicts: integrityCheck(parsed) };
  } catch {
    return { state: null, conflicts: [] };
  }
}

export function saveState(state: FittingState): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额超限时静默：本轮会话仍可用
  }
}

export function clearState(): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
