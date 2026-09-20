import { useEffect, useState } from "react";
import {
  FEEDBACK_LABELS,
  GAIN_MAX,
  GAIN_MIN,
  RATING_LABELS,
  rationaleRequired,
} from "../domain/rules";
import type { Ear, FeedbackLevel, FittingRecord, Rating, TuningInput } from "../domain/types";
import type { FieldError } from "../domain/rules";

interface Props {
  ear: Ear;
  /** 再次调试时的冻结基线，初配为 null */
  frozenBase: FittingRecord | null;
  initial: TuningInput;
  errors: FieldError;
  onEdit: (patch: Partial<TuningInput>) => void;
  onSubmit: (input: TuningInput) => void;
  onAbandon: () => void;
  hasDraft: boolean;
}

const FEEDBACK_OPTIONS: FeedbackLevel[] = [0, 1, 2, 3, 4];
const RATING_OPTIONS: Rating[] = [1, 2, 3, 4];

export function TuningForm({
  ear,
  frozenBase,
  initial,
  errors,
  onEdit,
  onSubmit,
  onAbandon,
  hasDraft,
}: Props) {
  // 表单仅保留本地输入态；每次编辑同步写入该 客户+耳别 的草稿槽位
  const [form, setForm] = useState<TuningInput>(initial);
  // 增益用本地文本态，容纳 "-" 等输入中间态
  const [gainText, setGainText] = useState(
    initial.gainDb === null ? "" : String(initial.gainDb),
  );

  // 组件按「客户+耳别」以 key 重挂；登记成功（initial 引用变化）时也重建表单
  useEffect(() => {
    setForm(initial);
    setGainText(initial.gainDb === null ? "" : String(initial.gainDb));
  }, [initial]);

  const patch = (p: Partial<TuningInput>) => {
    // 函数式更新：同一轮事件里连续修改多个字段时不互相覆盖
    setForm((prev) => ({ ...prev, ...p }));
    onEdit(p);
  };

  const onGainChange = (text: string) => {
    setGainText(text);
    if (text.trim() === "") {
      patch({ gainDb: null });
      return;
    }
    const n = Number(text);
    // NaN（如单独的 "-"）不写入草稿数值，待提交时再报错
    patch({ gainDb: Number.isFinite(n) ? n : null });
  };

  const needRationale = rationaleRequired(form);

  const submit = () => {
    const n = gainText.trim() === "" ? null : Number(gainText);
    const parsed: TuningInput = {
      ...form,
      // 非数字中间态以 null 提交，由规则层报「请填写增益」
      gainDb: n !== null && Number.isFinite(n) ? n : null,
    };
    onSubmit(parsed);
  };

  return (
    <div className="tuning-form">
      {frozenBase && (
        <div className="baseline-hint">
          基于已冻结的 <strong>v{frozenBase.version}</strong> 继续调试 · 旧值：增益{" "}
          {frozenBase.gainDb}dB / 反馈{FEEDBACK_LABELS[frozenBase.feedback]} /{" "}
          {RATING_LABELS[frozenBase.rating]}。登记后将生成
          <strong> v{frozenBase.version + 1}</strong>，并完整保留旧版本数值与原因。
        </div>
      )}

      <div className="form-row">
        <label className="field">
          <span>{ear === "L" ? "左耳" : "右耳"}增益（dB）</span>
          <input
            type="number"
            step={1}
            min={GAIN_MIN}
            max={GAIN_MAX}
            value={gainText}
            placeholder={`${GAIN_MIN} ~ ${GAIN_MAX}`}
            onChange={(e) => onGainChange(e.target.value)}
          />
          {errors.gainDb && <em className="field-error">{errors.gainDb}</em>}
        </label>

        <fieldset className="field">
          <legend>反馈（啸叫）等级</legend>
          <div className="seg">
            {FEEDBACK_OPTIONS.map((level) => (
              <button
                type="button"
                key={level}
                className={"seg-btn" + (form.feedback === level ? " active danger-" + Math.min(level, 3) : "")}
                onClick={() => patch({ feedback: level })}
              >
                {FEEDBACK_LABELS[level]}
              </button>
            ))}
          </div>
          {errors.feedback && <em className="field-error">{errors.feedback}</em>}
        </fieldset>

        <fieldset className="field">
          <legend>试听评分</legend>
          <div className="seg">
            {RATING_OPTIONS.map((r) => (
              <button
                type="button"
                key={r}
                className={"seg-btn rating-" + r + (form.rating === r ? " active" : "")}
                onClick={() => patch({ rating: r })}
              >
                {RATING_LABELS[r]}
              </button>
            ))}
          </div>
          {errors.rating && <em className="field-error">{errors.rating}</em>}
        </fieldset>
      </div>

      <label className="field field-block">
        <span>
          调整依据
          {needRationale ? (
            <b className="required-flag">必填 · 评分低于良好或反馈超过二级</b>
          ) : (
            <i className="optional-flag">选填</i>
          )}
        </span>
        <textarea
          rows={2}
          maxLength={300}
          value={form.rationale}
          placeholder={
            needRationale
              ? "请写明本次调整的听力学依据，例如啸叫频段、主诉与处理思路"
              : "记录调整思路（选填）"
          }
          onChange={(e) => patch({ rationale: e.target.value })}
        />
        {errors.rationale && <em className="field-error">{errors.rationale}</em>}
      </label>

      {frozenBase && (
        <label className="field field-block">
          <span>
            调整原因<b className="required-flag">必填 · 已确认版本再调试</b>
          </span>
          <textarea
            rows={2}
            maxLength={300}
            value={form.reason}
            placeholder="说明为何在已冻结数值上再次调整，旧版本将保留"
            onChange={(e) => patch({ reason: e.target.value })}
          />
          {errors.reason && <em className="field-error">{errors.reason}</em>}
        </label>
      )}

      <div className="form-actions">
        <button className="primary-action" type="button" onClick={submit}>
          登记调试（进入等待确认）
        </button>
        <button type="button" onClick={onAbandon} disabled={!hasDraft}>
          丢弃草稿
        </button>
        <span className="draft-state">{hasDraft ? "已自动保存为草稿" : "尚未形成草稿"}</span>
      </div>
    </div>
  );
}
