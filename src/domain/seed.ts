/** 首次进入时的示例档案：覆盖等待确认、已冻结与新版本链三种形态 */
import { makeId } from "./store";
import type { Customer, FittingRecord, FittingState } from "./types";

export const SEED_CUSTOMERS: Customer[] = [
  { id: "c-liu", code: "Liu-024", name: "刘女士 · 双耳高频下降" },
  { id: "c-chen", code: "Chen-118", name: "陈先生 · 单侧传导性损失" },
  { id: "c-zhao", code: "Zhao-077", name: "赵老伯 · 语频区下降" },
];

export function buildSeedState(now: number): FittingState {
  const day = 24 * 60 * 60 * 1000;
  const chenV1: FittingRecord = {
    id: makeId("rec", now - 20 * day),
    customerId: "c-chen",
    ear: "L",
    version: 1,
    status: "confirmed",
    gainDb: 14,
    feedback: 2,
    rating: 3,
    rationale: "",
    reason: "",
    parentId: null,
    createdAt: now - 20 * day,
    confirmedAt: now - 19 * day,
  };
  const chenV2: FittingRecord = {
    id: makeId("rec", now - 6 * day),
    customerId: "c-chen",
    ear: "L",
    version: 2,
    status: "confirmed",
    gainDb: 12,
    feedback: 1,
    rating: 4,
    rationale: "",
    reason: "复诊反映低频偏闷，整体下调 2dB 并略收低频压缩",
    parentId: chenV1.id,
    createdAt: now - 6 * day,
    confirmedAt: now - 6 * day + 3600_000,
  };
  const liuPendingL: FittingRecord = {
    id: makeId("rec", now - 1 * day),
    customerId: "c-liu",
    ear: "L",
    version: 1,
    status: "pending",
    gainDb: 22,
    feedback: 3,
    rating: 2,
    rationale: "2kHz 以上增益偏高引发啸叫，试听言语较吵，先降高频增益 4dB 观察",
    reason: "",
    parentId: null,
    createdAt: now - 1 * day,
    confirmedAt: null,
  };

  return {
    schemaVersion: 1,
    customers: SEED_CUSTOMERS,
    records: [chenV1, chenV2, liuPendingL],
    drafts: {},
  };
}
