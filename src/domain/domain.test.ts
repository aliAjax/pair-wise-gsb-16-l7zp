import { describe, expect, it } from "vitest";
import {
  basisRequired,
  confirmFitting,
  createInitialState,
  customerHasDraft,
  discardDraft,
  draftKey,
  findPendingRecord,
  getOrInitDraft,
  listConflicts,
  registerFitting,
  saveDraft,
  validateRegister,
  withdrawPending,
} from "./index";
import type { DraftInput, FittingState } from "./index";

const CUSTOMER_A = "c-liu";
const CUSTOMER_B = "c-chen";

function form(over: Partial<DraftInput> = {}): DraftInput {
  return {
    gainDb: "24",
    feedback: 0,
    rating: 4,
    basis: "",
    reason: "",
    ...over,
  };
}

function registerOk(state: FittingState, customer = CUSTOMER_A, ear: "left" | "right" = "right", input: DraftInput = form()) {
  const result = registerFitting(state, customer, ear, input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

describe("调整依据门槛", () => {
  it("评分低于良好（<3）触发依据必填", () => {
    expect(basisRequired({ feedback: 0, rating: 2 })).toBe(true);
  });

  it("反馈超过二级（>2）触发依据必填", () => {
    expect(basisRequired({ feedback: 3, rating: 5 })).toBe(true);
  });

  it("评分=良好且反馈=二级时不触发", () => {
    expect(basisRequired({ feedback: 2, rating: 3 })).toBe(false);
  });

  it("缺依据时登记失败并给出 BASIS_REQUIRED", () => {
    const issues = validateRegister(form({ rating: 2, basis: "" }), {
      hasConfirmedVersion: false,
      hasOpenRecord: false,
    });
    expect(issues.map((i) => i.code)).toContain("BASIS_REQUIRED");
  });

  it("反馈3级缺依据同样拦截", () => {
    const result = registerFitting(createInitialState(), CUSTOMER_A, "right", form({ feedback: 3 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("BASIS_REQUIRED");
  });
});

describe("草稿与登记分流", () => {
  it("不满足依据规则时内容只能保存为草稿，不产生记录", () => {
    let state = createInitialState();
    state = saveDraft(state, CUSTOMER_A, "right", form({ rating: 2 }));
    expect(state.records).toHaveLength(0);
    expect(getOrInitDraft(state, CUSTOMER_A, "right").rating).toBe(2);
  });

  it("满足规则的登记进入等待确认并清掉草稿", () => {
    let state = createInitialState();
    state = saveDraft(state, CUSTOMER_A, "right", form());
    const result = registerFitting(state, CUSTOMER_A, "right", form());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("pending");
      expect(result.state.drafts[draftKey(CUSTOMER_A, "right")]).toBeUndefined();
    }
  });

  it("增益非法（空/非数/越界）不得登记", () => {
    const state = createInitialState();
    expect(registerFitting(state, CUSTOMER_A, "right", form({ gainDb: "" })).ok).toBe(false);
    expect(registerFitting(state, CUSTOMER_A, "right", form({ gainDb: "abc" })).ok).toBe(false);
    expect(registerFitting(state, CUSTOMER_A, "right", form({ gainDb: "999" })).ok).toBe(false);
  });
});

describe("同客户同耳唯一等待确认", () => {
  it("已有等待确认记录时再次登记被 OPEN_RECORD_BLOCKED 拦截", () => {
    let state = createInitialState();
    state = registerOk(state).state;
    const second = registerFitting(state, CUSTOMER_A, "right", form({ gainDb: "30" }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.issues.map((i) => i.code)).toContain("OPEN_RECORD_BLOCKED");
  });

  it("另一只耳与另一位客户不受影响，可并行等待确认", () => {
    let state = createInitialState();
    state = registerOk(state, CUSTOMER_A, "right").state;
    expect(registerFitting(state, CUSTOMER_A, "left", form()).ok).toBe(true);
    expect(registerFitting(state, CUSTOMER_B, "right", form()).ok).toBe(true);
  });
});

describe("确认冻结与新版本旧值保留", () => {
  it("确认后数值冻结；再调生成 v2，带原因并保留 v1 旧值", () => {
    let state = createInitialState();
    state = registerOk(state, CUSTOMER_A, "right", form({ gainDb: "24", feedback: 1, rating: 4 })).state;
    const pending = findPendingRecord(state.records, CUSTOMER_A, "right")!;
    state = confirmFitting(state, pending.id).state;

    // 无原因不得另建版本
    const noReason = registerFitting(state, CUSTOMER_A, "right", form({ gainDb: "28" }));
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.issues.map((i) => i.code)).toContain("REASON_REQUIRED");

    // 带原因另建 v2
    const v2 = registerFitting(state, CUSTOMER_A, "right", form({
      gainDb: "28",
      feedback: 0,
      rating: 5,
      reason: "嘈杂环境听不清，提升高频",
    }));
    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect(v2.record.version).toBe(2);
      expect(v2.record.previousValues).toEqual({ gainDb: 24, feedback: 1, rating: 4 });
      expect(v2.record.gainDb).toBe(28);
    }
  });

  it("冻结后的 v1 记录内容不被 v2 改写", () => {
    let state = createInitialState();
    state = registerOk(state, CUSTOMER_A, "right", form({ gainDb: "24" })).state;
    const v1 = state.records[0];
    state = confirmFitting(state, v1.id).state;
    state = registerOk(state, CUSTOMER_A, "right", form({ gainDb: "30", reason: "复诊调整" })).state;
    const frozenV1 = state.records.find((r) => r.id === v1.id)!;
    expect(frozenV1.gainDb).toBe(24);
    expect(frozenV1.status).toBe("confirmed");
  });

  it("撤回等待确认记录会退回草稿", () => {
    let state = createInitialState();
    state = registerOk(state, CUSTOMER_A, "right", form({ gainDb: "24" })).state;
    const pending = state.records[0];
    state = withdrawPending(state, pending.id);
    expect(findPendingRecord(state.records, CUSTOMER_A, "right")).toBeUndefined();
    expect(getOrInitDraft(state, CUSTOMER_A, "right").gainDb).toBe("24");
  });
});

describe("草稿隔离与冲突清单", () => {
  it("草稿按 客户::耳 隔离，切换客户不串台", () => {
    let state = createInitialState();
    state = saveDraft(state, CUSTOMER_A, "right", form({ gainDb: "24" }));
    state = saveDraft(state, CUSTOMER_B, "right", form({ gainDb: "40" }));
    expect(getOrInitDraft(state, CUSTOMER_A, "right").gainDb).toBe("24");
    expect(getOrInitDraft(state, CUSTOMER_B, "right").gainDb).toBe("40");
    expect(customerHasDraft(state, CUSTOMER_A)).toBe(true);
    expect(getOrInitDraft(state, CUSTOMER_A, "left").gainDb).toBe("");
    state = discardDraft(state, CUSTOMER_A, "right");
    expect(customerHasDraft(state, CUSTOMER_A)).toBe(false);
    expect(getOrInitDraft(state, CUSTOMER_B, "right").gainDb).toBe("40");
  });

  it("冲突列出客户、耳别和增益（阻塞值与尝试值）", () => {
    let state = createInitialState();
    state = registerOk(state, CUSTOMER_A, "right", form({ gainDb: "24" })).state;
    const conflicts = listConflicts(state, [
      { customerId: CUSTOMER_A, ear: "right", gainDb: 30 },
      { customerId: CUSTOMER_B, ear: "left", gainDb: 10 },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      customerId: CUSTOMER_A,
      customerName: "刘先生",
      ear: "right",
      blockedGainDb: 24,
      attemptedGainDb: 30,
    });
  });

  it("低分带依据的登记可正常进入等待确认", () => {
    const result = registerFitting(
      createInitialState(),
      CUSTOMER_A,
      "left",
      form({ rating: 1, feedback: 3, basis: "堵耳效应明显，低频下调 6 dB" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.basis).toContain("堵耳效应");
  });
});
