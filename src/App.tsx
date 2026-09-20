import "./styles.css";
import { useFittingStore } from "./hooks/useFittingStore";
import { FittingForm } from "./components/FittingForm";
import { PendingPanel } from "./components/PendingPanel";
import { VersionTimeline } from "./components/VersionTimeline";
import { ConflictPanel } from "./components/ConflictPanel";
import { EAR_LABEL, EARS } from "./domain";
import type { Ear } from "./domain";

function App() {
  const store = useFittingStore();
  const {
    state,
    currentCustomerId,
    currentEar,
    currentForm,
    notice,
    integrityErrors,
    pendingRecord,
    latestConfirmed,
    history,
    blocked,
    pendingConflicts,
  } = store;

  const currentCustomer = state.customers.find((c) => c.id === currentCustomerId);

  const earState = (customerId: string, ear: Ear) => {
    const recs = state.records.filter((r) => r.customerId === customerId && r.ear === ear);
    const pending = recs.some((r) => r.status === "pending");
    const confirmed = recs.filter((r) => r.status === "confirmed").length;
    const draft = Boolean(state.drafts[`${customerId}::${ear}`]);
    return { pending, confirmed, draft };
  };

  const locateConflict = (customerId: string, ear: Ear) => {
    store.selectCustomer(customerId);
    store.selectEar(ear);
  };

  const stats = {
    pending: pendingConflicts.length,
    confirmed: state.records.filter((r) => r.status === "confirmed").length,
    drafts: Object.keys(state.drafts).length,
    versions: state.records.length,
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-01 · 助听器调试闭环</p>
          <h1>听力验配 · 增益调试工作台</h1>
          <p className="subtitle">
            登记左右耳增益、反馈等级与评分；不满足依据规则只能留草稿。确认后数值冻结，再次调试另建版本并保留旧值。
          </p>
        </div>
        <div className="stack-card">
          <span>闭环统计</span>
          <div className="stat-row">
            <strong>{stats.pending}</strong><i>等待确认</i>
          </div>
          <div className="stat-row">
            <strong>{stats.confirmed}</strong><i>已冻结版本</i>
          </div>
          <div className="stat-row">
            <strong>{stats.drafts}</strong><i>草稿</i>
          </div>
          <button type="button" className="ghost reset-btn" onClick={store.resetAll}>
            重置演示数据
          </button>
        </div>
      </section>

      {integrityErrors.length > 0 && (
        <div className="banner danger">
          <b>重载一致性检查发现问题：</b>
          <ul>{integrityErrors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {notice && <div className="banner info">{notice}</div>}

      <section className="workspace">
        <aside className="panel narrow">
          <h2>客户档案</h2>
          <div className="customer-list">
            {state.customers.map((customer) => {
              const active = customer.id === currentCustomerId;
              const left = earState(customer.id, "left");
              const right = earState(customer.id, "right");
              const hasAnyDraft = left.draft || right.draft;
              return (
                <button
                  type="button"
                  key={customer.id}
                  className={`customer-card${active ? " active" : ""}`}
                  onClick={() => store.selectCustomer(customer.id)}
                >
                  <span className="customer-code">{customer.code}</span>
                  <strong>{customer.name}</strong>
                  <small>{customer.note}</small>
                  <span className="ear-dots">
                    {EARS.map((ear) => {
                      const s = ear === "left" ? left : right;
                      const cls = s.pending ? "dot pending" : s.confirmed > 0 ? "dot confirmed" : "dot empty";
                      return (
                        <i key={ear} className={cls} title={`${EAR_LABEL[ear]} ${s.pending ? "等待确认" : s.confirmed > 0 ? `已确认 v${s.confirmed}` : "无记录"}`}>
                          {EAR_LABEL[ear].slice(0, 1)}
                        </i>
                      );
                    })}
                    {hasAnyDraft && <em className="draft-flag">草稿</em>}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="rule-note small">
            切换客户时，未保存的草稿跟随原客户保存，不会串到其他客户。
          </p>
        </aside>

        <section className="panel main-panel">
          <div className="section-heading">
            <div>
              <p>{currentCustomer?.code} · {currentCustomer?.note}</p>
              <h2>{currentCustomer?.name} 的助听器调试</h2>
            </div>
            <div className="ear-tabs" role="tablist">
              {EARS.map((ear) => {
                const s = earState(currentCustomerId, ear);
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={currentEar === ear}
                    key={ear}
                    className={`ear-tab${currentEar === ear ? " active" : ""}`}
                    onClick={() => store.selectEar(ear)}
                  >
                    {EAR_LABEL[ear]}
                    {s.pending && <i className="mini-badge pending">待确认</i>}
                    {!s.pending && s.confirmed > 0 && <i className="mini-badge confirmed">v{s.confirmed}</i>}
                  </button>
                );
              })}
            </div>
          </div>

          {blocked && pendingRecord ? (
            <PendingPanel
              record={pendingRecord}
              onConfirm={store.handleConfirm}
              onWithdraw={store.handleWithdraw}
            />
          ) : (
            <FittingForm
              form={currentForm}
              latestConfirmed={latestConfirmed}
              issueMap={store.issueMap}
              onUpdate={store.updateForm}
              onSaveDraft={store.handleSaveDraft}
              onRegister={store.handleRegister}
              onDiscard={store.handleDiscardDraft}
            />
          )}

          <div className="timeline-block">
            <h3>{EAR_LABEL[currentEar]}版本链{latestConfirmed && <em>（当前冻结：v{latestConfirmed.version} / {latestConfirmed.gainDb} dB）</em>}</h3>
            <VersionTimeline history={history} />
          </div>
        </section>
      </section>

      <ConflictPanel conflicts={pendingConflicts} onLocate={locateConflict} />
    </main>
  );
}

export default App;
