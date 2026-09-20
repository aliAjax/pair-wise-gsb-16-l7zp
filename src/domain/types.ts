/**
 * 听力验配 · 助听器调试闭环 —— 领域数据定义
 * 只描述数据结构，不包含任何 UI 或校验流程。
 */

/** 耳别 */
export type Ear = "L" | "R";

/** 主观评分：1 差 / 2 一般 / 3 良好 / 4 优秀 */
export type Rating = 1 | 2 | 3 | 4;

/** 反馈（啸叫）等级：0 无 / 1 一级 / 2 二级 / 3 三级 / 4 四级 */
export type FeedbackLevel = 0 | 1 | 2 | 3 | 4;

/** 调试记录状态：等待确认 -> 已确认（冻结） */
export type RecordStatus = "pending" | "confirmed";

export interface Customer {
  id: string;
  /** 档案号，如 Liu-024 */
  code: string;
  name: string;
}

/** 一次调试录入的值（草稿允许为空，记录必须完整） */
export interface TuningInput {
  /** 助听器增益 dB */
  gainDb: number | null;
  feedback: FeedbackLevel | null;
  rating: Rating | null;
  /** 调整依据：评分低于良好或反馈超过二级时必填 */
  rationale: string;
  /** 调整原因：基于已冻结版本再次调试时必填 */
  reason: string;
}

/**
 * 一条助听器调试记录（同客户 + 同耳别 + 同版本号唯一）。
 * pending 可确认；confirmed 数值冻结，再调试只能另建版本。
 */
export interface FittingRecord {
  id: string;
  customerId: string;
  ear: Ear;
  /** 版本号，从 1 开始，每次确认后再次调试递增 */
  version: number;
  status: RecordStatus;
  gainDb: number;
  feedback: FeedbackLevel;
  rating: Rating;
  rationale: string;
  reason: string;
  /** 上一版本记录 id，初配为 null；旧值随旧记录保留 */
  parentId: string | null;
  createdAt: number;
  confirmedAt: number | null;
}

/**
 * 草稿：同客户同耳别只有一个槽位（按 `${customerId}::${ear}` 归并）。
 * 切换客户不会串台，刷新后仍归属于原客户与耳别。
 */
export interface TuningDraft extends TuningInput {
  id: string;
  customerId: string;
  ear: Ear;
  /** 草稿基于的已冻结版本，初配为 null */
  parentId: string | null;
  updatedAt: number;
}

export interface FittingState {
  schemaVersion: 1;
  customers: Customer[];
  /** 等待确认 / 已冻结的正式记录 */
  records: FittingRecord[];
  /** 未登记的草稿，键见 draftKey() */
  drafts: Record<string, TuningDraft>;
}

/** 登记冲突：列出客户、耳别与增益 */
export interface Conflict {
  source: "register" | "integrity";
  customerId: string;
  customerName: string;
  ear: Ear;
  /** 冲突记录本身的增益 */
  gainDb: number;
  recordId: string;
  /** 已占用的「等待确认」记录增益 */
  blockingGainDb: number;
  blockingRecordId: string;
  /** 登记操作时本次提交的增益（一致性巡检产生的冲突为 null） */
  submittedGainDb: number | null;
}
