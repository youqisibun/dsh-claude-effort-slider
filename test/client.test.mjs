/**
 * 离线断言：只跑纯函数与 bundle 结构，不依赖浏览器。
 * 视觉部分靠真机截图比对（web profile），这里守住"映射 / 几何 / 纹理 / 结构"四条底线。
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

let captured = null;
const sandbox = {
  window: {
    __ModuleLoader__: { load: (definition) => { captured = definition; } },
    devicePixelRatio: 2,
    innerWidth: 1280,
    addEventListener() {},
    removeEventListener() {},
  },
  document: {
    head: null,
    body: { hasAttribute: () => true },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ getContext: () => null }),
  },
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (fn) => { fn(); return 1; },
  cancelAnimationFrame() {},
  localStorage: undefined,
};
vm.runInNewContext(source, sandbox, { filename: "client.js" });

assert.ok(captured, "bundle 没有调用 __ModuleLoader__.load");
assert.equal(captured.id, "dsh-claude-effort-slider");

const fakeReact = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useSyncExternalStore: null,
};
const moduleExports = captured.factory((name) => (name === "react-dom" ? { createPortal: (node) => node } : fakeReact));
const api = moduleExports.__internals;
assert.ok(api, "没有导出 __internals");

let checks = 0;
function ok(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}
/** VM 里造出来的数组/对象原型不同，先转成本 realm 的普通值再比较。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/* 1. 六档：名字、顺序、effort 映射 */
const labels = plain(api.STOPS.map((stop) => stop.label));
assert.deepEqual(labels, ["Low", "Medium", "High", "Extra", "Max", "Ultracode"]);
assert.deepEqual(plain(api.STOPS.map((stop) => stop.effort)), ["off", "low", "high", "high", "high", "max"]);
ok(api.STOPS[5].ultra === true, "第 6 位必须是 Ultracode 特殊位");
ok(api.STOPS[4].ultra !== true, "Max 不是 Ultracode");

/* 2. 6 → 4 的降级映射 */
const deepseek = [{ id: "off" }, { id: "low" }, { id: "high" }, { id: "max" }];
const mapped = api.resolveStops(deepseek);
assert.deepEqual(plain(mapped.map((stop) => stop.effort)), ["off", "low", "high", "high", "high", "max"]);
ok(mapped.every((stop, index) => stop.key === api.STOPS[index].key), "档位 key 不能变");

/* 3. 空目录时退回 6 个默认档（加载期不闪空） */
assert.equal(api.resolveStops([]).length, 6);

/* 4. 只有 off 的模型也能给出可用的映射，不会抛错 */
const offOnly = api.resolveStops([{ id: "off" }]);
ok(offOnly.length === 6 && offOnly.every((stop) => stop.effort === "off"), "只有 off 时全部落到 off");

/* 5. 当前档位 → 视觉档位 */
assert.equal(api.indexForEffort("off", mapped), 0);
assert.equal(api.indexForEffort("low", mapped), 1);
assert.equal(api.indexForEffort("high", mapped), 2);
assert.equal(api.indexForEffort("max", mapped), 5);

/* 6. Extra/Max 也写 high，靠 remembered 区分 */
assert.equal(api.preferredIndex("max", null, mapped, "deepseek/x"), 5);
assert.equal(api.preferredIndex("max", { key: "ultracode", effort: "max", model: "deepseek/x" }, mapped, "deepseek/x"), 5);
assert.equal(api.preferredIndex("max", { key: "ultracode", effort: "max", model: "deepseek/x" }, mapped, "deepseek/y"), 5);
assert.equal(api.preferredIndex("high", { key: "extra", effort: "high", model: "deepseek/x" }, mapped, "deepseek/x"), 3);
assert.equal(api.preferredIndex("high", { key: "max", effort: "high", model: "deepseek/x" }, mapped, "deepseek/x"), 4);
/* 记住的是 Extra，但当前真实档位是 low —— 不能骗人，回到 Medium */
assert.equal(api.preferredIndex("low", { key: "extra", effort: "low", model: "deepseek/x" }, mapped, "deepseek/x"), 1);
/* 记住的是 Ultracode，但当前只是 high —— 不能骗人，回到 High */
assert.equal(api.preferredIndex("high", { key: "ultracode", effort: "max", model: "deepseek/x" }, mapped, "deepseek/x"), 2);

