import { FEEDBACK_LABELS, RATING_LABELS } from "../domain/rules";
import type { FittingRecord, FittingState } from "../domain/types";

interface HistoryProps {
  state: FittingState;
  records: FittingRecord[];
  onConfirm: (recordId: string) => void;
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RecordCard({
  state,
  record,
  onConfirm,
}: {
  state: FittingState;
  record: FittingRecord;
  onConfirm: (id: string) => void;
}) {
  const isPending = record.status === "pending";
  const parent = record.parentId
    ? state.records.find((r) => r.id === record.parentId) ?? null
    : null;

  return (
    <article className={"version-card" + (isPending ? " pending" : " frozen")}>
      <header className="version-head">
        <div>
          <span className="version-tag">v{record.version}</span>
          <span className={"status-badge " + (isPending ? "badge-pending" : "badge-frozen")}>
            {isPending ? "等待确认" : "已确认 · 数值冻结"}
          </span>
        </div>
        <time>{formatTime(isPending ? record.createdAt : record.confirmedAt)}</time>
      </header>

      <dl className="value-grid">
        <div>
          <dt>增益</dt>
          <dd>
            {record.gainDb}
            <small> dB</small>
            {parent && (
              <em className={"delta " + (record.gainDb >= parent.gainDb ? "up" : "down")}>
                {record.gainDb >= parent.gainDb ? "▲" : "▼"}
                {Math.abs(record.gainDb - parent.gainDb)}
              </em>
            )}
          </dd>
        </div>
        <div>
          <dt>反馈等级</dt>
          <dd>{FEEDBACK_LABELS[record.feedback]}</dd>
        </div>
        <div>
          <dt>评分</dt>
          <dd>{RATING_LABELS[record.rating]}</dd>
        </div>
      </dl>

      {record.rationale && (
        <p className="note">
          <b>调整依据</b>
          {record.rationale}
        </p>
      )}
      {record.reason && (
        <p className="note reason-note">
          <b>再调原因</b>
          {record.reason}
        </p>
      )}

      {parent && (
        <p className="parent-line">
          上一版 v{parent.version} 旧值：{parent.gainDb}dB · {FEEDBACK_LABELS[parent.feedback]} ·
          {RATING_LABELS[parent.rating]}
          {parent.rationale ? ` · ${parent.rationale}` : ""}
        </p>
      )}

      {isPending && (
        <button className="primary-action confirm-btn" onClick={() => onConfirm(record.id)}>
          确认并冻结本版数值
        </button>
      )}
    </article>
  );
}

export function VersionHistory({ state, records, onConfirm }: HistoryProps) {
  const chain = [...records].sort((a, b) => b.version - a.version);
  if (chain.length === 0) {
    return <p className="empty-hint">该耳尚无调试记录，登记后形成 v1 版本链。</p>;
  }
  return (
    <div className="version-list">
      {chain.map((r) => (
        <RecordCard key={r.id} state={state} record={r} onConfirm={onConfirm} />
      ))}
    </div>
  );
}
