// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import App from "../App";
import { STORAGE_KEY } from "../domain";

/** 按可见文本找按钮 */
function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find((b) =>
    b.textContent?.replace(/\s+/g, "").includes(text),
  );
  if (!btn) throw new Error(`找不到按钮：${text}`);
  return btn as HTMLButtonElement;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(App));
  });
  return { container, root };
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("助听器调试闭环 · 页面端到端", () => {
  it("低分缺依据只能留草稿；切换客户不串台；补依据后登记→确认→v2 保留旧值；重载一致", async () => {
    const first = await render();
    const root = first.container;

    // 1) 填增益 24、评分 2（一般）→ 登记被拦截，要求调整依据
    const gain = root.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => setNativeValue(gain, "24"));
    await act(async () => {
      buttonByText(root, "2一般").click();
    });
    await act(async () => {
      buttonByText(root, "登记").click();
    });
    expect(root.textContent).toContain("必须写明调整依据");
    expect(root.textContent).toContain("已只保留草稿");
    // 草稿已持久化
    const storedAfterBlock = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(storedAfterBlock.records).toHaveLength(0);
    expect(storedAfterBlock.drafts["c-liu::right"].gainDb).toBe("24");

    // 2) 切换到陈女士：她的右耳表单必须是空的（不串台），且无刘先生草稿内容
    await act(async () => {
      buttonByText(root, "陈女士").click();
    });
    const otherGain = root.querySelector('input[type="number"]') as HTMLInputElement;
    expect(otherGain.value).toBe("");

    // 3) 切回刘先生：草稿原样恢复
    await act(async () => {
      buttonByText(root, "刘先生").click();
    });
    const restoredGain = root.querySelector('input[type="number"]') as HTMLInputElement;
    expect(restoredGain.value).toBe("24");
    const activeRating = root.querySelector('button.seg.rating.active b');
    expect(activeRating?.textContent).toBe("2");

    // 4) 补调整依据 → 登记成功，进入等待确认
    const basis = root.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setNativeValue(basis, "2kHz 以上仍觉沉闷，高频增益上调"));
    await act(async () => {
      buttonByText(root, "登记").click();
    });
    expect(root.textContent).toContain("v1 已登记，等待确认");
    expect(root.querySelector(".pending-card")).toBeTruthy();

    // 5) 冲突队列出现：客户、耳别、增益齐全
    expect(root.querySelector(".conflict-table")?.textContent).toContain("刘先生");
    expect(root.querySelector(".conflict-table")?.textContent).toContain("右耳");
    expect(root.querySelector(".conflict-table")?.textContent).toContain("24 dB");

    // 6) 确认 → 冻结
    await act(async () => {
      buttonByText(root, "确认并冻结").click();
    });
    expect(root.textContent).toContain("已冻结");
    expect(root.textContent).toContain("已确认");
    expect(root.textContent).toContain("当前冻结：v1 / 24 dB");

    // 7) 再调 v2：不填原因被拦截
    const gain2 = root.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => setNativeValue(gain2, "28"));
    await act(async () => {
      buttonByText(root, "4很好").click();
    });
    await act(async () => {
      buttonByText(root, "登记").click();
    });
    expect(root.textContent).toContain("再次调试必须填写调试原因");

    // 8) 填原因后登记 v2，时间线展示旧值 24 dB
    const reason = root.querySelectorAll("textarea")[1] as HTMLTextAreaElement;
    await act(async () => setNativeValue(reason, "复诊：嘈杂环境听不清"));
    await act(async () => {
      buttonByText(root, "登记").click();
    });
    expect(root.textContent).toContain("v2 已登记");
    expect(root.textContent).toContain("上一版旧值：右耳 增益 24 dB");

    first.root.unmount();

    // 9) 重载：仍停留在刘先生右耳，v1 冻结/v2 待确认关系一致，无一致性告警
    const reloaded = await render();
    const r2 = reloaded.container;
    expect(r2.textContent).toContain("刘先生 的助听器调试");
    expect(r2.textContent).toContain("右耳");
    expect(r2.textContent).toContain("等待确认");
    expect(r2.textContent).toContain("上一版旧值：右耳 增益 24 dB");
    expect(r2.textContent).not.toContain("重载一致性检查发现问题");
    reloaded.root.unmount();
  }, 15000);
});
