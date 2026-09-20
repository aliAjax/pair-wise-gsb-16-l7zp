import {
  FEEDBACK_SECOND_LEVEL,
  GAIN_MAX_DB,
  GAIN_MIN_DB,
  GOOD_RATING_THRESHOLD,
} from "./constants";
import type {
  DraftInput,
  FittingRecord,
  ValidationIssue,
} from "./types";

export interface RegisterContext {
  /** 是否已有等待确认记录——正常应被冲突检查挡住，此处兜底 */
  hasOpenRecord: boolean;
  /** 是否已有确认版本（决定「调试原因」是否必填） */
  hasConfirmedVersion: boolean;
}

/** 解析增益输入，返回数字或错误（空串 / 非数 / 越界） */
export function parseGain(raw: string):
  | { ok: true; value: number }
  | { ok: false; code: "GAIN_REQUIRED" | "GAIN_NOT_NUMBER" | "GAIN_OUT_OF_RANGE"; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, code: "GAIN_REQUIRED", message: "请填写增益（dB）" };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, code: "GAIN_NOT_NUMBER", message: "增益必须是数字" };
  }
  if (value < GAIN_MIN_DB || value > GAIN_MAX_DB) {
    return {
      ok: false,
      code: "GAIN_OUT_OF_RANGE",
      message: `增益需在 ${GAIN_MIN_DB} ~ ${GAIN_MAX_DB} dB 之间`,
    };
  }
  return { ok: true, value };
}

/**
 * 登记（提交为等待确认）校验。
 * 规则：
 *  1. 增益必填且为合法范围内数字
 *  2. 评分有效
 *  3. 评分低于良好（<3）或反馈超过二级（>2）时，调整依据必填，否则只能存草稿
 *  4. 已有确认版本后再次调试，调试原因必填
 *  5. 同客户同耳存在未决记录时禁止登记
 */
export function validateRegister(input: DraftInput, ctx: RegisterContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (ctx.hasOpenRecord) {
    issues.push({
      field: "form",
      code: "OPEN_RECORD_BLOCKED",
      message: "该耳已有未决记录，请先确认或处理后再登记",
    });
    return issues;
  }

  const gain = parseGain(input.gainDb);
  if (!gain.ok) {
    issues.push({ field: "gainDb", code: gain.code, message: gain.message });
  }

  if (!input.rating || input.rating < 1 || input.rating > 5) {
    issues.push({ field: "rating", code: "RATING_REQUIRED", message: "请选择听声评分" });
  }

  const needsBasis =
    (input.rating !== 0 && input.rating < GOOD_RATING_THRESHOLD) ||
    input.feedback > FEEDBACK_SECOND_LEVEL;

  if (needsBasis && input.basis.trim() === "") {
    issues.push({
      field: "basis",
      code: "BASIS_REQUIRED",
      message: "评分低于良好或反馈超过二级，必须写明调整依据（否则只能保存草稿）",
    });
  }

  if (ctx.hasConfirmedVersion && input.reason.trim() === "") {
    issues.push({
      field: "reason",
      code: "REASON_REQUIRED",
      message: "已有确认版本，再次调试必须填写调试原因",
    });
  }

  return issues;
}

/** 确认前校验：只有等待确认的记录可以确认 */
export function canConfirm(record: FittingRecord): boolean {
  return record.status === "pending";
}
