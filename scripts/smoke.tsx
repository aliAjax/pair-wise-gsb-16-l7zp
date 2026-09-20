/** jsdom + Testing Library 端到端冒烟：真实渲染页面并驱动调试闭环 */
import { JSDOM } from "jsdom";

// 必须在引入 @testing-library 之前建立好 DOM 全局（user-event 输入 polyfill 依赖）
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
});
const { window } = dom;
(globalThis as Record<string, unknown>).window = window;
(globalThis as Record<string, unknown>).document = window.document;
(globalThis as Record<string, unknown>).navigator = window.navigator;
(globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;
(globalThis as Record<string, unknown>).Element = window.Element;
(globalThis as Record<string, unknown>).Node = window.Node;
(globalThis as Record<string, unknown>).DocumentFragment = window.DocumentFragment;
(globalThis as Record<string, unknown>).InputEvent = window.InputEvent;
(globalThis as Record<string, unknown>).KeyboardEvent = window.KeyboardEvent;
(globalThis as Record<string, unknown>).getComputedStyle = window.getComputedStyle;
(globalThis as Record<string, unknown>).localStorage = window.localStorage;
// React-dom 开发版输入事件 polyfill：jsdom 下 InputEvent 能力探测失败会回退到 IE
// attachEvent；在元素原型上补可调用的空实现，避免该回退分支抛错
const ieNoop = { configurable: true, value: () => {} } as const;
for (const proto of [window.HTMLElement.prototype, window.Element.prototype]) {
  const p = proto as unknown as { attachEvent?: unknown; detachEvent?: unknown };
  if (typeof p.attachEvent === "undefined") {
    Object.defineProperty(p, "attachEvent", ieNoop);
    Object.defineProperty(p, "detachEvent", ieNoop);
  }
}

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getQueriesForElement, within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { FittingPage } from "../src/pages/FittingPage";

async function main() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const user = userEvent.setup({ document: window.document });

  let pass = 0;
  let fail = 0;
  function assert(cond: boolean, msg: string) {
    if (cond) pass++;
    else { fail++; console.error("  ✗ " + msg); }
  }

  const container = window.document.getElementById("root")!;
  await act(async () => {
    createRoot(container).render(React.createElement(FittingPage));
  });
  const q = getQueriesForElement(container as unknown as HTMLElement);
  const body = () => container.textContent ?? "";

  async function click(name: string | RegExp) {
    const node = within(container as never).getByText(name) as HTMLElement;
    const btn = (node.closest("button") ?? node) as HTMLElement;
    await act(async () => {
      await user.click(btn);
    });
  }

  async function clickCustomer(code: string) {
    const node = within(container as never).getByText(
      (_c, el) =>
        Boolean(el && el.classList?.contains("customer-code") && el.textContent === code),
    ) as HTMLElement;
    await act(async () => {
      await user.click(node.closest("button") ?? node);
    });
  }

  /** 真实按键序列：React 19 受控 onChange 只有完整按键序列才稳定触发 */
  async function fill(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
      await user.clear(el);
      await user.type(el, value);
    });
  }

  // 初始：刘女士左耳有等待确认（种子），门禁出现
  assert(body().includes("等待确认记录"), "存在等待确认门禁");

  // 切到陈先生左耳：已有 v1/v2 已冻结链
  await clickCustomer("Chen-118");
  assert(body().includes("v2"), "显示陈先生 v2 版本");
  assert(body().includes("旧值：14dB"), "显示 v1 旧值对照");
  assert(body().includes("基于已冻结的 v2"), "再调基线提示存在");

  // 切到右耳（空）：评分差 + 反馈三级但不写依据 -> 只能留草稿
  await click(/^右耳$/);
  const gainInput = q.getByLabelText(/增益（dB）/) as HTMLInputElement;
  await fill(gainInput, "18");
  assert(gainInput.value === "18", "增益输入受控显示 18");
  await click(/^三级$/);
  await click(/^差$/);
  assert(body().includes("必须写明调整依据"), "联动必填提示出现");
  await click(/登记调试/);
  assert(body().includes("已保留为草稿"), "校验不过只留草稿");
  const draftCheck = JSON.parse(window.localStorage.getItem("hxwl-01.fitting.v1")!).drafts["c-chen::R"];
  assert(
    draftCheck.gainDb === 18 && draftCheck.feedback === 3 && draftCheck.rating === 1,
    "草稿完整保存增益/反馈/评分",
  );

  // 切换客户不串台
  await clickCustomer("Liu-024");
  const customerList = container.querySelector(".customer-list") as HTMLElement;
  const liuCard = within(customerList as never)
    .getByText("Liu-024")
    .closest(".customer-card") as HTMLElement;
  assert(
    within(liuCard as never).queryAllByText("", { selector: ".ear-dot.has-draft" } as never)
      .length === 0,
    "刘女士两耳均无草稿标记（不串台）",
  );

  // 切回陈先生右耳：草稿仍在
  await clickCustomer("Chen-118");
  await click(/^右耳$/);
  const gainRestored = q.getByLabelText(/增益（dB）/) as HTMLInputElement;
  assert(gainRestored.value === "18", "切回后右耳草稿增益仍为 18");

  // 正常重载（无冲突）：客户、记录、草稿与版本关系保持一致
  const reload1 = window.document.createElement("div");
  window.document.body.appendChild(reload1);
  await act(async () => {
    createRoot(reload1).render(React.createElement(FittingPage));
  });
  const r1 = () => reload1.textContent ?? "";
  assert(r1().includes("陈先生"), "重载后客户保留");
  assert(r1().includes("右耳"), "重载后耳别选择保留");
  assert(
    within(reload1 as never).getByLabelText(/增益（dB）/) &&
      (within(reload1 as never).getByLabelText(/增益（dB）/) as HTMLInputElement).value === "18",
    "重载后草稿增益一致",
  );
  // v1 等待确认在该耳、陈先生左耳 v1/v2 链仍在
  const stored = JSON.parse(window.localStorage.getItem("hxwl-01.fitting.v1")!);
  const chenL = stored.records.filter((r: { customerId: string; ear: string }) => r.customerId === "c-chen" && r.ear === "L");
  assert(chenL.length === 2 && chenL[1].parentId === chenL[0].id, "重载后版本链 parentId 关系一致");
  reload1.remove();

  // 补依据 -> 登记成功
  await fill(q.getByLabelText(/调整依据/) as HTMLTextAreaElement, "高频补偿不足，先整体提升");
  await click(/登记调试/);
  assert(body().includes("已登记为「等待确认」"), "登记成功");
  assert(q.queryByLabelText(/调整依据/) === null, "登记后草稿已清除");

  // 确认冻结（版本链里可能有多个确认按钮，取版本列表第一个）
  const firstConfirm = container.querySelector(".version-list .confirm-btn") as HTMLElement;
  await act(async () => {
    await user.click(firstConfirm);
  });
  assert(body().includes("数值冻结"), "确认后显示冻结");

  // 再调试须填原因
  assert(body().includes("基于已冻结的 v1"), "出现 v1 基线");
  await fill(q.getByLabelText(/增益（dB）/) as HTMLInputElement, "16");
  await click(/^优秀$/);
  await click(/^无$/);
  await click(/登记调试/);
  assert(body().includes("必须填写调整原因"), "无原因被拦截");
  await fill(q.getByLabelText(/调整原因/) as HTMLTextAreaElement, "觉得声音偏大");
  await click(/登记调试/);
  assert(body().includes("v2"), "生成 v2");
  assert(body().includes("v1"), "v1 仍保留");

  // 重载一致性巡检：塞一条重复等待确认记录
  const raw = JSON.parse(window.localStorage.getItem("hxwl-01.fitting.v1")!);
  const chenR = raw.records.filter(
    (r: { customerId: string; ear: string }) => r.customerId === "c-chen" && r.ear === "R",
  );
  const pendingRec = chenR.find((r: { status: string }) => r.status === "pending");
  raw.records.push({ ...pendingRec, id: "stray-x", gainDb: 30, createdAt: Date.now() });
  window.localStorage.setItem("hxwl-01.fitting.v1", JSON.stringify(raw));

  // 模拟重载：新建容器全新挂载，重新读取 localStorage 并跑一致性巡检
  const reloaded = window.document.createElement("div");
  window.document.body.appendChild(reloaded);
  await act(async () => {
    createRoot(reloaded).render(React.createElement(FittingPage));
  });
  const rbody = () => reloaded.textContent ?? "";
  assert(rbody().includes("冲突处理"), "重载后巡检出冲突");
  assert(rbody().includes("陈先生"), "冲突列出客户");
  assert(rbody().includes("右耳"), "冲突列出耳别");
  assert(rbody().includes("30 dB"), "冲突列出重复增益");
  assert(rbody().includes("16 dB"), "冲突列出占位增益");
  // 说明文字里也含“删除重复记录”，故只在真实按钮中选取
  const deleteBtn = reloaded.querySelector(
    ".conflict-panel .conflict-actions button:not(.primary-action)",
  ) as HTMLButtonElement;
  await act(async () => {
    await user.click(deleteBtn);
  });
  assert(!rbody().includes("冲突处理"), "修复后冲突解除");

  console.log(`\n冒烟通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
