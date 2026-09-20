/**
 * 状态编排层：React 与纯领域状态机之间的适配器。
 * 业务规则全部在 domain/ 内，这里只负责调用、持久化与界面通知。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadState, saveState } from "../domain/persistence";
import {
  confirmRecord,
  discardDraft,
  draftKey,
  EMPTY_INPUT,
  getDraft,
  integrityCheck,
  latestFrozen,
  pendingRecord,
  recordsForEar,
  registerTuning,
  removeRecord,
  updateDraft,
} from "../domain/store";
import { buildSeedState, SEED_CUSTOMERS } from "../domain/seed";
import { validateTuning, type FieldError } from "../domain/rules";
import type { Conflict, Customer, Ear, FittingState, TuningInput } from "../domain/types";

const SELECTION_KEY = "hxwl-01.fitting.selection.v1";

export interface Notice {
  tone: "success" | "warn" | "danger";
  text: string;
}

export interface Selection {
  customerId: string;
  ear: Ear;
}

interface Persisted {
  state: FittingState;
  conflicts: Conflict[];
}

function initPersisted(): Persisted {
  const loaded = loadState();
  if (loaded.state) return { state: loaded.state, conflicts: loaded.conflicts };
  return { state: buildSeedState(Date.now()), conflicts: [] };
}

function loadSelection(fallback: Customer[]): Selection {
  const fallbackSel: Selection = { customerId: fallback[0]?.id ?? "", ear: "L" };
  if (typeof localStorage === "undefined") return fallbackSel;
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Selection;
      if (
        parsed &&
        fallback.some((c) => c.id === parsed.customerId) &&
        (parsed.ear === "L" || parsed.ear === "R")
      ) {
        return parsed;
      }
    }
  } catch {
    // fallthrough
  }
  return fallbackSel;
}

export function useFittingStore() {
  const [persisted, setPersisted] = useState<Persisted>(initPersisted);
  const [selection, setSelectionState] = useState<Selection>(() =>
    loadSelection(persisted.state.customers.length ? persisted.state.customers : SEED_CUSTOMERS),
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 最近一次「登记」失败的槽位与其完整校验错误；编辑中错误实时派生 */
  const [submitErrors, setSubmitErrors] = useState<{ slot: string; errors: FieldError } | null>(
    null,
  );
  const [registerConflict, setRegisterConflict] = useState<Conflict | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const state = persisted.state;
  // 始终指向最新状态：同一轮事件里连续编辑多个字段时逐次累积，杜绝闭包旧值覆盖
  const stateRef = useRef(state);
  stateRef.current = state;

  // 任意变更后整体持久化：客户、记录、草稿、版本关系一个快照
  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
    } catch {
      // ignore
    }
  }, [selection]);

  const flash = useCallback((next: Notice) => {
    setNotice(next);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  /* ---------- 选择切换（草稿归属不变，不会串台） ---------- */

  const selectCustomer = useCallback((customerId: string) => {
    setRegisterConflict(null);
    setSubmitErrors(null);
    setSelectionState((s) => ({ ...s, customerId }));
  }, []);

  const selectEar = useCallback((ear: Ear) => {
    setRegisterConflict(null);
    setSubmitErrors(null);
    setSelectionState((s) => ({ ...s, ear }));
  }, []);

  /* ---------- 视图数据 ---------- */

  const { customerId, ear } = selection;
  const slot = draftKey(customerId, ear);

  const pending = useMemo(
    () => pendingRecord(state, customerId, ear),
    [state, customerId, ear],
  );
  const frozenBase = useMemo(
    () => latestFrozen(state, customerId, ear),
    [state, customerId, ear],
  );
  const history = useMemo(
    () => recordsForEar(state, customerId, ear),
    [state, customerId, ear],
  );
  const draft = useMemo(() => getDraft(state, customerId, ear), [state, customerId, ear]);

  /** 各客户/耳别是否有未保存草稿，用于侧边栏角标 */
  const draftSlotKeys = useMemo(() => new Set(Object.keys(state.drafts)), [state.drafts]);

  /** 表单初值：有草稿取草稿，否则空表单（有等待确认时页面不显示表单） */
  const formInitial: TuningInput = useMemo(
    () => (draft ? { ...EMPTY_INPUT, ...draft } : { ...EMPTY_INPUT }),
    [draft],
  );

  /** 当前槽位要展示的错误：优先登记失败的完整错误，否则用草稿实时轻校验 */
  const formErrors: FieldError = useMemo(() => {
    if (submitErrors && submitErrors.slot === slot) return submitErrors.errors;
    if (draft) {
      return validateTuning(draft, { reasonRequired: frozenBase !== null, partial: true });
    }
    return {};
  }, [submitErrors, slot, draft, frozenBase]);

  /* ---------- 表单编辑（仅写当前 客户+耳别 的草稿槽位） ---------- */

  const editDraft = useCallback(
    (patch: Partial<TuningInput>) => {
      const base = stateRef.current;
      const result = updateDraft(base, customerId, ear, patch, Date.now());
      stateRef.current = result.state;
      setPersisted((p) => ({ ...p, state: result.state }));
      // 一旦继续编辑，上次的登记失败错误作废，改由实时派生
      setSubmitErrors((cur) => (cur && cur.slot === slot ? null : cur));
    },
    [customerId, ear, slot],
  );

  const abandonDraft = useCallback(() => {
    setPersisted((p) => ({ ...p, state: discardDraft(p.state, customerId, ear) }));
    setSubmitErrors(null);
    flash({ tone: "warn", text: "草稿已丢弃，未产生任何调试记录" });
  }, [customerId, ear, flash]);

  /* ---------- 正式登记 / 确认 ---------- */

  const register = useCallback(
    (input: TuningInput): boolean => {
      const current = stateRef.current;
      const result = registerTuning(current, customerId, ear, input, Date.now());
      if (result.conflict) {
        setRegisterConflict(result.conflict);
        flash({
          tone: "danger",
          text: "该耳已有等待确认记录，无法重复登记，请先确认或处理冲突",
        });
        return false;
      }
      if (Object.keys(result.errors).length > 0) {
        // 校验不过：输入内容同时留作该 客户+耳别 的草稿，不产生记录
        const withDraft = updateDraft(current, customerId, ear, { ...input }, Date.now());
        stateRef.current = withDraft.state;
        setPersisted((p) => ({ ...p, state: withDraft.state }));
        setSubmitErrors({ slot, errors: result.errors });
        flash({ tone: "warn", text: "校验未通过，已保留为草稿，补齐后再登记" });
        return false;
      }
      stateRef.current = result.state!;
      setPersisted((p) => ({ ...p, state: result.state! }));
      setSubmitErrors(null);
      setRegisterConflict(null);
      flash({ tone: "success", text: "已登记为「等待确认」，确认后数值将冻结" });
      return true;
    },
    [customerId, ear, slot, flash],
  );

  const confirm = useCallback(
    (recordId: string) => {
      setPersisted((p) => ({ ...p, state: confirmRecord(p.state, recordId, Date.now()) }));
      setRegisterConflict(null);
      flash({ tone: "success", text: "已确认，增益等数值已冻结；再调试将另建版本并保留旧值" });
    },
    [flash],
  );

  /* ---------- 冲突修复 ---------- */

  const integrityConflicts = persisted.conflicts;

  /** 冲突解除后基于最新状态重新巡检 */
  const refreshConflicts = useCallback((next: FittingState): Conflict[] => integrityCheck(next), []);

  /** 确认占位记录（适用于登记冲突与巡检冲突） */
  const resolveByConfirming = useCallback(
    (blockingRecordId: string) => {
      setPersisted((p) => {
        const next = confirmRecord(p.state, blockingRecordId, Date.now());
        return { state: next, conflicts: refreshConflicts(next) };
      });
      setRegisterConflict((c) => (c?.blockingRecordId === blockingRecordId ? null : c));
      flash({ tone: "success", text: "已确认原有等待确认记录，冲突解除" });
    },
    [flash, refreshConflicts],
  );

  /** 删除本次重复登记的记录，保留占位的等待确认记录 */
  const resolveByRemoving = useCallback(
    (recordId: string) => {
      setPersisted((p) => {
        const next = removeRecord(p.state, recordId);
        return { state: next, conflicts: refreshConflicts(next) };
      });
      setRegisterConflict((c) => (c?.recordId === recordId ? null : c));
      flash({ tone: "warn", text: "已删除重复的等待确认记录" });
    },
    [flash, refreshConflicts],
  );

  const resetAll = useCallback(() => {
    const seed = buildSeedState(Date.now());
    stateRef.current = seed;
    setPersisted({ state: seed, conflicts: [] });
    setRegisterConflict(null);
    setSubmitErrors(null);
    flash({ tone: "warn", text: "已重置为示例数据" });
  }, [flash]);

  return {
    state,
    customers: state.customers,
    selection,
    selectCustomer,
    selectEar,
    // 当前耳视图
    pending,
    frozenBase,
    history,
    draft,
    formInitial,
    draftSlotKeys,
    // 草稿
    editDraft,
    abandonDraft,
    // 记录
    register,
    confirm,
    // 冲突
    integrityConflicts,
    registerConflict,
    resolveByConfirming,
    resolveByRemoving,
    // 其他
    notice,
    formErrors,
    resetAll,
  };
}

export type FittingStore = ReturnType<typeof useFittingStore>;
