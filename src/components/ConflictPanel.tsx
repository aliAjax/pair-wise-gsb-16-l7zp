import type { Conflict } from "../domain/types";

interface Props {
  conflicts: Conflict[];
  /** 登记时实时产生的冲突（与巡检冲突合并展示） */
  live: Conflict | null;
  onConfirmBlocking: (blockingRecordId: string) => void;
  onRemove: (recordId: string) => void;
}

function earLabel(ear: Conflict["ear"]): string {
  return ear === "L" ? "左耳" : "右耳";
}

function ConflictRow({
  conflict,
  live,
  onConfirmBlocking,
  onRemove,
}: {
  conflict: Conflict;
  live: boolean;
  onConfirmBlocking: Props["onConfirmBlocking"];
  onRemove: Props["onRemove"];
}) {
  return (
    <article className="conflict-card">
      <header>
        <span className="conflict-title">
          {live ? "登记冲突" : "数据冲突"} · {conflict.customerName} · {earLabel(conflict.ear)}
        </span>
      </header>
      <table className="conflict-table">
        <thead>
          <tr>
            <th>客户</th>
            <th>耳别</th>
            <th>已有等待确认增益</th>
            <th>本次/重复记录增益</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{conflict.customerName}</td>
            <td>{earLabel(conflict.ear)}</td>
            <td className="gain-cell">{conflict.blockingGainDb} dB</td>
            <td className="gain-cell">
              {conflict.submittedGainDb === null
                ? `${conflict.gainDb} dB（巡检发现）`
                : `${conflict.submittedGainDb} dB`}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="conflict-rule">
        规则：同客户同耳别只能有一条等待确认记录。请确认并冻结原记录，或删除重复记录后再操作。
      </p>
      <div className="conflict-actions">
        <button className="primary-action" onClick={() => onConfirmBlocking(conflict.blockingRecordId)}>
          确认并冻结原记录（{conflict.blockingGainDb}dB）
        </button>
        {conflict.source === "integrity" && (
          <button onClick={() => onRemove(conflict.recordId)}>
            删除重复记录（{conflict.gainDb}dB）
          </button>
        )}
      </div>
    </article>
  );
}

export function ConflictPanel({ conflicts, live, onConfirmBlocking, onRemove }: Props) {
  const seen = new Set<string>();
  const all: Array<{ conflict: Conflict; live: boolean }> = [];
  for (const c of conflicts) {
    seen.add(c.recordId);
    all.push({ conflict: c, live: false });
  }
  if (live && !seen.has(live.recordId)) all.unshift({ conflict: live, live: true });
  if (all.length === 0) return null;

  return (
    <section className="conflict-panel">
      <h2>冲突处理</h2>
      {all.map(({ conflict, live: isLive }) => (
        <ConflictRow
          key={(isLive ? "live-" : "") + conflict.recordId}
          conflict={conflict}
          live={isLive}
          onConfirmBlocking={onConfirmBlocking}
          onRemove={onRemove}
        />
      ))}
    </section>
  );
}
