/**
 * dsh-claude-effort-slider — 客户端半边
 *
 * 把 DSH 输入框右下角「模型席」里的**推理等级文字**，改造成 Claude Code 风格的可点胶囊：
 *   · 点胶囊 → 在输入框上方弹出 Effort 浮层（6 档滑条 + Faster/Smarter + ?）
 *   · 拖到第 6 位 Ultracode → 轨道整条变成紫色像素纹理，标题变紫
 *   · Ultracode 在 DSH 侧**真实写入 max**（不是只换皮）
 *
 * ── 与 v1（dsh-codex-effort-slider）的关系 ──────────────────────────────
 * 完全独立：不覆盖、不依赖、不抢同一个插槽条目。
 * v1 改造的是官方模型菜单里的「推理等级」那一行；本插件只改造**输入框里的模型席**，
 * 两者可以同时安装。
 *
 * ── 官方锚点（来自 dsh-client-ui-model-selection 源码）─────────────────
 *   <button aria-haspopup="menu" aria-expanded=… aria-controls=…>
 *     <svg class=triggerIcon/>
 *     <span class=triggerLabel>模型名</span>
 *     <span class=triggerEffort>High</span>   ← 本插件改造这一颗
 *     <StateDot|svg class=chevron/>
 *   </button>
 * 归属判定：从自己的隐藏锚点向上找 [data-composer-card]，只改造**本 composer** 里的席。
 *
 * ── 纪律 ────────────────────────────────────────────────────────────────
 *  1. 只改那一颗 span 的样式与点击行为，**不改它的 DOM 文字**（文字归官方 React 管；
 *     显示文字用 ::after + attr(data-dces-label) 覆盖，卸载即还原）。
 *  2. fail-open：认不出官方结构就什么都不做，官方界面照常可用。
 *  3. 不注入消息、不注册会话事件、不挂 agent 钩子。
 */
