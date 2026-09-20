import { EAR_LABEL, FEEDBACK_LABEL, RATING_LABEL, STATUS_LABEL } from "../domain";
import type { FittingRecord } from "../domain";

function ValuesView({
  gainDb,
  feedback,
  rating,
}: {
  gainDb: number;
  feedback: number;
  rating: number;
}) {
  return (
    <span className="values-line">
      <b>{gainDb} dB</b>
      <span>反馈 {FEEDBACK_LABEL[feedback]}</span>
      <span>评分 {rating} · {RATING_LABEL[rating as 1 | 2 | 3 | 4 | 5]}</span>
    </span>
  );
}

export function VersionTimeline({ history }: { history: FittingRecord[] }) {
  if (history.length === 0) {
    return <p className="empty-hint">该耳暂无调试记录，首次登记后形成 v1。</p>;
  }
  const newestFirst = [...history].sort((a, b) => b.version - a.version);

  return (
    <ol className="timeline">
      {newestFirst.map((record) => {
        const frozen = record.status === "confirmed";
        return (
          <li key={record.id} className={`timeline-item ${record.status}`}>
            <div className="timeline-head">
              <span className="version-tag">v{record.version}</span>
              <span className={`status-pill ${record.status}`}>{STATUS_LABEL[record.status]}</span>
              {frozen && <span className="frozen-tag">已冻结 {record.gainDb} dB</span>}
              <time>{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</time>
            </div>
            <ValuesView gainDb={record.gainDb} feedback={record.feedback} rating={record.rating} />
            {record.basis && (
              <p className="record-note"><i>调整依据</i>{record.basis}</p>
            )}
            {record.version > 1 && (
              <p className="record-note reason"><i>调试原因</i>{record.reason || "—"}</p>
            )}
            {record.previousValues && (
              <p className="previous-values">
                上一版旧值：{EAR_LABEL[record.ear]} 增益 {record.previousValues.gainDb} dB ·
                反馈 {FEEDBACK_LABEL[record.previousValues.feedback]} ·
                评分 {record.previousValues.rating}（{RATING_LABEL[record.previousValues.rating]}）
              </p>
            )}
            {record.confirmedAt && (
              <p className="confirmed-at">确认时间：{new Date(record.confirmedAt).toLocaleString("zh-CN", { hour12: false })}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
