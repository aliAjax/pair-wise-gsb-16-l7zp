import type { Ear, FittingValues, Rating } from "./types";

/** localStorage 持久化键；带版本号，规则演进时可整体失效 */
export const STORAGE_KEY = "hxwl-fitting-state-v1";

export const EAR_LABEL: Record<Ear, string> = {
  left: "左耳",
  right: "右耳",
};

export const EARS: Ear[] = ["left", "right"];

export const GAIN_MIN_DB = -10;
export const GAIN_MAX_DB = 60;

/** 评分等级。「良好」是判定门槛：低于良好须写调整依据 */
export const RATING_LABEL: Record<Rating, string> = {
  1: "差",
  2: "一般",
  3: "良好",
  4: "很好",
  5: "优秀",
};

/** 评分门槛：rating < GOOD_RATING_THRESHOLD 视为低于良好 */
export const GOOD_RATING_THRESHOLD: Rating = 3;

/** 反馈等级标签。二级 = 明显啸叫，是判定门槛 */
export const FEEDBACK_LABEL = [
  "0 · 无啸叫",
  "1 · 偶发",
  "2 · 明显",
  "3 · 持续",
] as const;

/** 反馈门槛：feedback > FEEDBACK_SECOND_LEVEL 视为超过二级 */
export const FEEDBACK_SECOND_LEVEL = 2;

export const STATUS_LABEL = {
  pending: "等待确认",
  confirmed: "已确认",
} as const;

/** 判定「是否必须填写调整依据」：评分低于良好 或 反馈超过二级 */
export function basisRequired(values: Pick<FittingValues, "feedback" | "rating">): boolean {
  return (
    values.rating < GOOD_RATING_THRESHOLD ||
    values.feedback > FEEDBACK_SECOND_LEVEL
  );
}
