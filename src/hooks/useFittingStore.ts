import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmFitting,
  createInitialState,
  discardDraft,
  draftKey,
  earHistory,
  findLatestConfirmed,
  findPendingRecord,
  getOrInitDraft,
  isBlocked,
  listAllPendingConflicts,
  loadState,
  registerFitting,
  saveDraft,
  saveState,
  withdrawPending,
} from "../domain";
import type { DraftInput, Ear, FittingState, ValidationIssue } from "../domain";

const SELECTION_KEY = "hxwl-fitting-selection-v1";

type FormMap = Record<string, DraftInput>;

function toFormInput(d: ReturnType<typeof getOrInitDraft>): DraftInput {
  return {
    gainDb: d.gainDb,
    feedback: d.feedback,
    rating: d.rating,
    basis: d.basis,
    reason: d.reason,
  };
}

function loadSelection(customers: { id: string }[]): { customerId: string; ear: Ear } | null {
  try {
    const raw = window.localStorage.getItem(SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { customerId?: unknown; ear?: unknown };
    if (
      typeof parsed.customerId === "string" &&
      (parsed.ear === "left" || parsed.ear === "right") &&
      customers.some((c) => c.id === parsed.customerId)
    ) {
      return { customerId: parsed.customerId, ear: parsed.ear };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function useFittingStore() {
  const bootRef = useRef<ReturnType<typeof loadState> | null>(null);
  const boot = (bootRef.current ??= loadState());
  const initialSelection = loadSelection(boot.state.customers);

  const [state, setState] = useState<FittingState>(boot.state);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [integrityErrors] = useState<string[]>(boot.errors);
  const [currentCustomerId, setCurrentCustomerId] = useState<string>(
    initialSelection?.customerId ?? boot.state.customers[0]?.id ?? "",
  );
  const [currentEar, setCurrentEar] = useState<Ear>(initialSelection?.ear ?? "right");

  /**
   * 各「客户::耳」的表单输入缓存。初始值来自持久化草稿；
   * 编辑即时按归属 key 写入 drafts——草稿物理隔离，切换客户不可能串台。
   */
  const formsRef = useRef<FormMap | null>(null);

  const keyOf = draftKey;

  const getForm = useCallback(
    (customerId: string, ear: Ear): DraftInput => {
      const map = (formsRef.current ??= {});
      const key = keyOf(customerId, ear);
      if (!map[key]) {
        map[key] = toFormInput(getOrInitDraft(state, customerId, ear));
      }
      return map[key];
    },
    [keyOf, state],
  );

  // state 变化后持久化（checkIntegrity 不通过则拒写）
  useEffect(() => {
    const errors = saveState(state);
    if (errors.length > 0) setNotice(`状态一致性校验未通过，未写入存档：${errors[0]}`);
  }, [state]);

  // 记住当前选择，重载后回到同一客户/耳别
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SELECTION_KEY,
        JSON.stringify({ customerId: currentCustomerId, ear: currentEar }),
      );
    } catch {
      /* ignore */
    }
  }, [currentCustomerId, currentEar]);

  /** 把指定表单缓存刷入领域草稿（卸载/切走前兜底） */
  const flushForm = useCallback(
    (customerId: string, ear: Ear) => {
      const input = formsRef.current?.[keyOf(customerId, ear)];
      if (input) setState((prev) => saveDraft(prev, customerId, ear, input));
    },
    [keyOf],
  );

  const selectCustomer = useCallback(
    (customerId: string) => {
      if (customerId === currentCustomerId) return;
      flushForm(currentCustomerId, currentEar);
      setCurrentCustomerId(customerId);
      setIssues([]);
      setNotice("");
    },
    [currentCustomerId, currentEar, flushForm],
  );

  const selectEar = useCallback(
    (ear: Ear) => {
      if (ear === currentEar) return;
      flushForm(currentCustomerId, currentEar);
      setCurrentEar(ear);
      setIssues([]);
    },
    [currentCustomerId, currentEar, flushForm],
  );

  /** 编辑：更新内存缓存并立即按「客户::耳」落草稿（隔离 + 可重载恢复） */
  const updateForm = useCallback(
    (patch: Partial<DraftInput>) => {
      setState((prev) => {
        const map = (formsRef.current ??= {});
        const key = keyOf(currentCustomerId, currentEar);
        const base = map[key] ?? toFormInput(getOrInitDraft(prev, currentCustomerId, currentEar));
        const merged = { ...base, ...patch };
        map[key] = merged;
        return saveDraft(prev, currentCustomerId, currentEar, merged);
      });
    },
    [currentCustomerId, currentEar, keyOf],
  );

  const handleSaveDraft = useCallback(() => {
    const input = getForm(currentCustomerId, currentEar);
    setState((prev) => saveDraft(prev, currentCustomerId, currentEar, input));
    setIssues([]);
    setNotice("已保留草稿：未满足依据规则的内容不会进入待确认队列。");
  }, [currentCustomerId, currentEar, getForm]);

  const handleRegister = useCallback(() => {
    const input = getForm(currentCustomerId, currentEar);
    const result = registerFitting(state, currentCustomerId, currentEar, input);
    if (!result.ok) {
      setIssues(result.issues);
      setState((prev) => saveDraft(prev, currentCustomerId, currentEar, input));
      setNotice("未达到登记条件，已只保留草稿。");
      return;
    }
    if (formsRef.current) delete formsRef.current[keyOf(currentCustomerId, currentEar)];
    setState(result.state);
    setIssues([]);
    setNotice(`v${result.record.version} 已登记，等待确认；确认后数值冻结。`);
  }, [currentCustomerId, currentEar, getForm, keyOf, state]);

  const handleConfirm = useCallback(
    (recordId: string) => {
      const { state: next, record } = confirmFitting(state, recordId);
      setState(next);
      setNotice(
        `${record.version === 1 ? "首版" : `v${record.version}`}已确认，增益 ${record.gainDb} dB 已冻结。`,
      );
      setIssues([]);
    },
    [state],
  );

  /** 撤回等待确认：记录删除，数值退回该客户该耳草稿并回填表单 */
  const handleWithdraw = useCallback(
    (recordId: string) => {
      const record = state.records.find((r) => r.id === recordId);
      setState((prev) => withdrawPending(prev, recordId));
      if (record && formsRef.current) {
        formsRef.current[keyOf(record.customerId, record.ear)] = {
          gainDb: String(record.gainDb),
          feedback: record.feedback,
          rating: record.rating,
          basis: record.basis,
          reason: record.reason,
        };
      }
      setNotice("已撤回，数值退回草稿，可修改后重新登记。");
      setIssues([]);
    },
    [keyOf, state],
  );

  const handleDiscardDraft = useCallback(() => {
    if (formsRef.current) delete formsRef.current[keyOf(currentCustomerId, currentEar)];
    setState((prev) => discardDraft(prev, currentCustomerId, currentEar));
    setNotice("草稿已清除。");
    setIssues([]);
  }, [currentCustomerId, currentEar, keyOf]);

  // 关闭/刷新页面前兜底落库
  useEffect(() => {
    const onBeforeUnload = () => {
      const input = formsRef.current?.[keyOf(currentCustomerId, currentEar)];
      if (input) saveState(saveDraft(state, currentCustomerId, currentEar, input));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [currentCustomerId, currentEar, keyOf, state]);

  const currentForm = getForm(currentCustomerId, currentEar);
  const pendingRecord = findPendingRecord(state.records, currentCustomerId, currentEar);
  const latestConfirmed = findLatestConfirmed(state.records, currentCustomerId, currentEar);
  const history = earHistory(state.records, currentCustomerId, currentEar);
  const blocked = isBlocked(state, currentCustomerId, currentEar);
  const pendingConflicts = listAllPendingConflicts(state);

  const issueMap = useMemo(() => {
    const map: Partial<Record<ValidationIssue["field"], string>> = {};
    for (const issue of issues) map[issue.field] = issue.message;
    return map;
  }, [issues]);

  const resetAll = useCallback(() => {
    formsRef.current = {};
    const fresh = createInitialState();
    setState(fresh);
    setCurrentCustomerId(fresh.customers[0]?.id ?? "");
    setCurrentEar("right");
    setIssues([]);
    setNotice("演示数据已重置。");
  }, []);

  return {
    state,
    currentCustomerId,
    currentEar,
    currentForm,
    issues,
    issueMap,
    notice,
    integrityErrors,
    pendingRecord,
    latestConfirmed,
    history,
    blocked,
    pendingConflicts,
    selectCustomer,
    selectEar,
    updateForm,
    handleSaveDraft,
    handleRegister,
    handleConfirm,
    handleWithdraw,
    handleDiscardDraft,
    resetAll,
  };
}
