/**
 * 校验规则：全部为纯函数，与页面、存储完全解耦，可单独测试。
 */
import type { FeedbackLevel, FittingRecord, Rating, TuningInput } from "./types";

export const RATING_GOOD = 3;
export const FEEDBACK_LIMIT = 2;

export const RATING_LABELS: Record<Rating, string> = {
  1: "差",
  2: "一般",
  3: "良好",
  4: "优秀",
};

export const FEEDBACK_LABELS: Record<FeedbackLevel, string> = {
  0: "无",
  1: "一级",
  2: "二级",
  3: "三级",
  4: "四级",
};

/** 评分低于良好（< 3） */
export function ratingBelowGood(rating: Rating | null): boolean {
  return rating !== null && rating < RATING_GOOD;
}

/** 反馈超过二级（> 2） */
export function feedbackOverLevelTwo(feedback: FeedbackLevel | null): boolean {
  return feedback !== null && feedback > FEEDBACK_LIMIT;
}

/** 本次调试是否必须填写调整依据 */
export function rationaleRequired(input: Pick<TuningInput, "rating" | "feedback">): boolean {
  return ratingBelowGood(input.rating) || feedbackOverLevelTwo(input.feedback);
}

export type FieldError = Partial<Record<"gainDb" | "feedback" | "rating" | "rationale" | "reason", string>>;

/** 增益合法区间：助听器调试一般 -10 ~ 40 dB，步进 1 */
export const GAIN_MIN = -10;
export const GAIN_MAX = 40;

export interface ValidateOptions {
  /** true 表示基于已冻结版本再次调试，须填调整原因 */
  reasonRequired: boolean;
  /** 草稿校验：允许字段为空，只校验已填内容与联动必填 */
  partial?: boolean;
}

/**
 * 校验一份调试输入。
 * @returns 字段级错误表，空对象表示通过
 */
export function validateTuning(input: TuningInput, options: ValidateOptions): FieldError {
  const errors: FieldError = {};
  const { reasonRequired, partial = false } = options;

  // 增益
  if (input.gainDb === null) {
    if (!partial) errors.gainDb = "请填写增益（dB）";
  } else if (!Number.isFinite(input.gainDb)) {
    errors.gainDb = "增益必须是数字";
  } else if (input.gainDb < GAIN_MIN || input.gainDb > GAIN_MAX) {
    errors.gainDb = `增益须在 ${GAIN_MIN} ~ ${GAIN_MAX} dB 之间`;
  }

  // 反馈等级
  if (input.feedback === null) {
    if (!partial) errors.feedback = "请选择反馈等级";
  }

  // 评分
  if (input.rating === null) {
    if (!partial) errors.rating = "请选择评分";
  }

  // 调整依据：评分低于良好或反馈超过二级时必填
  const needRationale = rationaleRequired(input);
  if (needRationale && !input.rationale.trim()) {
    errors.rationale = "评分低于良好或反馈超过二级时，必须写明调整依据";
  } else if (input.rationale.length > 300) {
    errors.rationale = "调整依据不超过 300 字";
  }

  // 调整原因：基于冻结版本再调试时必填
  if (reasonRequired && !input.reason.trim()) {
    errors.reason = "基于已确认版本再次调试，必须填写调整原因";
  } else if (input.reason.length > 300) {
    errors.reason = "调整原因不超过 300 字";
  }

  return errors;
}

/** 是否为冻结（已确认）记录 */
export function isFrozen(record: FittingRecord): boolean {
  return record.status === "confirmed";
}