window.__ModuleLoader__.load({
  id: "dsh-claude-effort-slider",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var ReactDOM = require("react-dom");

    var PACKAGE_ID = "dsh-claude-effort-slider";
    var SLOT_NAME = "conversation.input.right";
    var ENTRY_ID = "claude-effort-slider";
    var ENTRY_ORDER = 60;
    var STYLE_MARKER = PACKAGE_ID;
    var SETTINGS_KEY = "dsh-claude-effort-slider.settings";
    /** 用户最后选中的「视觉档位」——用来区分 Max 与 Ultracode（两者在 DSH 里都是 max）。 */
    var STOPS_KEY = "dsh-claude-effort-slider.stops";
    /** 失败提示条的 DOM id：同一个页面只显示一条，不重复打扰。 */
    var FAIL_TOAST_ID = "dces-fail-toast";
    var DEBUG = /[?&]dces-debug=1\b/.test((typeof location !== "undefined" && location.search) || "");

    /* ── 尺寸（CSS px）——参考帧按 28px 轨高折算 ───────────────────────── */
    var TRACK_H = 28;
    var KNOB_W = 26;
    var KNOB_H = 32; /* 比轨道高 4px：上下各盖住 2px，避免浅色马赛克从旋钮上下漏出细缝 */
    var KNOB_R = 8;
    var POPOVER_W = 308;
    var POPOVER_PAD = 16;
    var TRACK_W = POPOVER_W - POPOVER_PAD * 2;
    var CELL = TRACK_H / 6; /* 参考：6 行等分 */

    /* ── 六个视觉档位 ──────────────────────────────────────────────────
     * DSH 真实档位只有 off / low / high / max（4 个值撑 6 格）：
     *   Low=off、Medium=low、High/Extra/Max=high、Ultracode=max（用户指定）。
     */
    var STOPS = [
      { key: "low", label: "Low", effort: "off" },
      { key: "medium", label: "Medium", effort: "low" },
      { key: "high", label: "High", effort: "high" },
      { key: "extra", label: "Extra", effort: "high" },
      { key: "max", label: "Max", effort: "high" },
      { key: "ultracode", label: "Ultracode", effort: "max", ultra: true },
    ];

    /** 真实档位的"高低顺序"，用于找不到同名档位时取最近的一档。 */
    var LEVEL_RANK = { off: 0, low: 1, medium: 2, high: 3, xhigh: 4, extra: 4, max: 5 };
    /** 官方可能出现的档位名（认 span 用）。 */
    var EFFORT_NAMES = ["off", "none", "low", "medium", "high", "xhigh", "extra", "max", "ultracode", "关闭", "无"];

    var RETRY_DELAYS = [80, 240, 600, 1200, 2400, 4000];
    var COMMIT_THROTTLE_MS = 120;
    var COMMIT_DEADLINE_MS = 10000;

    var EMPTY_SNAPSHOT = Object.freeze({
      current: null,
      groups: [],
      failures: [],
      status: "idle",
      pending: null,
      error: null,
    });

    /* ═══════════════════════════ 样式 ═══════════════════════════ */

    var CSS = [
      /* 输入框里的胶囊：覆盖官方 triggerEffort 的文字样式。
         官方与 v1 都可能写内联 color，所以这里用 !important 固定住。
         font-size:0 把官方文字"藏起来"，可见文字由 ::after 提供 —— DOM 文字一个字没改。 */
      ".dces-chip{display:inline-flex!important;align-items:center;justify-content:center;flex:0 0 auto!important;height:20px;box-sizing:border-box;padding:0 7px;margin-left:2px;border-radius:6px;font-size:0!important;line-height:20px;cursor:pointer;overflow:visible!important;max-width:none!important;transition:background .12s ease,color .12s ease}",
      ".dces-chip::after{content:attr(data-dces-label);font-size:12px;font-weight:500;line-height:20px;letter-spacing:.1px;white-space:nowrap}",
      ".dces-chip[data-ultra='0']{background:rgba(255,255,255,.075)!important;color:rgba(235,237,241,.72)!important}",
      ".dces-chip[data-ultra='0']:hover{background:rgba(255,255,255,.13)!important;color:rgba(255,255,255,.9)!important}",
      ".dces-chip[data-ultra='1']{background:rgba(139,92,246,.22)!important;color:#c4b5fd!important}",
      ".dces-chip[data-ultra='1']:hover{background:rgba(139,92,246,.32)!important;color:#ddd6fe!important}",

      /* 浮层 */
      ".dces-pop{position:fixed;z-index:2147482000;width:" + POPOVER_W + "px;box-sizing:border-box;padding:14px " + POPOVER_PAD + "px 16px;border-radius:16px;background:rgba(38,42,47,.985);border:1px solid #454b52;box-shadow:0 8px 28px rgba(0,0,0,.35);color:#e3e5e8;font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}",
      ".dces-head{display:flex;align-items:center;justify-content:space-between;gap:10px}",
      ".dces-title{font-size:17px;font-weight:500;line-height:24px;letter-spacing:.1px;color:#aeb3b8;white-space:nowrap}",
      ".dces-value{margin-left:6px;color:#e3e5e8;font-weight:600;transition:color .2s ease,text-shadow .2s ease;--dces-glow:none}",
      ".dces-value[data-ultra='1']{color:#c4b2ee;text-shadow:none;--dces-glow:none}",
      ".dces-value.dces-glitch{animation:dces-glitch .3s steps(2,end)}",
      ".dces-value-inner{display:inline-block;animation:dces-rise .3s cubic-bezier(.2,.85,.25,1)}",
      "@keyframes dces-rise{0%{transform:translateY(85%) scale(.96);opacity:0}55%{opacity:1}80%{transform:translateY(-6%) scale(1.01)}100%{transform:translateY(0) scale(1);opacity:1}}",
      "@keyframes dces-glitch{0%{transform:translate(0,0);text-shadow:var(--dces-glow)}20%{transform:translate(-.6px,.3px);filter:blur(.25px) contrast(1.1);text-shadow:var(--dces-glow),-1px 0 rgba(255,80,160,.6),1px 0 rgba(0,200,255,.6)}40%{transform:translate(.6px,-.3px);text-shadow:var(--dces-glow),1px 0 rgba(255,80,160,.5),-1px 0 rgba(0,200,255,.5)}60%{transform:translate(-.4px,0);filter:blur(.15px);text-shadow:var(--dces-glow),-1px 0 rgba(255,80,160,.35),1px 0 rgba(0,200,255,.35)}80%{transform:translate(.3px,0);text-shadow:var(--dces-glow)}100%{transform:translate(0,0);text-shadow:var(--dces-glow)}}",
      ".dces-help{flex:0 0 auto;width:20px;height:20px;box-sizing:border-box;border-radius:50%!important;border:1px solid rgba(255,255,255,.3);background:none;color:rgba(255,255,255,.5);font:12px/1 system-ui,sans-serif;cursor:pointer;padding:0;display:grid;place-items:center}",
      ".dces-help:hover{color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.5)}",
      ".dces-labels{display:flex;justify-content:space-between;margin-top:16px;font-size:13px;line-height:16px;color:#aeb3b8}",
      ".dces-track{position:relative;height:" + TRACK_H + "px;margin-top:8px;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.16));cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;outline:none}",
      ".dces-track[data-ultra='1']{box-shadow:none}",
      ".dces-pop .dces-track{background:#181d23}",
      ".dces-pop .dces-fill{background:#3b454e}",
      ".dces-track[data-ultra='1'] .dces-tick{opacity:0}",
      "[data-dces-native-effort='1']{display:none!important}",
      "[data-dces-native-effort-hidden='1']{display:none!important}",
      ".dces-track:focus-visible{box-shadow:0 0 0 2px rgba(167,139,250,.8)}",
      ".dces-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 12%,transparent);overflow:hidden;pointer-events:none}",
      ".dces-dither{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}",
      ".dces-tick{position:absolute;top:50%;width:2.5px;height:2.5px;margin:-1.25px 0 0 -1.25px;border-radius:50%;background:rgba(255,255,255,.32);pointer-events:none}",
      ".dces-tick[data-on='1']{background:rgba(255,255,255,.95)}",
      ".dces-tick[data-last='1']{background:rgba(255,255,255,.55);opacity:.9}",
      ".dces-knob{position:absolute;top:50%;width:" + KNOB_W + "px;height:" + KNOB_H + "px;margin:" + (-KNOB_H / 2) + "px 0 0 " + (-KNOB_W / 2) + "px;border-radius:" + KNOB_R + "px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45),0 0 0 .5px rgba(0,0,0,.1);pointer-events:none}",
      ".dces-track:not([data-drag='1']) .dces-knob{transition:left .12s cubic-bezier(.2,.8,.2,1)}",
      /* 浅色主题：浮层跟着界面变白，纹理换深紫，其余结构不变 */
      "body[data-dces-dark='0'] .dces-pop{background:rgba(253,253,251,.99);border-color:#deded9;box-shadow:0 10px 26px rgba(15,23,42,.14);color:#393a36}",
      "body[data-dces-dark='0'] .dces-title{color:#888984}",
      "body[data-dces-dark='0'] .dces-value{color:#393a36}",
      "body[data-dces-dark='0'] .dces-value[data-ultra='1']{color:#3d375b;text-shadow:none;--dces-glow:none}",
      "body[data-dces-dark='0'] .dces-labels{color:#888984}",
      "body[data-dces-dark='0'] .dces-help{border-color:rgba(15,23,42,.18);color:rgba(15,23,42,.45)}",
      "body[data-dces-dark='0'] .dces-pop .dces-track{background:#e4e3df}",
      "body[data-dces-dark='0'] .dces-pop .dces-fill{background:#e1e1dd}",
      "body[data-dces-dark='0'] .dces-tick{background:rgba(15,23,42,.22)}",
      "body[data-dces-dark='0'] .dces-tick[data-on='1']{background:rgba(15,23,42,.5)}",
      "body[data-dces-dark='0'] .dces-tick[data-last='1']{background:rgba(15,23,42,.4)}",
      "body[data-dces-dark='0'] .dces-knob{box-shadow:0 2px 6px rgba(15,23,42,.2),0 0 0 .5px rgba(15,23,42,.06)}",
      "body[data-dces-dark='0'] .dces-tip{color:rgba(15,23,42,.6)}",
      "body[data-dces-dark='0'] .dces-set{border-top-color:rgba(15,23,42,.08)}",
      "body[data-dces-dark='0'] .dces-set-row{color:rgba(15,23,42,.75)}",
      "body[data-dces-dark='0'] .dces-set-hint{color:rgba(15,23,42,.45)}",
      ".dces-track:not([data-drag='1']) .dces-fill{transition:width .12s cubic-bezier(.2,.8,.2,1)}",
      ".dces-err{margin-top:8px;font-size:11px;line-height:15px;color:#f87171}",
      ".dces-tip{margin-top:10px;font-size:11.5px;line-height:16px;color:rgba(235,237,241,.55)}",
      ".dces-set{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:8px}",
      ".dces-set-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:rgba(235,237,241,.75)}",
      ".dces-set-btn{font:inherit;font-size:11.5px;color:#ddd6fe;background:rgba(139,92,246,.18);border:1px solid rgba(139,92,246,.3);border-radius:6px;padding:3px 9px;cursor:pointer}",
      ".dces-set-btn:hover{background:rgba(139,92,246,.28)}",
      ".dces-set-hint{font-size:11px;line-height:15px;color:rgba(235,237,241,.42)}",

      /* 降级入口：官方模型席被别的插件替换/隐藏时，输入区里出现自己的档位胶囊 */
      ".dces-slot-chip{display:inline-flex;align-items:center;justify-content:center;height:24px;box-sizing:border-box;padding:0 9px;margin-right:6px;border:none;border-radius:7px;font:500 12px/1 system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer;align-self:center;background:rgba(255,255,255,.085);color:rgba(235,237,241,.82);transition:background .12s ease,color .12s ease}",
      ".dces-slot-chip:focus{outline:none}",
      /* 静态隐藏原生等级文字：避免它每次重渲染时先出现一帧、把按钮撑宽 */
      "._7KE1Ra_triggerEffort{display:none!important}",
      /* 把 Effort 胶囊排到模型按钮右侧（父级是 display:contents，order 要加在真实 flex item 上） */
      ".dces-slot-chip{order:2;margin-left:6px;margin-right:0}",
      "._7KE1Ra_root{order:1}",
      ".dces-slot-chip:hover{background:rgba(255,255,255,.14);color:#fff}",
      ".dces-slot-chip[data-ultra='1']{background:rgba(139,92,246,.22);color:#c4b5fd}",
      ".dces-slot-chip[data-ultra='1']:hover{background:rgba(139,92,246,.32);color:#ddd6fe}",

      /* 浅色主题（不依赖 data-ds-dark-theme：自定义主题会把令牌改成深色但不设这个属性） */
      "body[data-dces-dark='0'] .dces-chip[data-ultra='0']{background:rgba(15,23,42,.055)!important;color:rgba(27,28,32,.62)!important}",
      "body[data-dces-dark='0'] .dces-chip[data-ultra='0']:hover{background:rgba(15,23,42,.1)!important;color:rgba(27,28,32,.85)!important}",
      "body[data-dces-dark='0'] .dces-chip[data-ultra='1']{background:#ede9fe!important;color:#6d28d9!important}",
      "body[data-dces-dark='0'] .dces-slot-chip{background:rgba(15,23,42,.055);color:rgba(27,28,32,.62)}",
      "body[data-dces-dark='0'] .dces-slot-chip:hover{background:rgba(15,23,42,.1);color:rgba(27,28,32,.85)}",
      "body[data-dces-dark='0'] .dces-slot-chip[data-ultra='1']{background:#ede9fe;color:#6d28d9}",
    ].join("\n");

    /**
     * 出问题时给一条**看得见**的提示。
     *
     * 为什么需要：这个插件全程 fail-open（认不出官方结构就静默退出），用户分不清
     * 「根本没装上」和「装上了但不兼容」——两者都表现为「什么都没有」。
     * 一条 8 秒后自动消失的小条，能把排查方向直接指出来。
     *
     * 刻意做得克制：左下角、12px、pointer-events:none（不挡任何点击）、
     * 只出现一次、不修改官方 DOM、不加任何遮罩。
     */
    function showFailureToast(reason) {
      try {
        if (typeof document === "undefined" || !document.body) return;
        if (document.getElementById(FAIL_TOAST_ID)) return;
        var el = document.createElement("div");
        el.id = FAIL_TOAST_ID;
        el.setAttribute("role", "status");
        el.textContent = "Effort 滑条未加载：" + reason + "（按 F12 看控制台详情）";
        el.style.cssText = [
          "position:fixed", "left:16px", "bottom:16px", "z-index:2147483000",
          "max-width:320px", "padding:8px 12px", "border-radius:8px",
          "font:12px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif",
          "background:rgba(28,28,32,.92)", "color:#f4dcdc",
          "border:1px solid rgba(255,120,120,.35)",
          "box-shadow:0 6px 20px rgba(0,0,0,.28)",
          "pointer-events:none", "opacity:0", "transition:opacity .25s ease",
          "white-space:normal", "word-break:break-word",
        ].join(";");
        document.body.appendChild(el);
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(function () { el.style.opacity = "1"; });
        else el.style.opacity = "1";
        setTimeout(function () {
          el.style.opacity = "0";
          setTimeout(function () { try { el.remove(); } catch (error) { /* ignore */ } }, 400);
        }, 8000);
      } catch (error) {
        /* 提示本身绝不能抛 */
      }
    }

    function installStyles() {
      try {
        if (typeof document === "undefined" || !document.head) return null;
        var existing = document.querySelector('style[data-plugin-css="' + STYLE_MARKER + '"]');
        if (existing) return existing;
        var style = document.createElement("style");
        style.setAttribute("data-plugin-css", STYLE_MARKER);
        style.textContent = CSS;
        document.head.appendChild(style);
        return style;
      } catch (error) {
        return null;
      }
    }

    /* ═══════════════════════ 纯函数（可离线单测）═══════════════════════ */

    function clamp01(value) {
      if (!(value > 0)) return 0;
      return value > 1 ? 1 : value;
    }

    function pctFromIndex(index, count) {
      if (count <= 0) return 0;
      if (count === 1) return 1;
      var safe = Math.max(0, Math.min(count - 1, index));
      return safe / (count - 1);
    }

    function indexFromPct(pct, count) {
      if (count <= 1) return 0;
      return Math.max(0, Math.min(count - 1, Math.round(clamp01(pct) * (count - 1))));
    }

    /** 旋钮圆心在轨道里的 x（两端各留半个旋钮，圆角方钮不会被裁掉）。 */
    function xForPct(pct) {
      return KNOB_W / 2 + clamp01(pct) * (TRACK_W - KNOB_W);
    }

    function pctFromX(x) {
      return clamp01((x - KNOB_W / 2) / (TRACK_W - KNOB_W));
    }

    function modelOf(state) {
      var current = state && state.current;
      if (!current || typeof current.provider !== "string" || typeof current.model !== "string") return null;
      var groups = state && Array.isArray(state.groups) ? state.groups : [];
      for (var i = 0; i < groups.length; i += 1) {
        var group = groups[i];
        if (!group || group.id !== current.provider) continue;
        var models = Array.isArray(group.models) ? group.models : [];
        for (var j = 0; j < models.length; j += 1) {
          if (models[j] && models[j].id === current.model) return models[j];
        }
      }
      return null;
    }

    function levelsOf(state) {
      var model = modelOf(state);
      var efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : [];
      var out = [];
      for (var i = 0; i < efforts.length; i += 1) {
        var effort = efforts[i];
        if (!effort || typeof effort.id !== "string" || effort.id.length === 0) continue;
        out.push({
          id: effort.id,
          name: typeof effort.name === "string" && effort.name.length > 0 ? effort.name : effort.id,
        });
      }
      return out;
    }

    function effectiveEffortId(state) {
      var current = state && state.current;
      if (current && typeof current.reasoningEffort === "string" && current.reasoningEffort.length > 0) {
        return current.reasoningEffort;
      }
      var model = modelOf(state);
      var fallback = model && model.reasoning && model.reasoning.defaultEffort;
      return typeof fallback === "string" && fallback.length > 0 ? fallback : null;
    }

    function rankOf(effortId) {
      if (typeof effortId !== "string") return null;
      var key = effortId.toLowerCase();
      return Object.prototype.hasOwnProperty.call(LEVEL_RANK, key) ? LEVEL_RANK[key] : null;
    }

    /**
     * 把 6 个视觉档位落到当前模型真实存在的档位上：
     *   有同名档位 → 直接用；
     *   没有 → 取"档次最接近"的一档（同距离时取低的一档，避免 Medium 一上手就跳到 high）。
     */
    function resolveStops(levels) {
      var available = [];
      for (var i = 0; i < levels.length; i += 1) if (levels[i] && levels[i].id) available.push(levels[i].id);
      if (available.length === 0) return STOPS.slice();
      var out = [];
      for (var s = 0; s < STOPS.length; s += 1) {
        var stop = STOPS[s];
        var chosen = stop.effort;
        var found = false;
        for (var a = 0; a < available.length; a += 1) if (available[a] === stop.effort) { found = true; break; }
        if (!found) {
          var target = rankOf(stop.effort);
          var best = available[0];
          var bestDistance = Infinity;
          for (var b = 0; b < available.length; b += 1) {
            var rank = rankOf(available[b]);
            var distance = target === null || rank === null ? 999 : Math.abs(rank - target);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = available[b];
            } else if (distance === bestDistance) {
              var currentRank = rankOf(best);
              if (rank !== null && currentRank !== null && rank < currentRank) best = available[b];
            }
          }
          chosen = best;
        }
        out.push({ key: stop.key, label: stop.label, effort: chosen, ultra: stop.ultra === true });
      }
      return out;
    }

    /** 当前真实档位对应第几个视觉档位（同档位取**第一个**，Ultracode 靠 remembered 区分）。 */
    function indexForEffort(effortId, stops) {
      if (typeof effortId !== "string" || !stops || stops.length === 0) return -1;
      for (var i = 0; i < stops.length; i += 1) if (stops[i].effort === effortId) return i;
      var target = rankOf(effortId);
      if (target === null) return -1;
      var best = -1;
      var bestDistance = Infinity;
      for (var j = 0; j < stops.length; j += 1) {
        var rank = rankOf(stops[j].effort);
        if (rank === null) continue;
        var distance = Math.abs(rank - target);
        if (distance < bestDistance) { bestDistance = distance; best = j; }
      }
      return best;
    }

    /**
     * 显示用档位：优先用用户上次真正点过的视觉档（Max / Ultracode 都是 max，只有记住才分得清）。
     * remembered 只在「它仍属于同一模型、且 effort 仍等于当前真实档位」时才算数。
     */
    function preferredIndex(effortId, remembered, stops, modelKey) {
      if (remembered && typeof remembered.key === "string" && stops) {
        var sameModel = !remembered.model || !modelKey || remembered.model === modelKey;
        if (sameModel) {
          for (var i = 0; i < stops.length; i += 1) {
            if (stops[i].key === remembered.key && stops[i].effort === effortId) return i;
          }
        }
      }
      return indexForEffort(effortId, stops);
    }

    /* ── 像素纹理 ──────────────────────────────────────────────────────
     * 参考帧里的纹理不是渐变，而是一格一格的圆角方块：
     *   · 格子约 4px、圆角约 1px、格间留 1px 缝
     *   · 透明度从左往右递增，左缘随机"缺格"形成溶解
     * 用确定性哈希（不用 Math.random），刷新/重渲染不会跳变，也能离线断言。
     */
    function hash01(a, b, c) {
      var h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 1274126177;
      h = (h ^ (h >>> 13)) * 1274126177;
      h = h ^ (h >>> 16);
      return ((h >>> 0) % 100000) / 100000;
    }

    /** 某一列格子的透明度（0..1）。x 是格子左边距，w 是整条纹理宽度。 */
    function ditherAlphaAt(x, w, col, row) {
      /* 参考的网格是**铺满整条轨道**的：左端只是暗，不是没有格子。 */
      var t = clamp01(x / Math.max(1, w));
      var ramp = 0.92 + 0.08 * t;
      var jitter = 0.25 + 0.75 * hash01(col, row, 7);
      return clamp01(ramp * jitter);
    }

    function mixChannel(a, b, t) {
      return Math.round(a + (b - a) * t);
    }

    /** 画一个圆角方块（像素底/面共用）。 */
    function fillRoundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
    }

    /**
     * 画一帧像素纹理。
     *
     * progress 0..1：从右往左**逐格溶解出现**（参考里约 0.7s，不是一条硬边扫过）；
     * tick：每 170ms 换一次，让每格按自己的相位闪烁 —— 参考里网格位置不动，
     *       变的是单格亮度，像一片数字星尘，而不是一道光滑的扫光。
     */
    /** 平滑值噪声：给定格子与时间，返回 0..1 的连续值（smoothstep 插值）。 */
    function valueNoise(col, row, timeSec, speed, seed) {
      var tt = timeSec * speed + hash01(col, row, seed) * 17;
      var step = Math.floor(tt);
      var f = tt - step;
      var e = f * f * (3 - 2 * f);
      var a = hash01(col, row, (step % 997) + seed * 11);
      var b = hash01(col, row, ((step + 1) % 997) + seed * 11);
      return a + (b - a) * e;
    }

    /* 浅色的马赛克不是等大网格：约 14% 的格子并成 2×2，位置固定（哈希决定） */
    var mergeCache = null;
    var mergeCacheKey = "";
    function getMergeMap(cols, rows) {
      var key = cols + "x" + rows;
      if (mergeCache && mergeCacheKey === key) return mergeCache;
      var map = new Uint8Array(cols * rows);
      /* 0 普通；1 = 2×2 锚点；2 = 被覆盖；3 = 2×1 锚点；4 = 1×2 锚点 */
      for (var r = 0; r < rows; r += 1) {
        for (var c = 0; c < cols; c += 1) {
          var i = r * cols + c;
          if (map[i]) continue;
          var h = hash01(c, r, 91);
          /* 官方马赛克以规则 1×1 为主，合并块是点缀（约 5%），否则网格感会碎 */
          if (h < 0.02 && c + 1 < cols && r + 1 < rows && !map[i + 1] && !map[i + cols] && !map[i + cols + 1]) {
            map[i] = 1; map[i + 1] = 2; map[i + cols] = 2; map[i + cols + 1] = 2;
          } else if (h < 0.06 && c + 1 < cols && !map[i + 1]) {
            map[i] = 3; map[i + 1] = 2;
          } else if (h < 0.08 && r + 1 < rows && !map[i + cols]) {
            map[i] = 4; map[i + cols] = 2;
          }
        }
      }
      mergeCache = map;
      mergeCacheKey = key;
      return map;
    }

    function paintDither(ctx, w, h, dark, progress, timeSec, intensity) {
      var strength = typeof intensity === "number" ? intensity : 1;
      ctx.clearRect(0, 0, w, h);
      /* 参考实现的紫色底晕：左 38% 透明，向右渐显 */
      /* 底晕跟着充能前沿走：铺开时只在已经扫过的区域出现，铺满后才覆盖整条 */
      var k = 1 - progress;
      var s1 = Math.max(0, Math.min(1, k - 0.08));
      var s2 = Math.max(s1, Math.min(1, k + 0.18));
      var wash = ctx.createLinearGradient(0, 0, w, 0);
      if (dark) {
        wash.addColorStop(0, "rgba(112,78,162,0)");
        wash.addColorStop(s1, "rgba(112,78,162,0)");
        wash.addColorStop(s2, "rgba(118,84,169,0.3)");
        wash.addColorStop(1, "rgba(116,84,170,0.75)");
      } else {
        /* 浅色：官方底是不透明的灰→紫渐变（左端仍露出 CSS 轨道的暖灰，
           充能前沿之后从暖灰一路压到饱和紫），块坐在底上两极分化。 */
        wash.addColorStop(0, "rgba(142,118,192,0)");
        wash.addColorStop(s1, "rgba(142,118,192,0)");
        wash.addColorStop(s2, "rgba(142,118,192,0.45)");
        wash.addColorStop(1, "rgba(142,118,192,1)");
      }
      ctx.globalAlpha = 1; /* 必须先复位：否则会继承上一帧最后格子的 alpha，底晕就会闪 */
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);
      /* 像素是白色，靠 alpha 和底色混合，不再自带紫色 */
      /* 每个像素在紫/白之间随机取一个混合比例 */
      var purple = dark ? [208, 192, 246] : [150, 130, 205];
      var white = dark ? [255, 255, 255] : [245, 245, 250];
      var cell = CELL; /* 深浅同一套 6 行网格 */
      var cols = Math.ceil(w / cell);
      var rows = Math.ceil(h / cell);
      for (var col = 0; col < cols; col += 1) {
        var x = col * cell;
        var t = clamp01(x / Math.max(1, w));
        /* 从右到左一条连续的坡道：左边只是更暗、更稀，不是另一套动画，
           所以波传过去时能和尾部自然衔接，不会有接缝。 */
        var fade = clamp01((t - 0.02) / 0.48);
        for (var row = 0; row < rows; row += 1) {
          var base = ditherAlphaAt(x, w, col, row);
          if (base < 0.05) continue;
          /* 进度条式推进：一条波前从右往左退，格子过了波前才亮，
             只在边缘留 ±2.5% 的参差，不破坏整体的扫描感。 */
          var front = 1 - progress;
          var edgeJit = (hash01(col, row, 31) - 0.5) * 0.05;
          if (t < front + edgeJit) continue;
          var appear = 0.35 + 0.65 * clamp01((t - front - edgeJit) / 0.04);
          /* 每一行各自一条波，但**一律向左**：波峰数、速度、相位按行随机，
             行与行之间不同步；尾部不另做动画，直接由同一条坡道衰减出来。
             注意：相位里**不能**掺每格的随机量 —— 那会让相邻格子的峰值先后颠倒，
             看上去就成了“有的脉冲往右走”。随机只加在形状/幅度/有无上。 */
          var rowWaves = 3 + Math.floor(hash01(0, row, 47) * 5);
          var rowSpeed = 5.0 + 10.0 * hash01(0, row, 43);
          var rowPhase = hash01(0, row, 53) * Math.PI * 2;
          /* 第二列波：不同波长，但**相速度与第一列相同**（ω∝N），
             两列叠起来只是把图案搅得更随机，整体仍然刚性向左平移，不会互相追尾。 */
          var rowWaves2 = 2 + Math.floor(hash01(0, row, 61) * 4);
          var rowSpeed2 = rowSpeed * (rowWaves2 / rowWaves);
          var rowPhase2 = hash01(0, row, 71) * Math.PI * 2;
          var u1 = ((t * rowWaves * Math.PI * 2 + timeSec * rowSpeed + rowPhase) / (Math.PI * 2)) % 1;
          if (u1 < 0) u1 += 1;
          var u2 = ((t * rowWaves2 * Math.PI * 2 + timeSec * rowSpeed2 + rowPhase2) / (Math.PI * 2)) % 1;
          if (u2 < 0) u2 += 1;
          /* 彗星形脉冲：前缘陡、向右拖尾；指数按格随机只改“形状”，峰值时刻仍由相位决定 */
          var p1 = Math.pow(1 - u1, 2.6 + 3.4 * hash01(col, row, 17));
          var p2 = Math.pow(1 - u2, 3.4);
          /* 两列取较大值会把整体亮度抬高，乘 0.85 压回来，保留“少数格子亮”的对比 */
          var pulse = Math.max(p1, p2 * (0.55 + 0.45 * hash01(col, row, 19))) * 0.85;
          if (!dark) {
            /* 浅色：官方静态观感（灰→紫底渐变 + 连续分布的方块马赛克），
               但**动画管线与最终版完全一致**——波峰经过时块发白、推进前沿闪白。 */
            var lt = clamp01((t - 0.05) / 0.2);
            if (lt <= 0) continue;
            var lmap = getMergeMap(cols, rows);
            var mi = row * cols + col;
            var mv = lmap[mi];
            if (mv === 2) continue;
            if (hash01(col, row, 95) < 0.03) continue; /* 少量缺格，打破规整感 */
            var wide = mv === 3 || mv === 1;
            var tall = mv === 4 || mv === 1;
            var y2 = row * cell;
            var u = hash01(col, row, 93);
            /* 官方块色实测：连续分布、色差幅度随 t 拉宽。
               p50 底线已预扣 glow 的平均提亮，保证列均值吻合。 */
            var sp = 22 + 66 * t;
            var off = (u - 0.42) * sp;
            if (off > 0) off *= 1.1; /* 亮端拉更宽 */
            var br = 187 - 32 * t;
            var bg = 184 - 46 * t;
            var bb = 206 + 4 * t;
            var lr = br + off;
            var lg = bg + (off < 0 ? off : off * 1.05);
            var lb = bb + (off < 0 ? off : off * 0.65);
            /* 最终版动画之一：脉冲经过时块整体提亮（跟着波走） */
            lr = Math.max(124, Math.min(240, Math.round(lr + 12 * pulse)));
            lg = Math.max(100, Math.min(232, Math.round(lg + 12 * pulse)));
            lb = Math.max(180, Math.min(252, Math.round(lb + 8 * pulse)));
            var lw = cell * (wide ? 2 : 1) * 0.88; /* 缝约 12%，透出底渐变形成官方网格感 */
            var lh = cell * (tall ? 2 : 1) * 0.88;
            /* 最终版动画之三：左侧"外焰"——像素渐入渐出地明灭，不是硬开关；
               右侧（density 满）恒定实心，保持官方那种满铺马赛克。 */
            var flicker = valueNoise(col, row, timeSec, 0.9, 83);
            var density = clamp01((t - 0.12) / 0.35);
            var threshold = 0.2 + 0.8 * density;
            var presence = density > 0.9 ? 1 : clamp01((threshold - flicker) / 0.2);
            if (presence <= 0.01) continue;
            var lAlpha = clamp01(lt * appear * presence * (0.7 + 0.3 * (1 - flicker)) * (0.85 + 0.15 * hash01(col, row, 29)));
            ctx.globalAlpha = lAlpha;
            ctx.fillStyle = "rgb(" + lr + "," + lg + "," + lb + ")";
            fillRoundRect(ctx, x + 0.5, y2 + 0.5, lw, lh, 1);
            /* 最终版动画之二：上层核心只跟动画走——波峰经过变白，
               推进前沿也会逐个闪白；浅色用亮白核心（官方也是白块在闪）。 */
            var whiteAmt = clamp01(pulse * (0.35 + 0.65 * t)) * (0.55 + 0.45 * hash01(col, row, 71)) * strength;
            if (progress < 0.999) {
              var flash = clamp01(1 - (t - front) / 0.16) * (0.55 + 0.45 * hash01(col, row, 73));
              whiteAmt = Math.max(whiteAmt, flash);
            }
            if (whiteAmt > 0.03) {
              ctx.globalAlpha = Math.min(1, lAlpha * (0.12 + 0.88 * whiteAmt));
              ctx.fillStyle = "rgb(247,243,255)";
              var ins = lw * 0.14;
              fillRoundRect(ctx, x + 0.5 + ins, y2 + 0.5 + ins, lw - ins * 2, lh - ins * 2, 0.7);
            }
            continue;
          }
          /* 越靠左越稀、越暗，但仍是连续的：没有"火尾专用"的缺格规则 */
          var flick = valueNoise(col, row, timeSec, 1.5, 5);
          var gap = dark ? (0.6 + 0.4 * clamp01((flick - (1 - fade) * 0.5) / 0.3)) : 1;
          /* 和铺开同时启动：不再等铺满 */
          var idle = 1;
          /* 最左端留一段"传不到头"的空间：越靠边越暗，波也在到达前衰减；
             只留极少数格子若隐若现。 */
          /* 到 Medium（约 20%）才开始"似有似无"，再往左更少 */
          var vis = clamp01((t - 0.2) / 0.18);
          var ghost = 0.06 * clamp01((flick - 0.5) / 0.5) * (1 - vis);
          var level = 0.5 + 0.5 * pulse * idle * (0.6 + 0.4 * t);
          /* 深色：到 Medium 才渐隐；浅色：像官方那样从最左就很淡地铺满 */
          var lvis = clamp01((t - 0.12) / 0.32);
          var baseAlpha = dark ? (0.04 + 0.96 * vis + ghost) : (lvis * (0.9 + 0.1 * t));
          /* 紫色格子常驻：不受脉冲影响，除最左端外每个位置都有 */
          var gridAlpha = clamp01(base * baseAlpha * gap * appear * (dark ? 1.15 : 1.9) * (0.9 + 0.1 * hash01(col, row, 29)) * strength);
          if (gridAlpha < 0.008) continue;
          var y = row * cell;
          var size = cell * 0.72; /* 深色：块占格 72% */
          ctx.globalAlpha = Math.min(1, gridAlpha * (dark ? 0.55 : 1));
          ctx.fillStyle = "rgb(" + purple[0] + "," + purple[1] + "," + purple[2] + ")";
          fillRoundRect(ctx, x + 0.5, y + 0.5, size, size, 1.1);
          /* 上层紫/白像素，内缩 1px，让紫色从边缘透出来 */
          /* 上层白色只跟着动画走：波峰经过时变白，推进前沿也会闪白 */
          var whiteAmt = clamp01(pulse * (0.35 + 0.65 * t)) * (0.55 + 0.45 * hash01(col, row, 71)) * strength;
          if (progress < 0.999) {
            /* 推进前沿：白色像素逐个冒出来（每格有各自的强度），铺满后接回脉冲 */
            var flash = clamp01(1 - (t - front) / 0.16) * (0.55 + 0.45 * hash01(col, row, 73));
            whiteAmt = Math.max(whiteAmt, flash);
          }
          if (whiteAmt > 0.03) {
            ctx.globalAlpha = Math.min(1, gridAlpha * (0.1 + 0.72 * whiteAmt));
            /* 深色用白点，浅色用更深的紫色核心，保证两边都能看到脉冲在动 */
            ctx.fillStyle = dark ? "rgb(220,204,255)" : "rgb(214,202,242)";
            var inset = 0; /* 参考没有白核 */
            fillRoundRect(ctx, x + 0.5 + inset, y + 0.5 + inset, size - inset * 2, size - inset * 2, 0.7);
          }
        }
      }
      ctx.globalAlpha = 1; /* 收尾复位，避免影响下一帧的底晕 */
    }

    /**
     * 判断"当前界面看起来是深色还是浅色"。
     *
     * 不能只看 body[data-ds-dark-theme]：自定义主题（例如鲸鱼主题）会把 `--dsw-*`
     * 令牌整体换成深色，却不设置这个属性。所以直接量 body 的实际背景亮度。
     */
    function surfaceIsDark() {
      try {
        if (typeof document === "undefined" || !document.body || typeof window === "undefined") return true;
        var bg = window.getComputedStyle(document.body).backgroundColor || "";
        var parts = bg.match(/[\d.]+/g);
        if (!parts || parts.length < 3) return true;
        if (parts.length > 3 && Number(parts[3]) < 0.5) return true;
        var luminance = (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255;
        return luminance < 0.5;
      } catch (error) {
        return true;
      }
    }

    /** 把明暗结果写到 body 上，供 CSS 选择（只在启动与主题变化时执行）。 */
    function syncSurfaceAttr() {
      try {
        if (typeof document === "undefined" || !document.body) return;
        var next = surfaceIsDark() ? "1" : "0";
        if (document.body.getAttribute("data-dces-dark") !== next) document.body.setAttribute("data-dces-dark", next);
      } catch (error) {
        /* 只影响配色 */
      }
    }

    /* ═══════════════════════ 设置（localStorage）═══════════════════════ */

    var DEFAULT_SETTINGS = { ticks: "show", texture: "normal" };

    function normalizeSettings(input) {
      var out = { ticks: DEFAULT_SETTINGS.ticks, texture: DEFAULT_SETTINGS.texture };
      if (input && typeof input === "object") {
        if (input.ticks === "show" || input.ticks === "hide") out.ticks = input.ticks;
        if (input.texture === "normal" || input.texture === "soft") out.texture = input.texture;
      }
      return out;
    }

    function readSettings() {
      try {
        if (typeof localStorage === "undefined" || !localStorage) return normalizeSettings(null);
        var raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return normalizeSettings(null);
        return normalizeSettings(JSON.parse(raw));
      } catch (error) {
        return normalizeSettings(null);
      }
    }

    function writeSettings(next) {
      var value = normalizeSettings(next);
      try {
        if (typeof localStorage !== "undefined" && localStorage) localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
      } catch (error) {
        /* 存不下就只在本次会话生效 */
      }
      return value;
    }

    function readRemembered(sessionId) {
      try {
        if (!sessionId || typeof localStorage === "undefined" || !localStorage) return null;
        var raw = localStorage.getItem(STOPS_KEY);
        if (!raw) return null;
        var map = JSON.parse(raw);
        return map && typeof map === "object" ? map[sessionId] || null : null;
      } catch (error) {
        return null;
      }
    }

    function rememberStop(sessionId, entry) {
      if (!sessionId) return;
      try {
        if (typeof localStorage === "undefined" || !localStorage) return;
        var raw = localStorage.getItem(STOPS_KEY);
        var map = raw ? JSON.parse(raw) : {};
        if (!map || typeof map !== "object") map = {};
        map[sessionId] = entry;
        var keys = Object.keys(map);
        if (keys.length > 40) {
          for (var i = 0; i < keys.length - 40; i += 1) delete map[keys[i]];
        }
        localStorage.setItem(STOPS_KEY, JSON.stringify(map));
      } catch (error) {
        /* 记不住只影响 Max/Ultracode 的区分，不影响功能 */
      }
    }

    /* ═══════════════════════ 目录访问器 ═══════════════════════ */

    function createAccess(ctx, sessionId) {
      var directory = null;
      var unsubscribe = null;
      var listeners = new Set();
      var retryIndex = 0;
      var retryTimer = null;
      var closed = false;
      var last = EMPTY_SNAPSHOT;
      var lastLoadAt = 0;

      function notify() {
        var snapshot = [];
        listeners.forEach(function (fn) { snapshot.push(fn); });
        for (var i = 0; i < snapshot.length; i += 1) {
          try { snapshot[i](); } catch (error) { /* 单个订阅者抛错不影响其它 */ }
        }
      }

      function scheduleRetry() {
        if (closed || retryTimer !== null || retryIndex >= RETRY_DELAYS.length) return;
        var delay = RETRY_DELAYS[retryIndex];
        retryIndex += 1;
        retryTimer = setTimeout(function () {
          retryTimer = null;
          if (resolve() !== null) { notify(); return; }
          scheduleRetry();
        }, delay);
      }

      function resolve() {
        if (closed) return null;
        var fresh = null;
        try {
          /* modelDirectories 不再是必需依赖：拿不到就退回自己渲染的胶囊，功能不受影响 */
          fresh = ctx.modelDirectories && typeof ctx.modelDirectories.directoryFor === "function"
            ? ctx.modelDirectories.directoryFor(sessionId)
            : null;
        } catch (error) { fresh = null; }
        if (!fresh || !fresh.store || typeof fresh.store.getSnapshot !== "function") fresh = null;
        if (fresh === directory) return directory;
        if (unsubscribe !== null) {
          try { unsubscribe(); } catch (error) { /* ignore */ }
          unsubscribe = null;
        }
        directory = fresh;
        if (directory !== null) {
          retryIndex = 0;
          try {
            unsubscribe = typeof directory.store.subscribe === "function" ? directory.store.subscribe(notify) : null;
          } catch (error) {
            unsubscribe = null;
          }
          kickLoad();
        }
        return directory;
      }

      function kickLoad() {
        if (closed || directory === null || typeof directory.load !== "function") return;
        var now = Date.now();
        if (now - lastLoadAt < 400) return;
        lastLoadAt = now;
        var target = directory;
        try {
          Promise.resolve(target.load()).catch(function () { /* 失败由 store.error 呈现 */ });
        } catch (error) {
          /* ignore */
        }
      }

      return {
        getSnapshot: function () {
          if (closed) return EMPTY_SNAPSHOT;
          if (directory === null) {
            resolve();
            if (directory === null) scheduleRetry();
          }
          if (directory !== null) {
            try {
              var value = directory.store.getSnapshot();
              if (value && typeof value === "object") last = value;
            } catch (error) { /* 保留上次快照 */ }
          }
          return last;
        },
        subscribe: function (listener) {
          if (closed) return function () {};
          listeners.add(listener);
          if (directory === null) {
            resolve();
            if (directory === null) scheduleRetry();
          }
          return function () { listeners.delete(listener); };
        },
        directory: function () { return directory; },
        close: function () {
          closed = true;
          listeners.clear();
          if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
          if (unsubscribe !== null) {
            try { unsubscribe(); } catch (error) { /* ignore */ }
            unsubscribe = null;
          }
        },
      };
    }

    /* ═══════════════════════ 组件 ═══════════════════════ */

    var useSyncExternalStore = typeof React.useSyncExternalStore === "function" ? React.useSyncExternalStore : null;

    function useStore(access) {
      if (useSyncExternalStore) {
        return useSyncExternalStore(
          React.useCallback(function (cb) { return access ? access.subscribe(cb) : function () {}; }, [access]),
          React.useCallback(function () { return access ? access.getSnapshot() : EMPTY_SNAPSHOT; }, [access]),
        );
      }
      var pair = React.useState(access ? access.getSnapshot() : EMPTY_SNAPSHOT);
      var snapshot = pair[0];
      var setSnapshot = pair[1];
      React.useEffect(function () {
        if (!access) return undefined;
        setSnapshot(access.getSnapshot());
        return access.subscribe(function () { setSnapshot(access.getSnapshot()); });
      }, [access]);
      return snapshot;
    }

    /** Effort 右侧的档位文字：切换档位时抖一下（RGB 错位 + 轻模糊）。 */
    function ValueLabel(props) {
      var ref = React.useRef(null);
      React.useEffect(function () {
        var el = ref.current;
        if (!el) return undefined;
        el.classList.remove("dces-glitch");
        void el.offsetWidth;
        el.classList.add("dces-glitch");
        var timer = setTimeout(function () { if (el) el.classList.remove("dces-glitch"); }, 320);
        return function () { clearTimeout(timer); };
      }, [props.label]);
      return React.createElement("span", {
        ref: ref,
        className: "dces-value",
        "data-ultra": props.ultra ? "1" : "0",
      }, React.createElement("span", { key: props.label, className: "dces-value-inner" }, props.label));
    }

    /** 参考里的纹理动画：逐格溶解出现 + 每格独立闪烁；减少动态效果时只画静止终帧。 */
    /* 记住已经播完铺开动画的状态：关掉浮层再打开时直接显示终帧，不再重播 */
    var lastPlayedKey = null;

    function DitherCanvas(props) {
      var ref = React.useRef(null);
      var intensity = typeof props.intensity === "number" ? props.intensity : 1;
      var sweep = props.sweep !== false;
      React.useEffect(function () {
        var canvas = ref.current;
        if (!canvas) return undefined;
        var dpr = Math.min(3, Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
        canvas.width = Math.round(TRACK_W * dpr);
        canvas.height = Math.round(TRACK_H * dpr);
        var ctx = canvas.getContext("2d");
        if (!ctx) return undefined;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        /* 刻意**不**读 prefers-reduced-motion：系统一开这个开关，浏览器就会把整段
           动画降级成静止终帧（之前的"待机没有动画 / 拉满瞬间完成"就是这么来的）。
           参考本身是持续动画，这里按参考走。 */
        var start = 0;
        var raf = 0;
        var alreadyPlayed = !!(props.animKey && props.animKey === lastPlayedKey);
        function frame(now) {
          if (start === 0) start = now;
          var progress = alreadyPlayed ? 1 : (sweep ? Math.min(1, (now - start) / 1600) : 1);
          if (!alreadyPlayed && progress >= 1 && props.animKey) lastPlayedKey = props.animKey;
          /* 每帧重绘（60fps）：之前限到 30fps 是"不顺滑"的另一个原因。 */
          paintDither(ctx, TRACK_W, TRACK_H, props.dark, progress, (now - start) / 1000, intensity);
          raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
        return function () { cancelAnimationFrame(raf); };
      }, [props.dark, intensity, sweep, props.animKey, props.playSeq]);
      return React.createElement("canvas", { ref: ref, className: "dces-dither", "aria-hidden": "true", style: { opacity: props.opacity === undefined ? 1 : props.opacity } });
    }

    function EffortSlider(props) {
      var stops = props.stops;
      var index = props.index;
      var off = props.off === true;
      var draft = props.draft;
      var trackRef = React.useRef(null);
      var dragRef = React.useRef(false);
      var lastRef = React.useRef(-1);

      function indexAt(clientX) {
        var rect = trackRef.current ? trackRef.current.getBoundingClientRect() : null;
        if (!rect || rect.width <= 0) return 0;
        return indexFromPct(pctFromX(clientX - rect.left), stops.length);
      }

      function onPointerDown(event) {
        event.preventDefault();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        dragRef.current = true;
        var next = indexAt(event.clientX);
        lastRef.current = next;
        props.onPreview(next);
        /* 拖动过程只做本地预览；写回放在松手时一次完成 ——
           DSH 的 session 持久化是单写句柄，拖动中连续 select 很容易撞锁。 */
      }

      function onPointerMove(event) {
        if (!dragRef.current) return;
        var next = indexAt(event.clientX);
        if (next === lastRef.current) return;
        lastRef.current = next;
        props.onPreview(next);
      }

      function finish(event) {
        if (!dragRef.current) return;
        dragRef.current = false;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        /* 松手位置才是最终意图：快速拖动时 pointermove 可能被合并，不能只信 lastRef */
        var next = event.type === "pointercancel"
          ? (lastRef.current >= 0 ? lastRef.current : index)
          : indexAt(event.clientX);
        props.onCommit(next, true);
      }

      function onKeyDown(event) {
        var next = index;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, index - 1);
        else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(stops.length - 1, index + 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = stops.length - 1;
        else return;
        event.preventDefault();
        props.onPreview(next);
        props.onCommit(next, true);
      }

      var pct = pctFromIndex(index, stops.length);
      var x = xForPct(pct);
      var ultra = !off && stops[index] && stops[index].ultra === true;
      /* Medium 起就有一点像素（似有似无），越往上越强；铺开扫描只在 Ultracode */
      var showDither = ultra;
      var ditherIntensity = 1;
      var ticks = [];
      for (var i = 0; i < stops.length; i += 1) {
        var tx = xForPct(pctFromIndex(i, stops.length));
        ticks.push(React.createElement("span", {
          key: "tick-" + i,
          className: "dces-tick",
          "data-on": !off && i <= index ? "1" : "0",
          "data-last": i === stops.length - 1 ? "1" : "0",
          "data-hidden": props.settings && props.settings.ticks === "hide" ? "1" : "0",
          style: { left: tx + "px", display: props.settings && props.settings.ticks === "hide" ? "none" : undefined },
        }));
      }

      return React.createElement(
        "div",
        {
          ref: trackRef,
          className: "dces-track",
          "data-ultra": ultra ? "1" : "0",
          "data-drag": draft !== null ? "1" : "0",
          role: "slider",
          tabIndex: 0,
          "aria-valuemin": 0,
          "aria-valuemax": stops.length - 1,
          "aria-valuenow": index,
          "aria-valuetext": props.label,
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: finish,
          onPointerCancel: finish,
          onKeyDown: onKeyDown,
          onContextMenu: props.onContextMenu,
        },
        React.createElement("span", {
          className: "dces-fill",
          style: { width: (off ? 0 : (ultra ? "100%" : x + "px")) },
        }, showDither ? React.createElement(DitherCanvas, {
          dark: surfaceIsDark(),
          opacity: props.settings && props.settings.texture === "soft" ? 0.75 : 1,
          intensity: ditherIntensity,
          sweep: ultra,
          animKey: props.animKey,
          playSeq: props.playSeq,
        }) : null),
        ticks,
        React.createElement("span", { className: "dces-knob", style: { left: x + "px" } }),
      );
    }

    function EffortPopover(props) {
      var settings = props.settings;
      var ultra = props.ultra === true;
      var tipPair = React.useState(false);
      var tip = tipPair[0];
      var setTip = tipPair[1];
      var panelPair = React.useState(false);
      var panel = panelPair[0];
      var setPanel = panelPair[1];

      return ReactDOM.createPortal(
        React.createElement(
          "div",
          {
            className: "dces-pop",
            style: { left: props.pos.left + "px", bottom: props.pos.bottom + "px" },
            /* 不用 role="dialog"：官方主题会用它给所有 [role=dialog] 套一层蓝色玻璃渐变（!important），
               那会把参考里的中性深色面板盖掉。用 group + aria-label，可访问性不受影响。 */
            role: "group",
            "aria-label": "Effort",
            onContextMenu: function (event) { event.preventDefault(); setPanel(true); },
          },
          React.createElement(
            "div",
            { className: "dces-head" },
            React.createElement(
              "div",
              { className: "dces-title" },
              "Effort",
              React.createElement(ValueLabel, { label: props.label, ultra: ultra }),
            ),
            React.createElement(
              "button",
              { type: "button", className: "dces-help", "aria-label": "说明", onClick: function () { setTip(!tip); } },
              "?",
            ),
          ),
          tip
            ? React.createElement("div", { className: "dces-tip" }, "档位越高，模型每一步思考得越久。Ultracode 会以 Max 强度运行，并点亮这条轨道。")
            : null,
          React.createElement(
            "div",
            { className: "dces-labels" },
            React.createElement("span", null, "Faster"),
            React.createElement("span", null, "Smarter"),
          ),
          React.createElement(EffortSlider, {
            stops: props.stops,
            index: props.index,
            label: props.label,
            off: props.off,
            draft: props.draft,
            settings: settings,
            animKey: props.animKey,
            playSeq: props.playSeq,
            onPreview: props.onPreview,
            onCommit: props.onCommit,
            onContextMenu: function (event) { event.preventDefault(); setPanel(true); },
          }),
          props.error ? React.createElement("div", { className: "dces-err" }, props.error) : null,
          panel
            ? React.createElement(
                "div",
                { className: "dces-set" },
                React.createElement(
                  "div",
                  { className: "dces-set-row" },
                  React.createElement("span", null, "刻度点"),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "dces-set-btn",
                      onClick: function () {
                        props.onSettings(Object.assign({}, settings, { ticks: settings.ticks === "hide" ? "show" : "hide" }));
                      },
                    },
                    settings.ticks === "hide" ? "已隐藏" : "已显示",
                  ),
                ),
                React.createElement(
                  "div",
                  { className: "dces-set-row" },
                  React.createElement("span", null, "纹理强度"),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "dces-set-btn",
                      onClick: function () {
                        props.onSettings(Object.assign({}, settings, { texture: settings.texture === "soft" ? "normal" : "soft" }));
                      },
                    },
                    settings.texture === "soft" ? "柔和" : "标准",
                  ),
                ),
                React.createElement(
                  "div",
                  { className: "dces-set-row" },
                  React.createElement("span", null, "恢复默认"),
                  React.createElement(
                    "button",
                    { type: "button", className: "dces-set-btn", onClick: function () { props.onSettings(null); } },
                    "重置",
                  ),
                ),
                React.createElement("div", { className: "dces-set-hint" }, "在轨道上点右键可再次打开"),
              )
            : null,
        ),
        document.body,
      );
    }

    /** 官方 trigger 里的 effort span —— 本插件唯一的改造对象。 */
    function findEffortSpan(trigger) {
      if (!trigger) return null;
      var spans = trigger.querySelectorAll(":scope > span");
      if (spans.length >= 2) {
        var last = spans[spans.length - 1];
        var text = (last.textContent || "").trim().toLowerCase();
        if (text.length > 0 && text.length <= 12) return last;
      }
      for (var i = 0; i < spans.length; i += 1) {
        var value = (spans[i].textContent || "").trim().toLowerCase();
        if (EFFORT_NAMES.indexOf(value) >= 0) return spans[i];
      }
      return null;
    }

    function EffortSeat(props) {
      var ctx = props.__ctx;
      var sessionId = props.sessionId || null;
      var anchorRef = React.useRef(null);

      var accessRef = React.useRef(null);
      var accessSessionRef = React.useRef(null);
      if (accessSessionRef.current !== sessionId) {
        if (accessRef.current) { try { accessRef.current.close(); } catch (error) { /* ignore */ } }
        accessRef.current = ctx && sessionId ? createAccess(ctx, sessionId) : null;
        accessSessionRef.current = sessionId;
      }
      React.useEffect(function () {
        return function () {
          if (accessRef.current) { try { accessRef.current.close(); } catch (error) { /* ignore */ } }
        };
      }, []);

      var state = useStore(accessRef.current);
      var levels = levelsOf(state);
      var stops = React.useMemo(function () { return resolveStops(levels); }, [state]);
      var realEffort = effectiveEffortId(state);
      var current = state && state.current;
      var modelKey = current && current.provider && current.model ? current.provider + "/" + current.model : "";

      var rememberedPair = React.useState(function () { return readRemembered(sessionId); });
      var remembered = rememberedPair[0];
      var setRemembered = rememberedPair[1];
      React.useEffect(function () {
        setRemembered(readRemembered(sessionId));
      }, [sessionId]);

      var storeIndex = preferredIndex(realEffort, remembered, stops, modelKey);
      var baseIndex = storeIndex >= 0 ? storeIndex : 0;

      var draftPair = React.useState(null);
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      var pendingPair = React.useState(null);
      var pending = pendingPair[0];
      var setPending = pendingPair[1];
      var playSeqPair = React.useState(0);
      var playSeq = playSeqPair[0];
      var setPlaySeq = playSeqPair[1];
      var openPair = React.useState(false);
      var open = openPair[0];
      var setOpen = openPair[1];
      var posPair = React.useState({ left: 0, bottom: 0 });
      var pos = posPair[0];
      var setPos = posPair[1];
      var errorPair = React.useState(null);
      var error = errorPair[0];
      var setError = errorPair[1];
      var settingsPair = React.useState(function () { return readSettings(); });
      var settings = settingsPair[0];
      var setSettings = settingsPair[1];
      /** null = 还没判定；true = 官方席位可用（改造它）；false = 找不到/被隐藏（用自己的胶囊） */
      var bridgePair = React.useState(null);
      var bridgeReady = bridgePair[0];
      var setBridgeReady = bridgePair[1];

      var index = draft !== null ? draft : (pending !== null ? pending : baseIndex);
      var offState = realEffort === "off" && draft === null && pending === null;
      var label = stops[index] ? stops[index].label : "Off";
      var ultra = !offState && stops[index] && stops[index].ultra === true;
      var canUse = levels.length >= 2;

      var commitRef = React.useRef({ timer: null, queued: null, inFlight: false, deadline: null, retries: 0 });

      function flush() {
        var pendingCommit = commitRef.current;
        if (pendingCommit.timer !== null) { clearTimeout(pendingCommit.timer); pendingCommit.timer = null; }
        /* 同一时刻只允许一个 select 在途：DSH 的 session 持久化是单写句柄，
           并发 select 会直接抛 "already owned by an active write handle"。
           在途时把值留在 queued 里，settle 之后自动补发。 */
        if (pendingCommit.inFlight) return;
        var effort = pendingCommit.queued;
        pendingCommit.queued = null;
        if (effort === null || accessRef.current === null) return;
        var latest = accessRef.current.getSnapshot();
        var selection = latest && latest.current;
        if (!selection || typeof selection.provider !== "string" || typeof selection.model !== "string") {
          setError("模型目录尚未就绪，档位未写入");
          setPending(null);
          return;
        }
        if (effectiveEffortId(latest) === effort) return;
        var directory = accessRef.current.directory();
        if (!directory || typeof directory.select !== "function") {
          setError("模型目录不可用，档位未写入");
          setPending(null);
          return;
        }

        pendingCommit.inFlight = true;
        setError(null);
        var result;
        try {
          result = directory.select({ provider: selection.provider, model: selection.model, reasoningEffort: effort });
        } catch (errorValue) {
          result = Promise.reject(errorValue);
        }
        if (pendingCommit.deadline !== null) clearTimeout(pendingCommit.deadline);
        pendingCommit.deadline = setTimeout(function () {
          pendingCommit.deadline = null;
          setPending(null);
          setError("写入超时，已回到实际档位");
        }, COMMIT_DEADLINE_MS);

        Promise.resolve(result).then(
          function (outcome) {
            pendingCommit.inFlight = false;
            if (outcome && outcome.ok === false) {
              var info = outcome.error || {};
              var message = String(info.message || info.code || "写入失败");
              /* 另一个插件/另一个写句柄正在持锁：等它松手再重试一次，不把红字丢给用户 */
              if (/already owned by an active write handle/i.test(message) && pendingCommit.retries < 4) {
                pendingCommit.retries += 1;
                setTimeout(function () {
                  if (commitRef.current === pendingCommit) {
                    pendingCommit.queued = effort;
                    flush();
                  }
                }, 220);
                return;
              }
              setPending(null);
              setError(message);
              return;
            }
            pendingCommit.retries = 0;
          },
          function (errorValue) {
            pendingCommit.inFlight = false;
            var text = String(errorValue && errorValue.message ? errorValue.message : errorValue);
            if (/already owned by an active write handle/i.test(text) && pendingCommit.retries < 2) {
              pendingCommit.retries += 1;
              setTimeout(function () {
                if (commitRef.current === pendingCommit) {
                  pendingCommit.queued = effort;
                  flush();
                }
              }, 220);
              return;
            }
            setPending(null);
            setError(text);
          },
        ).then(function () {
          if (pendingCommit.queued !== null) flush();
        });
      }

      function requestCommit(nextIndex, immediate) {
        var stop = stops[nextIndex];
        if (!stop) return;
        var effort = stop.effort;
        var latest = accessRef.current ? accessRef.current.getSnapshot() : state;
        if (effectiveEffortId(latest) === effort && commitRef.current.queued === null && !commitRef.current.inFlight) return;
        commitRef.current.queued = effort;
        setPending(nextIndex);
        if (immediate) {
          flush();
          return;
        }
        if (commitRef.current.timer === null) {
          commitRef.current.timer = setTimeout(flush, COMMIT_THROTTLE_MS);
        }
      }

      React.useEffect(function () {
        if (pending === null) return;
        var stop = stops[pending];
        if (stop && stop.effort === realEffort) {
          setPending(null);
          if (commitRef.current.deadline !== null) { clearTimeout(commitRef.current.deadline); commitRef.current.deadline = null; }
        }
      }, [realEffort, pending, stops]);

      React.useEffect(function () {
        return function () {
          if (commitRef.current.timer !== null) clearTimeout(commitRef.current.timer);
          if (commitRef.current.deadline !== null) clearTimeout(commitRef.current.deadline);
        };
      }, []);

      function choose(nextIndex, immediate) {
        var stop = stops[nextIndex];
        if (!stop) return;
        var entry = { key: stop.key, effort: stop.effort, model: modelKey };
        rememberStop(sessionId, entry);
        setRemembered(entry);
        setDraft(immediate ? null : nextIndex);
        requestCommit(nextIndex, immediate);
      }

      function openAt(element) {
        if (!element) return;
        var rect = element.getBoundingClientRect();
        var left = rect.right - POPOVER_W;
        left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_W - 8));
        var bottom = window.innerHeight - rect.top + 10;
        setPos({ left: left, bottom: bottom });
        setOpen(true);
      }
      var openRef = React.useRef(openAt);
      openRef.current = openAt;

      /* ── 胶囊桥：把官方 effort span 变成可点胶囊 ── */
      var bridgeRef = React.useRef({ applied: null, click: null });
      var ultraRef = React.useRef(false);
      var labelRef = React.useRef("Low");
      var canUseRef = React.useRef(false);
      ultraRef.current = ultra === true;
      labelRef.current = label;
      canUseRef.current = canUse;

      React.useEffect(function () {
        var anchor = anchorRef.current;
        if (!anchor || typeof document === "undefined") return undefined;
        var card = anchor.closest("[data-composer-card]") || document.body;
        var observer = null;
        var raf = null;

        function detach() {
          var bridge = bridgeRef.current;
          if (bridge.applied) {
            try {
              bridge.applied.classList.remove("dces-chip");
              bridge.applied.removeAttribute("data-ultra");
              bridge.applied.removeAttribute("data-dces-label");
              bridge.applied.removeAttribute("data-dces-chip");
              bridge.applied.removeAttribute("data-dces-native-effort-hidden");
              if (bridge.click) bridge.applied.removeEventListener("click", bridge.click, true);
            } catch (error) { /* ignore */ }
          }
          bridge.applied = null;
          bridge.click = null;
        }

        function isVisible(element) {
          if (!element) return false;
          try {
            var rect = element.getBoundingClientRect();
            if (rect.width < 4 || rect.height < 4) return false;
            var style = window.getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
          } catch (error) {
            return false;
          }
        }

        function findTrigger() {
          var list = card.querySelectorAll('button[aria-haspopup="menu"]');
          for (var i = 0; i < list.length; i += 1) {
            var span = findEffortSpan(list[i]);
            /* 另一个插件可能把官方模型席 display:none 掉，再换自己的控件：
               这种情况下改官方 span 是看不见的，必须退回自己的输入区胶囊。 */
            if (span && isVisible(list[i]) && isVisible(span)) return { trigger: list[i], span: span };
          }
          return null;
        }

        function apply() {
          if (!canUseRef.current) { detach(); setBridgeReady(false); return; }
          var found = findTrigger();
          if (!found) { detach(); setBridgeReady(false); return; }
          var bridge = bridgeRef.current;
          if (bridge.applied !== found.span) {
            detach();
            bridge.applied = found.span;
            /* 模型按钮和推理等级拆成两个独立按钮：原生等级文字隐藏，改用插槽里的胶囊 */
            found.span.setAttribute("data-dces-native-effort-hidden", "1");
          }
          setBridgeReady(true);
        }

        apply();
        try {
          observer = new MutationObserver(function () {
            if (raf !== null) return;
            raf = requestAnimationFrame(function () { raf = null; apply(); });
          });
          observer.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
        } catch (error) { /* ignore */ }

        return function () {
          if (observer) { try { observer.disconnect(); } catch (error) { /* ignore */ } }
          if (raf !== null) cancelAnimationFrame(raf);
          detach();
        };
      }, [sessionId, canUse]);

      /* 档位变化时只更新属性，不重挂监听 */
      React.useEffect(function () {
        var element = bridgeRef.current.applied;
        if (!element) return;
        element.setAttribute("data-ultra", ultra ? "1" : "0");
        element.setAttribute("data-dces-label", label);
      }, [ultra, label]);

      /* 关闭浮层 */
      React.useEffect(function () {
        if (!open) return undefined;
        function onDown(event) {
          if (event.target && event.target.closest && (event.target.closest(".dces-pop") || event.target.closest(".dces-slot-chip"))) return;
          var chip = bridgeRef.current.applied;
          if (chip && chip.contains(event.target)) return;
          setOpen(false);
        }
        function onKey(event) { if (event.key === "Escape") setOpen(false); }
        function onScroll() { setOpen(false); }
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", onScroll);
        window.addEventListener("scroll", onScroll, true);
        return function () {
          document.removeEventListener("mousedown", onDown, true);
          document.removeEventListener("keydown", onKey, true);
          window.removeEventListener("resize", onScroll);
          window.removeEventListener("scroll", onScroll, true);
        };
      }, [open]);

      return React.createElement(
        React.Fragment,
        null,
        React.createElement("span", { ref: anchorRef, hidden: true, "data-dces-anchor": "1" }),
        canUse
          ? React.createElement("button", {
              type: "button",
              className: "dces-slot-chip",
              "data-ultra": ultra ? "1" : "0",
              title: "Effort " + label,
              onClick: function (event) {
                event.preventDefault();
                if (open) { setOpen(false); return; }
                openRef.current(event.currentTarget);
              },
            }, label)
          : null,
        open && canUse && stops.length > 0
          ? React.createElement(EffortPopover, {
              stops: stops,
              index: index,
              label: label,
              off: offState,
              ultra: ultra === true,
              playSeq: playSeq,
              draft: draft,
              pos: pos,
              error: error,
              settings: settings,
              /* 同一个会话 + 同一个模型 + 同一个档位：铺开动画只播一次 */
              animKey: (sessionId || "") + "|" + (current ? current.model : "") + "|" + index + "|" + (ultra ? "u" : ""),
              onPreview: function (next) {
                if (stops[next] && stops[next].ultra === true && next !== index) {
                  lastPlayedKey = null;
                  setPlaySeq(function (n) { return n + 1; });
                }
                setDraft(next);
              },
              onCommit: function (next, immediate) { choose(next, immediate); },
              onSettings: function (next) {
                var value = writeSettings(next === null ? DEFAULT_SETTINGS : next);
                setSettings(value);
              },
            })
          : null,
      );
    }

    /* ═══════════════════════ 插件接线 ═══════════════════════ */

    /**
     * 依赖声明 = **等待时机**，不是"我要用这些服务"。
     *
     * 曾经以为只要 slots 就够，把它降成 ["slots"]，结果界面完全不再出现：
     * apply 被提前到 UI 还没挂好时执行，此刻 ctx.slots.inject 注册到一个尚不存在的插槽，
     * 静默无效。原来的五个服务实际上起着「等会话与远程会话就绪」的闸门作用。
     *
     * 所以这里保持完整声明。副作用是：缺少其中任一服务的客户端上插件不会加载
     * （cordis 会让 fiber 停在 PENDING）—— 这是已知取舍，写进了 README 的排查章节。
     */
    var inject = ["slots", "sessions", "modelDirectories", "remote", "remote.session"];

    /** 隐藏原生「推理等级」菜单行，改由本插件的滑条接管。 */
    function hideNativeEffortMenu() {
      if (typeof MutationObserver === "undefined" || !document || !document.body) return;
      var scheduled = 0;
      function scan() {
        var buttons = document.querySelectorAll("button:not([data-dces-native-effort])");
        for (var i = 0; i < buttons.length; i += 1) {
          var btn = buttons[i];
          var label = btn.querySelector("span");
          if (!label) continue;
          var text = (label.textContent || "").trim();
          if (text === "推理等级" || /^reasoning effort$/i.test(text)) {
            btn.setAttribute("data-dces-native-effort", "1");
          }
        }
      }
      /* 模型菜单只剩「模型」一行时，直接点进去打开模型列表 */
      function openModelList() {
        var buttons = document.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i += 1) {
          var btn = buttons[i];
          var label = btn.querySelector("span");
          if (!label || (label.textContent || "").trim() !== "模型") continue;
          var surface = btn.parentElement;
          if (!surface || surface.getAttribute("data-dces-auto-model") === "1") continue;
          if (surface.querySelectorAll("button").length > 2) continue;
          surface.setAttribute("data-dces-auto-model", "1");
          try {
            /* 只压住两帧（约 32ms）：等模型列表渲染完立刻恢复，
               不再固定等 100ms —— 否则点下去会先空一截再出现。 */
            surface.style.opacity = "0";
            btn.click();
            var restore = function () { if (surface) surface.style.opacity = ""; };
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(function () { requestAnimationFrame(restore); });
            } else {
              setTimeout(restore, 32);
            }
          } catch (error) {
            surface.style.opacity = "";
          }
        }
      }
      function schedule() {
        if (scheduled) return;
        scheduled = requestAnimationFrame(function () { scheduled = 0; scan(); });
      }
      scan();
      try {
        /* openModelList 同步跑（微任务里点掉），避免先闪一下单行菜单 */
        var observer = new MutationObserver(function () { openModelList(); schedule(); });
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (error) { /* 观察失败不影响主功能 */ }
    }

    function apply(ctx) {
      /* 宿主没给 slots 就没法挂任何东西——但只提示、不提前 return：
         任何"提前退出"都可能让原本能工作的环境变成完全不加载。 */
      if (!ctx || !ctx.slots) showFailureToast("宿主没有提供 slots 服务");
      if (DEBUG) {
        try {
          console.info("[claude-effort-slider] 诊断", {
            packageId: PACKAGE_ID,
            slot: SLOT_NAME,
            entryId: ENTRY_ID,
            hasSlots: true,
            hasModelDirectories: !!(ctx.modelDirectories && ctx.modelDirectories.directoryFor),
            href: typeof location !== "undefined" ? location.href : "",
          });
        } catch (error) { /* ignore */ }
      }
      installStyles();
      syncSurfaceAttr();
      hideNativeEffortMenu();
      try {
        if (typeof MutationObserver !== "undefined" && document.body) {
          var surfaceObserver = new MutationObserver(function () { syncSurfaceAttr(); });
          surfaceObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-ds-dark-theme"] });
          surfaceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-dsh-harness-official-theme"] });
        }
      } catch (error) {
        /* 主题监听失败只影响配色 */
      }
      try {
        ctx.slots.inject(SLOT_NAME, function () {
          return ctx.slots.register(
            {
              name: SLOT_NAME,
              id: ENTRY_ID,
              order: ENTRY_ORDER,
              label: function () { return "Claude effort"; },
              inject: function (sessionId) { return { sessionId: sessionId }; },
            },
            function SlotComponent(props) {
              return React.createElement(EffortSeat, Object.assign({}, props, { __ctx: ctx }));
            },
          );
        });
      } catch (error) {
        try { console.error("[claude-effort-slider] 插槽注册失败，控件不会出现：", error); } catch (inner) { /* ignore */ }
        showFailureToast("插槽 " + SLOT_NAME + " 注册失败");
      }
    }

    installStyles();

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = {
      STOPS: STOPS,
      STYLE_MARKER: STYLE_MARKER,
      SLOT_NAME: SLOT_NAME,
      ENTRY_ID: ENTRY_ID,
      TRACK_H: TRACK_H,
      TRACK_W: TRACK_W,
      KNOB_W: KNOB_W,
      KNOB_H: KNOB_H,
      POPOVER_W: POPOVER_W,
      clamp01: clamp01,
      pctFromIndex: pctFromIndex,
      indexFromPct: indexFromPct,
      xForPct: xForPct,
      pctFromX: pctFromX,
      modelOf: modelOf,
      levelsOf: levelsOf,
      effectiveEffortId: effectiveEffortId,
      resolveStops: resolveStops,
      indexForEffort: indexForEffort,
      preferredIndex: preferredIndex,
      hash01: hash01,
      ditherAlphaAt: ditherAlphaAt,
      paintDither: paintDither,
      normalizeSettings: normalizeSettings,
      DEFAULT_SETTINGS: DEFAULT_SETTINGS,
      findEffortSpan: findEffortSpan,
    };

    return module.exports;
  },
});
