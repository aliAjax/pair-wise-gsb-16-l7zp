import { EAR_LABEL, FEEDBACK_LABEL, RATING_LABEL } from "../domain";
import type { FittingRecord } from "../domain";

interface PendingPanelProps {
  record: FittingRecord;
  onConfirm: (id: string) => void;
  onWithdraw: (id: string) => void;
}

/**
 * 当前耳的等待确认卡：确认 = 冻结数值；撤回 = 退回草稿。
 * 确认是唯一的冻结入口，页面不再提供任何「直接改确认值」的操作。
 */
export function PendingPanel({ record, onConfirm, onWithdraw }: PendingPanelProps) {
  return (
    <div className="pending-card">
      <div className="pending-head">
        <div>
          <p className="eyebrow">{EAR_LABEL[record.ear]} · v{record.version} 等待确认</p>
          <h3>增益 {record.gainDb} dB{record.previousValues && `（上一版 ${record.previousValues.gainDb} dB）`}</h3>
        </div>
        <span className="status-pill pending">待确认</span>
      </div>
      <div className="pending-grid">
        <div>
          <span>反馈等级</span>
          <strong>{FEEDBACK_LABEL[record.feedback]}</strong>
        </div>
        <div>
          <span>听声评分</span>
          <strong>{record.rating} · {RATING_LABEL[record.rating]}</strong>
        </div>
      </div>
      {record.basis && (
        <p className="record-note"><i>调整依据</i>{record.basis}</p>
      )}
      {record.version > 1 && (
        <p className="record-note reason"><i>调试原因</i>{record.reason || "—"}</p>
      )}
      {record.previousValues && (
        <p className="previous-values">
          旧值保留：增益 {record.previousValues.gainDb} dB ·
          反馈 {FEEDBACK_LABEL[record.previousValues.feedback]} ·
          评分 {record.previousValues.rating}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="primary-action" onClick={() => onConfirm(record.id)}>
          确认并冻结
        </button>
        <button type="button" onClick={() => onWithdraw(record.id)}>
          撤回到草稿
        </button>
      </div>
    </div>
  );
}
