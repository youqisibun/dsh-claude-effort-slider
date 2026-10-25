<div align="center">

**中文** · [English](docs/lang/README_EN.md)

<h1>dsh-claude-effort-slider</h1>

**Claude Code 风格的六档推理强度滑条，给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用。**
第六档 **Ultracode** 会把轨道变成一条向左流动的淡紫像素带。

[![License: MIT](https://img.shields.io/badge/License-MIT-2EA043.svg)](./LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-Plugin-4C9AFF.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![version](https://img.shields.io/github/package-json/v/youqisibun/dsh-claude-effort-slider?label=version&color=2EA043)](https://github.com/youqisibun/dsh-claude-effort-slider/releases)
[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-7B68EE.svg)](https://github.com/topics/dsh-plugin)

</div>

---

> [!NOTE]
> **非官方项目声明**
>
> 本项目是第三方开源插件，**与 Anthropic、DeepSeek 均无关联**，未获其授权、认可或赞助。
> 文中出现的 "Claude"、"Claude Code"、"Ultracode" 等名称，仅用于说明设计风格的来源与致敬对象，**相关商标与知识产权归各自所有者**。
> 本项目不含任何官方代码或素材，所有界面与动画均由本仓库代码实时绘制。
>
> This is an unofficial third-party plugin. It is **not affiliated with, endorsed by, or sponsored by Anthropic or DeepSeek**.
> Names such as "Claude", "Claude Code" and "Ultracode" are used only to describe the design inspiration; **all trademarks belong to their respective owners**.
> No official code or assets are included; every pixel is drawn at runtime by the code in this repository.

---

![模型按钮与独立的 Effort 胶囊](preview/two-buttons.png)

![Ultracode 纹理（深色）](preview/dark-ultracode.png)

![Ultracode 纹理（浅色）](preview/light-ultracode.png)

![从右往左铺开的动画](preview/entrance.png)

---

## 功能

- **独立胶囊**：输入框右侧多一个 Effort 胶囊，点一下开、再点一下关；模型按钮只负责选模型。
- **六档滑条**：`Low / Medium / High / Extra / Max / Ultracode`，拖动预览、松手写入。
- **Ultracode 纹理**：进入时从右往左铺开（1.6s），之后保持每行独立的左行脉冲；关闭浮层再打开**不重播**，自己重新拖到满格才重播一次。
- **深浅色自适应**：浮层与纹理跟着界面明暗自动切换——深色下是淡紫点阵，浅色下是薰衣草马赛克。
- **键盘可用**：`←/→`、`Home/End` 调档，`Esc` 关闭。
- **真实写入**：每一档都调用 DSH 的 `directory.select({ reasoningEffort })`，不是只换文字。
- **可逆**：停用/卸载后原生推理入口自动恢复，不改宿主任何文件。

---

## 安装

要求：**DSH ≥ 0.2.1-rc.2**、**Node.js ≥ 22**。

### 从 GitHub 安装（推荐）

```bash
dsh plugin --profile web add github:youqisibun/dsh-claude-effort-slider
```

装完**完全退出并重开** DSH（关窗口不够，要退出进程）。

### 装进桌面版（Electron）

`desktop` 是 Electron 独占的 profile，命令行装不了，用仓库里的脚本：

```powershell
.\install.cmd -Profile desktop
# 卸载：
.\install.cmd -Profile desktop -Uninstall
```

脚本会：备份 profile 的 `package.json` → 加一条 `link:` 依赖 → 把包名写进 `dsh.profile.bundles` → 建 `node_modules` 链接。

### 从 tarball 安装

```bash
dsh plugin --profile web add ./dsh-claude-effort-slider-0.9.2.tgz
```

---

## 用法

| 操作 | 行为 |
|---|---|
| 点胶囊 | 打开 / 关闭浮层 |
| 拖动轨道 | 实时预览，**松手才写入**（避免拖拽中反复写 session 造成锁冲突） |
| `←/→`、`Home/End` | 键盘调档 |
| 右键轨道 | 刻度显示、纹理强度、恢复默认 |
| 点浮层外 / `Esc` | 关闭 |

写入是串行的：同一时刻只允许一个 `select` 在途；遇到别的插件占着写锁会自动重试，10 秒仍失败才回滚并提示。

---

## 六个档位对应什么

DSH 的真实 `reasoning effort` 只有 **off / low / high / max** 四个值，六格是按视觉需要映射的：

| 视觉档位 | 写入 DSH | 说明 |
|---|---|---|
| Low | `off` | 关闭推理 |
| Medium | `low` | 低强度 |
| High | `high` | 高强度 |
| Extra | `high` | 视觉细分，行为同 High |
| Max | `high` | 视觉细分，行为同 High |
| **Ultracode** | `max` | 最高强度 + 像素纹理 |

> Medium / Extra / Max 中有两格与相邻档位写入同一个值，**这是 DSH 只有四档导致的，不是 bug**。Ultracode 的真实效果就是 `max`，插件不会改 prompt、不会启动多代理。

---

## Ultracode 纹理参数

- 网格：**6 行 × 60 列**，格子 4.67px
- 深色：方块占格 72%（约 3.36px）的淡紫点阵
- 浅色：方块占格 88%（缝约 12%）的薰衣草马赛克，底色是灰→紫的连续渐变
- 铺开：**1.6s**，波前从右往左退，边缘 ±2.5% 参差
- 待机：每行两列波，**相速度相同**，所以整条纹理只会向左；行与行的波长/速度/相位各自随机
- 动效：波峰经过时格子提亮、核心闪白；拖动推进时前沿逐个闪白；左端外焰随机明灭
- 底部紫晕跟着波前长出来，铺满后才覆盖整条轨道
- 拉满后刻度点自动隐藏
- 浮层与纹理跟着界面明暗自动切换，不需要手动设置

想改速度、密度、亮度，参数表见仓库里的 [`ANIMATION.md`](ANIMATION.md)。

---

## 兼容性

- 已在 **DSH 0.2.1-rc.2**（Web + 桌面）验证；其它版本可能需要重新验证。
- 依赖官方模型席的 DOM 形状。官方改版认不出时，插件会退回自己渲染的胶囊，功能不变，也不会破坏官方界面。
- 与其它改写官方推理入口的插件互不影响，可以同时安装。

---

## 常见问题

**装完没反应？**
客户端 bundle 在启动时注入，必须**完全退出 DSH 再开**。

**桌面版装不上？**
`desktop` profile 不能用 `dsh plugin` 命令装，用 `install.cmd -Profile desktop`。

**拉满后想再看一次动画？**
关掉浮层再打开不会重播（设计如此）；把滑条拖离最后一格再拖回来，会重播一次。

**卸载后原生界面没恢复？**
用 `install.cmd -Profile desktop -Uninstall` 走完整卸载，然后重启。

---

## 开发

```bash
npm test          # 38 条离线断言：六档映射 / 几何 / 纹理 / 设置 / bundle 结构
npm run pack      # 打包到 dist/
```

无构建步骤：`lib/client.js` 就是发布产物（`react` / `react-dom` 由宿主提供）。

```
lib/index.js    宿主半边：空 apply + 客户端产物静态核对
lib/client.js   客户端半边：胶囊桥、浮层、滑条、像素纹理、目录读写
cordis.patch.yml  把包挂进 cordis 插件树
```

---


## License

MIT
