import { describe, expect, it, beforeEach } from "vitest";
import {
  STORAGE_KEY,
  checkIntegrity,
  confirmFitting,
  createInitialState,
  draftKey,
  loadState,
  registerFitting,
  saveDraft,
  saveState,
} from "./index";
import type { FittingState } from "./index";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
  get raw() {
    return this.map.get(STORAGE_KEY);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

function flow(): FittingState {
  let state = createInitialState();
  // 客户A右耳：v1 低分带依据 → 确认
  const r1 = registerFitting(state, "c-liu", "right", {
    gainDb: "24",
    feedback: 1,
    rating: 2,
    basis: "高频听不清，2kHz 以上 +4 dB",
    reason: "",
  });
  expect(r1.ok).toBe(true);
  state = r1.ok ? r1.state : state;
  state = confirmFitting(state, state.records[0].id).state;

  // 客户B左耳：草稿（未写依据，不登记）
  state = saveDraft(state, "c-chen", "left", {
    gainDb: "18",
    feedback: 3,
    rating: 1,
    basis: "",
    reason: "",
  });

  // 客户A右耳：v2 带原因，等待确认
  const r2 = registerFitting(state, "c-liu", "right", {
    gainDb: "28",
    feedback: 0,
    rating: 4,
    basis: "",
    reason: "复诊反馈嘈杂环境听不清",
  });
  expect(r2.ok).toBe(true);
  return r2.ok ? r2.state : state;
}

describe("重载一致性", () => {
  it("保存后重载：客户、记录、草稿、版本关系完整一致", () => {
    const state = flow();
    const errors = saveState(state, storage as unknown as Storage);
    expect(errors).toEqual([]);
    expect(storage.size).toBe(1);

    const reloaded = loadState(storage as unknown as Storage);
    expect(reloaded.errors).toEqual([]);
    const s = reloaded.state;

    expect(s.customers).toHaveLength(3);
    expect(s.records).toHaveLength(2);
    // 草稿跟随原客户原耳
    const draft = s.drafts[draftKey("c-chen", "left")];
    expect(draft?.gainDb).toBe("18");
    expect(s.drafts[draftKey("c-liu", "right")]).toBeUndefined();

    // 版本关系：v1 冻结 24，v2 pending 28 且保留旧值
    const v1 = s.records.find((r) => r.version === 1)!;
    const v2 = s.records.find((r) => r.version === 2)!;
    expect(v1.status).toBe("confirmed");
    expect(v1.gainDb).toBe(24);
    expect(v2.status).toBe("pending");
    expect(v2.previousValues).toMatchObject({ gainDb: 24, feedback: 1, rating: 2 });

    expect(checkIntegrity(s)).toEqual([]);
  });

  it("串台草稿（key 与负载不符）在重载时被剔除并保持安全", () => {
    const state = flow();
    saveState(state, storage as unknown as Storage);
    const raw = JSON.parse(storage.raw!);
    // 恶意/异常数据：键属于 chen-left，内容却是 liu
    raw.drafts[draftKey("c-chen", "left")] = {
      customerId: "c-liu",
      ear: "right",
      gainDb: "99",
      feedback: 0,
      rating: 5,
      basis: "串台内容",
      reason: "",
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const reloaded = loadState(storage as unknown as Storage);
    expect(reloaded.state.drafts[draftKey("c-chen", "left")]).toBeUndefined();
  });

  it("同耳出现两条等待确认记录时自检报错", () => {
    const state = flow();
    const tampered: FittingState = {
      ...state,
      records: [
        ...state.records,
        { ...state.records.find((r) => r.status === "pending")!, id: "fake-dup" },
      ],
    };
    const errors = checkIntegrity(tampered);
    expect(errors.some((e) => e.includes("等待确认记录"))).toBe(true);
    expect(saveState(tampered, storage as unknown as Storage).length).toBeGreaterThan(0);
    // 拒写：存档保持上一份
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("存档 JSON 损坏时安全回退初始档案", () => {
    storage.setItem(STORAGE_KEY, "{not-json");
    const reloaded = loadState(storage as unknown as Storage);
    expect(reloaded.state.customers).toHaveLength(3);
    expect(reloaded.state.records).toEqual([]);
    expect(reloaded.errors.length).toBeGreaterThan(0);
  });
});