/* 7. 几何：端点内缩半个旋钮，刻度与旋钮共用同一套坐标 */
assert.equal(api.xForPct(0), api.KNOB_W / 2);
assert.equal(api.xForPct(1), api.TRACK_W - api.KNOB_W / 2);
assert.equal(api.pctFromX(api.KNOB_W / 2), 0);
assert.equal(api.pctFromX(api.TRACK_W - api.KNOB_W / 2), 1);
assert.equal(api.pctFromIndex(0, 6), 0);
assert.equal(api.pctFromIndex(5, 6), 1);
assert.ok(Math.abs(api.pctFromIndex(2, 6) - 0.4) < 1e-9, "第 3 档应在 40%");
assert.equal(api.indexFromPct(0, 6), 0);
assert.equal(api.indexFromPct(1, 6), 5);
assert.equal(api.indexFromPct(0.39, 6), 2);
assert.equal(api.indexFromPct(0.41, 6), 2);

/* 8. 纹理：确定性 + 右密左疏 + 左缘会缺格 */
assert.equal(api.hash01(3, 4, 7), api.hash01(3, 4, 7));
assert.notEqual(api.hash01(3, 4, 7), api.hash01(4, 4, 7));
const width = api.TRACK_W;
const left = api.ditherAlphaAt(width * 0.25, width, Math.round((width * 0.25) / 4), 3);
const right = api.ditherAlphaAt(width * 0.75, width, Math.round((width * 0.75) / 4), 3);
ok(right > left, "纹理应从左往右变密");
let holes = 0;
for (let col = 0; col < 10; col += 1) {
  for (let row = 0; row < 7; row += 1) {
    if (api.ditherAlphaAt(col * 4, width, col, row) === 0) holes += 1;
  }
}
ok(holes === 0, "网格必须铺满整条轨道，不留空白");

/* 9. 设置归一化：坏数据回默认 */
assert.deepEqual(plain(api.normalizeSettings(null)), { ticks: "show", texture: "normal" });
assert.deepEqual(plain(api.normalizeSettings({ ticks: "hide" })), { ticks: "hide", texture: "normal" });
assert.deepEqual(plain(api.normalizeSettings({ ticks: "nope", texture: "soft" })), { ticks: "show", texture: "soft" });
assert.deepEqual(plain(api.normalizeSettings("x")), { ticks: "show", texture: "normal" });

/* 10. bundle 结构：宿主能扫到、插槽对、没有注入消息 */
ok(source.includes("id: \"dsh-claude-effort-slider\""), "bundle id");
ok(source.includes("__ModuleLoader__.load"), "模块加载器");
ok(source.includes("conversation.input.right"), "目标插槽");
ok(source.includes("exports.apply"), "导出 apply");
ok(source.includes("[\"slots\", \"sessions\", \"modelDirectories\", \"remote\", \"remote.session\"]"), "inject 服务齐");
ok(!source.includes("agent.inject"), "不许注入模型上下文");
ok(!source.includes("session/event"), "不许注册会话事件");
ok(source.includes("::after{content:attr(data-dces-label)"), "胶囊文字由 CSS 覆盖");
ok(source.includes("dces-dither"), "纹理层存在");

/* 11. 数据面只用公开接口 */
ok(source.includes("directoryFor"), "读档位");
ok(source.includes("reasoningEffort"), "写档位");
ok(source.includes("data-composer-card"), "按 composer 归属");

console.log(`ok — ${checks + 20} checks passed`);
