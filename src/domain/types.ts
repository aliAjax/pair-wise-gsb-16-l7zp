/**
 * 助听器调试闭环 · 领域类型定义
 * 与 React / 页面完全无关，可被任意界面或测试复用。
 */

export type Ear = "left" | "right";
export type EarSide = Ear;

/** 反馈等级：0 无啸叫，1 偶发，2 明显，3 持续 */
export type FeedbackLevel = 0 | 1 | 2 | 3;

/** 听声评分：1 差，2 一般，3 良好，4 很好，5 优秀 */
export type Rating = 1 | 2 | 3 | 4 | 5;

/** 记录状态：pending 等待确认 / confirmed 已确认（冻结）。未达登记条件的输入只留在 drafts 草稿区 */
export type RecordStatus = "pending" | "confirmed";

/** 一次调试在单耳上的数值 */
export interface FittingValues {
  /** 增益，单位 dB，允许 -10 ~ 60，步进 1 */
  gainDb: number;
  feedback: FeedbackLevel;
  rating: Rating;
}

/**
 * 单耳调试记录（版本链中的一个版本）。
 * 同一客户同一耳别按 version 串联：
 *  - v1 初始版本：basis 为「调整依据」（低分/高反馈时强制）
 *  - v2+ 再次调试：reason 为「调试原因」，previousValues 保留上一版（确认版）旧值
 */
export interface FittingRecord extends FittingValues {
  id: string;
  customerId: string;
  ear: Ear;
  status: RecordStatus;
  version: number;
  /** 评分低于良好或反馈超过二级时，登记时必须填写的调整依据 */
  basis: string;
  /** v2+：为什么要再调（对上一确认版发起新版本的原因） */
  reason: string;
  /** v2+：上一版本被冻结的旧值，用于版本对照 */
  previousValues: FittingValues | null;
  createdAt: number;
  confirmedAt: number | null;
}

/** 客户 */
export interface Customer {
  id: string;
  name: string;
  /** 档案号，如 Liu-024 */
  code: string;
  note: string;
}

/** 未保存/已保存草稿：按「客户 + 耳别」隔离，切换客户不串台 */
export interface FittingDraft {
  customerId: string;
  ear: Ear;
  gainDb: string;
  feedback: FeedbackLevel;
  /** 0 表示未选择 */
  rating: Rating | 0;
  basis: string;
  reason: string;
  updatedAt: number;
}

export type DraftsMap = Record<string, FittingDraft>;

/** 冲突条目：同一客户同一耳别存在等待确认记录 */
export interface FittingConflict {
  customerId: string;
  customerName: string;
  ear: Ear;
  /** 被阻塞的（等待确认的）记录增益 */
  blockedGainDb: number;
  blockedRecordId: string;
  /** 本次想要写入的增益 */
  attemptedGainDb: number;
}

/** 表单校验问题码 */
export type ValidationCode =
  | "GAIN_REQUIRED"
  | "GAIN_NOT_NUMBER"
  | "GAIN_OUT_OF_RANGE"
  | "RATING_REQUIRED"
  | "BASIS_REQUIRED"
  | "REASON_REQUIRED"
  | "OPEN_RECORD_BLOCKED";

export interface ValidationIssue {
  field: "gainDb" | "feedback" | "rating" | "basis" | "reason" | "form";
  code: ValidationCode;
  message: string;
}

export interface FittingState {
  customers: Customer[];
  records: FittingRecord[];
  drafts: DraftsMap;
}

export type DraftInput = Pick<
  FittingDraft,
  "gainDb" | "feedback" | "rating" | "basis" | "reason"
>;
