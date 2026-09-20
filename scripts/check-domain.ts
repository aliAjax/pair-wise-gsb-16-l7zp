/** 领域规则与状态机的无 UI 验证（node 运行，不进生产包） */
import { createInitialState, registerTuning, confirmRecord, updateDraft, discardDraft, latestFrozen, pendingRecord, recordsForEar, getDraft, draftKey, integrityCheck, removeRecord } from "../src/domain/store";
import { validateTuning, rationaleRequired } from "../src/domain/rules";
import type { TuningInput } from "../src/domain/types";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; }
  else { fail++; console.error("  ✗ " + msg); }
}

const now = 1_700_000_000_000;
const good: TuningInput = { gainDb: 20, feedback: 1, rating: 4, rationale: "", reason: "" };

// 1. 评分低于良好或反馈超过二级 -> 必须写调整依据
assert(rationaleRequired({ rating: 2, feedback: 0 }), "评分一般须依据");
assert(rationaleRequired({ rating: 3, feedback: 3 }), "反馈三级须依据");
assert(!rationaleRequired({ rating: 3, feedback: 2 }), "良好+二级不须依据（超过二级才须）");
assert(!rationaleRequired({ rating: 4, feedback: 1 }), "优秀+一级不须依据");
assert(!!validateTuning({ ...good, rating: 2 }, { reasonRequired: false }).rationale, "缺依据应报错");
assert(!validateTuning({ ...good, rating: 2, rationale: "高频啸叫" }, { reasonRequired: false }).rationale, "有依据应通过");

// 2. 登记：无 pending 成功，有 pending 再登记冲突
let s = createInitialState([{ id: "c1", code: "C-1", name: "客户甲" }]);
const r1 = registerTuning(s, "c1", "L", good, now);
assert(r1.state !== null && r1.record?.status === "pending", "首登为等待确认");
s = r1.state!;
assert(pendingRecord(s, "c1", "L")?.gainDb === 20, "能查到等待确认记录");

const conflictReg = registerTuning(s, "c1", "L", { ...good, gainDb: 25 }, now + 1);
assert(conflictReg.state === null && conflictReg.conflict !== null, "同耳重复登记应冲突");
assert(conflictReg.conflict?.customerName === "客户甲", "冲突含客户");
assert(conflictReg.conflict?.ear === "L", "冲突含耳别");
assert(conflictReg.conflict?.blockingGainDb === 20 && conflictReg.conflict?.submittedGainDb === 25, "冲突列出双方增益");

// 3. 校验不过只留草稿：不产生记录
const bad = registerTuning(s, "c1", "R", { gainDb: 99, feedback: null, rating: null, rationale: "", reason: "" }, now);
assert(bad.state === null && bad.record === null, "非法输入不登记");
const withDraft = updateDraft(s, "c1", "R", { gainDb: 99 }, now).state;
assert(getDraft(withDraft, "c1", "R")?.gainDb === 99, "非法输入可留草稿");

// 4. 确认后冻结
s = confirmRecord(s, r1.record!.id, now + 10);
assert(pendingRecord(s, "c1", "L") === null, "确认后无等待确认");
assert(latestFrozen(s, "c1", "L")?.gainDb === 20, "冻结值可查");
assert(latestFrozen(s, "c1", "L")?.confirmedAt !== null, "有确认时间");

// 5. 冻结后再调试：另建带原因版本，旧值保留
const noReason = registerTuning(s, "c1", "L", { ...good, gainDb: 22 }, now + 20);
assert(!!noReason.errors.reason, "无调整原因应被拦截");
const r2 = registerTuning(s, "c1", "L", { ...good, gainDb: 22, reason: "复诊嫌小声" }, now + 20);
assert(r2.state !== null && r2.record?.version === 2, "新版本号为 2");
assert(r2.record?.parentId === r1.record!.id, "新版本指向上一版");
assert(r2.record?.gainDb === 22, "新版本带新值");
s = r2.state!;
assert(recordsForEar(s, "c1", "L")[0].gainDb === 20, "旧版本旧值保留");
assert(recordsForEar(s, "c1", "L")[1].reason === "复诊嫌小声", "新版本带原因");

// 确认 v2 后第三版
s = confirmRecord(s, r2.record!.id, now + 30);
const r3 = registerTuning(s, "c1", "L", { ...good, gainDb: 24, feedback: 4, rating: 1, rationale: "持续啸叫，降高频", reason: "仍啸叫" }, now + 40);
assert(r3.record?.version === 3 && r3.record?.parentId === r2.record!.id, "v3 链接正确");
s = r3.state!;
assert(recordsForEar(s, "c1", "L").length === 3, "版本链共 3 版");

// 6. 草稿隔离：按客户+耳别归并，切换不串台，登记后清除
let d = updateDraft(s, "c1", "L", { gainDb: 11 }, now).state;
d = updateDraft(d, "c1", "R", { gainDb: 33 }, now).state;
assert(getDraft(d, "c1", "L")?.gainDb === 11, "左耳草稿独立");
assert(getDraft(d, "c1", "R")?.gainDb === 33, "右耳草稿独立");
const otherCust = createInitialState([{ id: "c2", code: "C-2", name: "客户乙" }]);
// c2 无草稿，证明槽位键不会串到别人
assert(!d.drafts[draftKey("c2", "L")], "别的客户读不到该草稿");
void otherCust;
// 登记成功后草稿清除：c1 R 当前无 pending
const regR = registerTuning(d, "c1", "R", { ...good, gainDb: 33 }, now);
assert(regR.state !== null && getDraft(regR.state!, "c1", "R") === null, "登记后草稿清除");

// 7. 左右耳互不阻塞
const lReg = registerTuning(s, "c1", "R", good, now);
assert(lReg.state !== null, "左耳 pending 时右耳仍可登记");

// 8. 一致性巡检：重复 pending 能被发现（模拟异常数据）
let broken = registerTuning(createInitialState([{ id: "c1", code: "C-1", name: "客户甲" }]), "c1", "L", good, now).state!;
const stray = { ...pendingRecord(broken, "c1", "L")!, id: "stray", gainDb: 27, createdAt: now + 5 };
broken = { ...broken, records: [...broken.records, stray] };
const conflicts = integrityCheck(broken);
assert(conflicts.length === 1, "巡检发现重复等待确认");
assert(conflicts[0].customerName === "客户甲" && conflicts[0].ear === "L", "巡检冲突含客户耳别");
assert(conflicts[0].blockingGainDb === 20 && conflicts[0].gainDb === 27, "巡检冲突列增益");
assert(integrityCheck(removeRecord(broken, "stray")).length === 0, "删除重复后冲突解除");

// 9. 丢弃草稿
const withD = updateDraft(s, "c1", "R", { rating: 2 }, now).state;
assert(getDraft(withD, "c1", "R") !== null, "草稿存在");
assert(getDraft(discardDraft(withD, "c1", "R"), "c1", "R") === null, "可丢弃草稿");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exit(1);
