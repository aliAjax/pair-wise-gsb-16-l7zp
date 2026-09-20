import { EAR_LABEL } from "../domain";
import type { FittingConflict } from "../domain";

/** 全局冲突面板：列出所有等待确认记录，固定带 客户、耳别、增益 */
export function ConflictPanel({
  conflicts,
  onLocate,
}: {
  conflicts: FittingConflict[];
  onLocate: (customerId: string, ear: "left" | "right") => void;
}) {
  if (conflicts.length === 0) {
    return (
      <section className="panel conflict-panel clear">
        <div className="section-heading compact">
          <div>
            <p>闭环状态</p>
            <h2>冲突队列</h2>
          </div>
          <span className="ok-badge">无等待确认</span>
        </div>
        <p className="empty-hint">所有调试均已确认冻结，或尚未登记。</p>
      </section>
    );
  }

  return (
    <section className="panel conflict-panel">
      <div className="section-heading compact">
        <div>
          <p>闭环状态 · {conflicts.length} 条阻塞</p>
          <h2>等待确认冲突</h2>
        </div>
      </div>
      <table className="conflict-table">
        <thead>
          <tr>
            <th>客户</th>
            <th>耳别</th>
            <th>阻塞增益</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((c) => (
            <tr key={c.blockedRecordId}>
              <td>{c.customerName}</td>
              <td>{EAR_LABEL[c.ear]}</td>
              <td><b>{c.blockedGainDb} dB</b></td>
              <td>
                <button type="button" onClick={() => onLocate(c.customerId, c.ear)}>
                  前往确认
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rule-note">
        冲突条目固定列出客户、耳别与增益；同一客户同一耳别在确认冻结前不能再登记新调试。
      </p>
    </section>
  );
}
