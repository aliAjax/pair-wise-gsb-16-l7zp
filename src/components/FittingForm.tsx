import {
  FEEDBACK_LABEL,
  FEEDBACK_SECOND_LEVEL,
  GAIN_MAX_DB,
  GAIN_MIN_DB,
  GOOD_RATING_THRESHOLD,
  RATING_LABEL,
} from "../domain";
import type { DraftInput, FeedbackLevel, FittingRecord, Rating, ValidationIssue } from "../domain";

interface FittingFormProps {
  form: DraftInput;
  latestConfirmed: FittingRecord | undefined;
  issueMap: Partial<Record<ValidationIssue["field"], string>>;
  onUpdate: (patch: Partial<DraftInput>) => void;
  onSaveDraft: () => void;
  onRegister: () => void;
  onDiscard: () => void;
}

const RATINGS: Rating[] = [1, 2, 3, 4, 5];
const FEEDBACK_LEVELS: FeedbackLevel[] = [0, 1, 2, 3];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="field-error">{message}</p>;
}

export function FittingForm({
  form,
  latestConfirmed,
  issueMap,
  onUpdate,
  onSaveDraft,
  onRegister,
  onDiscard,
}: FittingFormProps) {
  const rating = form.rating === 0 ? null : form.rating;
  const needBasis =
    (rating !== null && rating < GOOD_RATING_THRESHOLD) ||
    form.feedback > FEEDBACK_SECOND_LEVEL;

  return (
    <fieldset className="fitting-form">
      <div className="form-row">
        <label className={issueMap.gainDb ? "has-error" : ""}>
          <span>
            增益（dB）
            <em>范围 {GAIN_MIN_DB} ~ {GAIN_MAX_DB}</em>
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={GAIN_MIN_DB}
            max={GAIN_MAX_DB}
            value={form.gainDb}
            placeholder="例如 24"
            onChange={(e) => onUpdate({ gainDb: e.target.value })}
          />
          <FieldError message={issueMap.gainDb} />
        </label>

        <label className={issueMap.rating ? "has-error" : ""}>
          <span>
            听声评分
            <em>低于「良好」须写调整依据</em>
          </span>
          <div className="segmented" role="radiogroup" aria-label="听声评分">
            {RATINGS.map((value) => (
              <button
                type="button"
                role="radio"
                aria-checked={rating === value}
                key={value}
                className={rating === value ? "seg active rating" : "seg"}
                onClick={() => onUpdate({ rating: value })}
              >
                <b>{value}</b>
                {RATING_LABEL[value]}
              </button>
            ))}
          </div>
          <FieldError message={issueMap.rating} />
        </label>
      </div>

      <label className={issueMap.feedback ? "has-error" : ""}>
        <span>
          反馈（啸叫）等级
          <em>超过二级须写调整依据</em>
        </span>
        <div className="segmented" role="radiogroup" aria-label="反馈等级">
          {FEEDBACK_LEVELS.map((value) => (
            <button
              type="button"
              role="radio"
              aria-checked={form.feedback === value}
              key={value}
              className={`seg level-${value}${form.feedback === value ? " active" : ""}`}
              onClick={() => onUpdate({ feedback: value })}
            >
              {FEEDBACK_LABEL[value]}
            </button>
          ))}
        </div>
      </label>

      <label className={issueMap.basis ? "has-error" : ""}>
        <span>
          调整依据
          {needBasis ? <em className="required">必填：当前评分/反馈触发门槛</em> : <em>评分良好以上且反馈≤二级时可留空（仅存草稿）</em>}
        </span>
        <textarea
          rows={3}
          value={form.basis}
          placeholder={needBasis ? "请写明本次调整依据，如：2kHz 以上仍觉沉闷，高频增益上调 4 dB" : "未触发强制填写条件"}
          onChange={(e) => onUpdate({ basis: e.target.value })}
        />
        <FieldError message={issueMap.basis} />
      </label>

      {latestConfirmed && (
        <label className={issueMap.reason ? "has-error" : ""}>
          <span>
            本次调试原因
            <em className="required">
              已确认到 v{latestConfirmed.version}（{latestConfirmed.gainDb} dB），另建版本须填原因
            </em>
          </span>
          <textarea
            rows={2}
            value={form.reason}
            placeholder="如：使用两周后反馈嘈杂环境听不清，需要调整压缩参数"
            onChange={(e) => onUpdate({ reason: e.target.value })}
          />
          <FieldError message={issueMap.reason} />
        </label>
      )}

      <FieldError message={issueMap.form} />

      <div className="form-actions">
        <button type="button" className="primary-action" onClick={onRegister}>
          登记 · 进入等待确认
        </button>
        <button type="button" onClick={onSaveDraft}>
          只保存草稿
        </button>
        <button type="button" className="ghost" onClick={onDiscard}>
          清空
        </button>
      </div>
      <p className="rule-note">
        规则：评分低于良好或反馈超过二级时必须写明调整依据，否则只能保存草稿；同客户同耳同时只允许一条等待确认记录。
      </p>
    </fieldset>
  );
}
