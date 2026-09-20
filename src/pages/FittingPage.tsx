import { useMemo } from "react";
import { useFittingStore } from "../state/useFittingStore";
import { TuningForm } from "../components/TuningForm";
import { VersionHistory } from "../components/VersionHistory";
import { ConflictPanel } from "../components/ConflictPanel";
import { FEEDBACK_LABELS, RATING_LABELS } from "../domain/rules";
import { draftKey } from "../domain/store";
import type { Ear } from "../domain/types";

const EAR_TABS: Ear[] = ["L", "R"];
const EAR_NAME: Record<Ear, string> = { L: "左耳", R: "右耳" };

export function FittingPage() {
  const store = useFittingStore();
  const {
    state,
    customers,
    selection,
    selectCustomer,
    selectEar,
    pending,
    frozenBase,
    history,
    draft,
    formInitial,
    draftSlotKeys,
    editDraft,
    abandonDraft,
    register,
    confirm,
    integrityConflicts,
    registerConflict,
    resolveByConfirming,
    resolveByRemoving,
    notice,
    formErrors,
    resetAll,
  } = store;

  const customer = customers.find((c) => c.id === selection.customerId) ?? customers[0];

  const stats = useMemo(() => {
    const pendingCount = state.records.filter((r) => r.status === "pending").length;
    const frozenCount = state.records.filter((r) => r.status === "confirmed").length;
    return { pendingCount, frozenCount, draftCount: Object.keys(state.drafts).length };
  }, [state.records, state.drafts]);

  return (
    <main className="app-shell fitting-shell">
      <section className="hero fitting-hero">
        <div>
          <p className="eyebrow">助听器调试闭环 · 左耳 / 右耳</p>
          <h1>听力验配记录</h1>
          <p className="subtitle">
            登记左右耳增益、反馈等级与试听评分；评分低于良好或反馈超过二级须写调整依据。
            确认后数值冻结，再调试另建带原因的新版本并保留旧值。
          </p>
        </div>
        <div className="stack-card">
          <span>闭环状态</span>
          <strong>
            等待确认 {stats.pendingCount} 条 · 已冻结 {stats.frozenCount} 版 · 草稿{" "}
            {stats.draftCount} 份
          </strong>
          <button className="reset-btn" onClick={resetAll}>
            重置为示例数据
          </button>
        </div>
      </section>

      <ConflictPanel
        conflicts={integrityConflicts}
        live={registerConflict}
        onConfirmBlocking={resolveByConfirming}
        onRemove={resolveByRemoving}
      />

      {notice && <div className={"notice notice-" + notice.tone}>{notice.text}</div>}

      <section className="workspace fitting-workspace">
        <aside className="panel narrow customer-list">
          <h2>客户档案</h2>
          {customers.map((c) => {
            const active = c.id === customer?.id;
            const pendingHere = state.records.some(
              (r) => r.customerId === c.id && r.status === "pending",
            );
            return (
              <button
                key={c.id}
                className={"customer-card" + (active ? " active" : "")}
                onClick={() => selectCustomer(c.id)}
              >
                <span className="customer-code">{c.code}</span>
                <span className="customer-name">{c.name.split(" · ")[1] ?? c.name}</span>
                <span className="customer-flags">
                  {EAR_TABS.map((e) => {
                    const hasDraft = draftSlotKeys.has(draftKey(c.id, e));
                    return (
                      <i
                        key={e}
                        className={"ear-dot" + (hasDraft ? " has-draft" : "")}
                        title={hasDraft ? `${EAR_NAME[e]}有未保存草稿` : `${EAR_NAME[e]}无草稿`}
                      >
                        {e}
                      </i>
                    );
                  })}
                  {pendingHere && <b className="pending-flag">待确认</b>}
                </span>
              </button>
            );
          })}
          <p className="sidebar-tip">
            标记 <b>L/R</b> 表示该耳有未保存草稿；草稿按「客户 + 耳别」隔离，切换客户不会串台，刷新后仍在原位。
          </p>
        </aside>

        <section className="panel fitting-main">
          <div className="section-heading customer-heading">
            <div>
              <p>{customer?.code}</p>
              <h2>{customer?.name}</h2>
            </div>
            <div className="ear-tabs" role="tablist">
              {EAR_TABS.map((e) => (
                <button
                  key={e}
                  role="tab"
                  aria-selected={selection.ear === e}
                  className={"ear-tab" + (selection.ear === e ? " active" : "")}
                  onClick={() => selectEar(e)}
                >
                  {EAR_NAME[e]}
                  {draftSlotKeys.has(draftKey(customer.id, e)) && <i className="tab-dot" />}
                </button>
              ))}
            </div>
          </div>

          {pending ? (
            <div className="pending-gate">
              <div className="pending-gate-banner">
                <strong>该耳存在等待确认记录</strong>
                <span>
                  同客户同耳别只能有一条等待确认记录。请先确认冻结下方版本；确认后如需继续调试，将以新版本登记并保留旧值。
                </span>
              </div>
              <article className="version-card pending gate-card">
                <header className="version-head">
                  <div>
                    <span className="version-tag">v{pending.version}</span>
                    <span className="status-badge badge-pending">等待确认</span>
                  </div>
                </header>
                <dl className="value-grid">
                  <div>
                    <dt>增益</dt>
                    <dd>
                      {pending.gainDb}
                      <small> dB</small>
                    </dd>
                  </div>
                  <div>
                    <dt>反馈等级</dt>
                    <dd>{FEEDBACK_LABELS[pending.feedback]}</dd>
                  </div>
                  <div>
                    <dt>评分</dt>
                    <dd>{RATING_LABELS[pending.rating]}</dd>
                  </div>
                </dl>
                {pending.rationale && (
                  <p className="note">
                    <b>调整依据</b>
                    {pending.rationale}
                  </p>
                )}
                <button className="primary-action confirm-btn" onClick={() => confirm(pending.id)}>
                  确认并冻结 v{pending.version}
                </button>
              </article>
            </div>
          ) : (
            <TuningForm
              key={draftKey(customer.id, selection.ear)}
              ear={selection.ear}
              frozenBase={frozenBase}
              initial={formInitial}
              errors={formErrors}
              onEdit={editDraft}
              onSubmit={register}
              onAbandon={abandonDraft}
              hasDraft={!!draft}
            />
          )}

          <div className="history-block">
            <div className="history-title">
              <h3>{EAR_NAME[selection.ear]}版本链</h3>
              <span>{history.length} 条记录</span>
            </div>
            <VersionHistory state={state} records={history} onConfirm={confirm} />
          </div>
        </section>
      </section>
    </main>
  );
}
