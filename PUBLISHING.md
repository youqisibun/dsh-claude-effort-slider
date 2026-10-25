# DSH 插件发布指南（零基础版）

> 以本仓库 `dsh-claude-effort-slider` 为例，从「本机能跑」走到「别人一条命令能装、精选库能搜到」。
> 目标读者：第一次发布 DSH 插件的人。每一步都写清楚**为什么做**和**怎么检查做对了**。

---

## 0. 先理解：发布其实是四件事

| 阶段 | 你要产出什么 | 谁来用 | 做错的后果 |
|---|---|---|---|
| ① 仓库合格 | 一个能被 `dsh plugin add` 装上的 GitHub 仓库 | 所有用户 | 装不上，后面全白费 |
| ② GitHub 发布 | 仓库 + tag + Release（可选 tgz） | 用户 / 精选库 | 无法回滚、无法引用版本 |
| ③ 精选库收录 | 一个 YAML 条目 PR | 逛市场的人 | 搜不到你的插件 |
| ④ npm（可选） | npm 包 | 市场显示下载量 | 不影响收录，只影响曝光数据 |

**最关键的一句话**：精选库只收「真的能装、描述属实」的插件。它不评审代码质量，但会核对你的描述和代码是否一致。

---

## 1. 插件目录结构：哪些必须有

一个能发布的最小结构（本仓库就是）：

```
dsh-claude-effort-slider/
├─ package.json          # 必须。清单，dsh.bundle 是收录硬门槛
├─ cordis.patch.yml      # 必须。把包挂进 cordis 插件树
├─ lib/
│  ├─ index.js           # 宿主半边：可以没有业务逻辑，但必须存在且 apply() 不抛错
│  └─ client.js          # 客户端半边：有界面才需要（DSH 客户端 bundle）
├─ README.md             # 必须。安装命令、用法、截图、兼容性
├─ LICENSE               # 必须。没有许可证，别人不能合法使用
├─ screenshots.json      # 可选。市场详情页截图清单（1–8 张）
├─ preview/              # 可选。截图素材
├─ test/                 # 可选，强烈建议。至少有一个能跑的离线测试
└─ install.cmd/.ps1      # 可选。给 Windows 用户的一键安装脚本
```

### 每个文件干什么、少了会怎样

| 文件 | 作用 | 少了会怎样 |
|---|---|---|
| `package.json` | 包的身份、入口、`dsh` 清单 | 装不上；或装上但 DSH 不认 |
| `cordis.patch.yml` | 告诉 DSH「把这个包插进插件树」 | `dsh.bundle` 指向空文件，安装后无任何效果 |
| `lib/index.js` | 宿主侧入口（`apply(ctx)`） | 加载失败，启动审计报 `Failed to load plugins` |
| `lib/client.js` | 浏览器侧 UI bundle | 界面不出现（功能全在客户端时等于没装） |
| `README.md` | 用户第一次接触你的地方 | 没人知道怎么装、怎么用 |
| `LICENSE` | 授权 | 严格说别人无权使用/分发 |
| `screenshots.json` | 市场详情页的截图清单 | 详情页没有图，转化率低 |

> ⚠️ 新手最容易忽略的一条：**`lib/client.js` 不是手写的普通模块**，它是 DSH 客户端的模块 bundle（里面要有 `__ModuleLoader__.load(...)` 和 `return module.exports` 这类结构）。如果你用构建脚本产出，记得把**产物一起提交**，或者提供 Release tarball。

---

## 2. `package.json`：逐字段填写

先看本仓库的真实清单（已能正常运行）：

```json
{
  "name": "dsh-claude-effort-slider",
  "version": "0.9.2",
  "description": "Claude Code 风格的推理强度滑条（6 档 + Ultracode 像素纹理）for DeepSeek Harness",
  "license": "MIT",
  "type": "module",
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "reasoning-effort", "slider", "ui"],
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml", "install-profile.ps1", "install.cmd", "LICENSE", "test", "README.md"],
  "engines": { "node": ">=22" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 | 新手注意 |
|---|---|---|---|
| `name` | ✅ | 包名，小写 + 连字符，全局唯一 | 不要用大写、空格、中文 |
| `version` | ✅ | SemVer 版本号 | 与 git tag 必须一致 |
| `description` | ✅ | 一句话说明 | 不要写成广告词 |
| `license` | ✅ | 如 `MIT` | 仓库里要有对应 LICENSE 文件 |
| `type` | ✅ | `"module"`（DSH 生态默认 ESM） | 用 CommonJS 会加载失败 |
| `main` | ✅ | 宿主入口 | 指向 `lib/index.js` |
| `exports` | ✅ | 至少暴露 `.` 和 `./client` | 漏 `./client` 时客户端 bundle 找不到 |
| `files` | ✅ | **发布白名单**，决定 tgz 里有什么 | 漏 `cordis.patch.yml` 是最常见事故 |
| `engines.node` | 建议 | 如 `>=22` | 与 DSH 要求对齐 |
| `keywords` | 建议 | 含 `dsh`、`dsh-plugin` | 影响搜索 |
| `dsh.bundle.patch` | ✅ | 指向 `cordis.patch.yml` | **只写 `dsh.client` 会被精选库拒绝** |
| `dsh.client` | 有 UI 才要 | `platform: "web"` 等 | 无 UI 的纯宿主插件可省略 |
| `repository` | 建议/必须 | GitHub 仓库地址 | npm 关联、市场校验会用到 |
| `homepage` / `bugs` | 建议 | 仓库主页 / issues | 方便用户反馈 |
| `peerDependencies` | 视情况 | 官方 `@deepseek-ai/*` 包放这里 | 不要放 `dependencies`，否则重复安装 |

本仓库已按 GitHub 用户名 `youqisibun` 填好这四项；换账号时改这四处即可：

```json
  "repository": { "type": "git", "url": "git+https://github.com/youqisibun/dsh-claude-effort-slider.git" },
  "homepage": "https://github.com/youqisibun/dsh-claude-effort-slider",
  "bugs": { "url": "https://github.com/youqisibun/dsh-claude-effort-slider/issues" },
  "author": "<你的名字>",
```

---

## 3. `cordis.patch.yml`：三行，但不能错

```yaml
- insert:
    - id: claude-effort-slider
      name: dsh-claude-effort-slider
```

| 字段 | 含义 | 规则 |
|---|---|---|
| `id` | 插件在 cordis 树里的条目 id | 小写连字符，建议与包名同源 |
| `name` | **npm 包名** | 必须与 `package.json` 的 `name` **完全一致** |

写错的典型症状：DSH 能启动，但插件完全没出现；或者启动日志里出现 `Failed to load plugins`。

---

## 4. 版本号与依赖规范

### 4.1 SemVer 怎么选

| 你做了什么 | 版本怎么变 | 例子 |
|---|---|---|
| 只修 bug、改文案 | patch | `0.9.2 → 0.9.3` |
| 加功能、不改用法 | minor | `0.9.2 → 0.10.0` |
| 改配置格式、删功能 | major | `0.9.2 → 1.0.0` |
| 还没稳定 | 留在 `0.x` | 允许小步快跑 |

用命令一步到位（会自动改 `package.json` + commit + 打 tag）：

```bash
npm version patch     # 0.9.2 -> 0.9.3
npm version minor     # 0.9.2 -> 0.10.0
npm version major     # 0.9.2 -> 1.0.0
```

### 4.2 依赖规范

- **官方包**（`@deepseek-ai/*`）→ 放 `peerDependencies`，不要放 `dependencies`。
- **绝不**把 `node_modules` 提交进仓库。
- **绝不**在 `dependencies` 里留 `link:` / `file:` 本地路径（你本机能装，别人装不了）。
- 依赖必须指向**原作者仓库或其 npm 包**，不能指向你自己转载的副本。

### 4.3 预发布版本的坑（真实存在）

```jsonc
// ❌ 看起来覆盖 0.1.x，实际匹配不到 0.1.0-rc.6
"peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.2.0" }

// ✅ 显式写出预发布分支
"peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0" }
```

---

## 5. 打包与产物校验

### 5.1 先想清楚：你需要哪种安装方式

| 方式 | 命令 | 何时用 |
|---|---|---|
| 源码安装（推荐） | `dsh plugin --profile web add github:youqisibun/dsh-claude-effort-slider` | 仓库里有可运行的产物 |
| tarball 安装 | 指向 Release 里的 `.tgz` | 仓库无法从源码直接安装时（**此时 tarball 是必需的**） |
| npm | 发布到 npm 后按包名安装 | 可选，只影响市场显示下载量 |

### 5.2 `npm pack` 打包

```bash
# 1) 先看会打进去什么（不生成文件）
npm pack --dry-run

# 2) 真正打包
npm pack
# 产出：dsh-claude-effort-slider-0.9.2.tgz
```

**检查 `--dry-run` 的输出**：`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`LICENSE`、`README.md` 必须在列表里；`node_modules`、`.git`、临时文件不能在里面。

### 5.3 产物校验（四步，缺一不可）

```bash
# ① 看包内文件清单
tar -tzf dsh-claude-effort-slider-0.9.2.tgz

# ② 解到临时目录
mkdir -p /tmp/pkgcheck && tar -xzf dsh-claude-effort-slider-0.9.2.tgz -C /tmp/pkgcheck

# ③ 用干净目录实测安装（关键！）
dsh plugin --profile web add /tmp/pkgcheck/package

# ④ 记录校验和，写进 Release 说明
#    Windows: certutil -hashfile dsh-claude-effort-slider-0.9.2.tgz SHA256
#    macOS/Linux: shasum -a 256 dsh-claude-effort-slider-0.9.2.tgz
```

③ 通过的标准：启动 DSH 后插件真的出现、功能可用。
**不要只在你自己已装好的环境里测试**——那里有旧的 `link:` 依赖，会掩盖打包缺失。

### 5.4 打包常见事故

| 现象 | 原因 |
|---|---|
| 装上后毫无反应 | `files` 里漏了 `cordis.patch.yml` 或 `lib/client.js` |
| 启动报 `Failed to load plugins` | `lib/index.js` 里 `apply()` 同步抛错 |
| 用户 npm 安装后缺文件 | `files` 白名单写漏 |
| 包体积巨大 | 把 `preview/`、`test/`、截图都打进去了（可接受，但没必要） |
| 版本对不上 | `npm pack` 前忘了改 `version`，或 tag 与 `package.json` 不一致 |

---

## 6. GitHub 建仓、推送与 Release

### 6.1 首次建仓（本仓库已初始化并提交过，可跳过 git init / add / commit）

```bash
cd dsh-claude-effort-slider

# 已加过可跳过；.gitignore 已随仓库提供
printf "node_modules/\n*.log\n.DS_Store\nThumbs.db\n" > .gitignore

git init
git add .
git commit -m "feat: initial release v0.9.2"
git branch -M main
git remote add origin https://github.com/youqisibun/dsh-claude-effort-slider.git
git push -u origin main
```

### 6.2 仓库设置（网页上做）

1. **About** → 填一句话描述；
2. **Topics** → 必须加 `dsh-plugin`（精选库硬性要求），可再加 `dsh`、`deepseek-harness`、`ui`；
3. 确认 GitHub 识别到 LICENSE；
4. README 顶部放：一句话介绍 + 一张截图 + 安装命令 + 兼容的 DSH 版本。

### 6.3 打 tag + 发 Release

```bash
npm version 0.9.2        # 若已手动改过版本，可跳过
git push --follow-tags
```

网页操作：**Releases → Draft a new release**
- Tag：`v0.9.2`（与 `package.json` 的 `0.9.2` 对应）
- Title：`v0.9.2 — 一句话说明`
- 说明里写：变更点、安装命令、sha256
- 附件：上传 `dsh-claude-effort-slider-0.9.2.tgz`（可选）

### 6.4 Release 的两个坑

1. **资产名带版本 + 用 `latest/download/`**：下次发版就 404。
   - 要么资产名不带版本：`dsh-claude-effort-slider.tgz`
   - 要么固定 tag：`releases/download/v0.9.2/dsh-claude-effort-slider-0.9.2.tgz`
2. **tag 与 `package.json` 不一致**：用户装到的版本和你以为的不一样。

---

## 7. 提交到精选插件库（awesome-dsh-plugin）

> 这就是大家说的「DSH 原生插件库 / 插件市场」：<https://awesome-dsh-plugin.com>
> 数据源仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>

### 7.1 先满足 6 个硬性条件

| # | 条件 | 怎么检查 |
|---|---|---|
| 1 | `package.json` 里有 `dsh.bundle` | `grep '"bundle"' package.json` |
| 2 | 仓库有真实可用代码（不是占位/纯 README） | 你本机能跑 |
| 3 | 仓库创建满 **1 天** | 看仓库首页创建时间 |
| 4 | 仓库加了 `dsh-plugin` topic | 仓库页 About 右侧 |
| 5 | 描述准确、无营销词 | 逐句对照代码 |
| 6 | 官方包用 `peerDependencies` | 看 `package.json` |

### 7.2 提交（网页版，零命令行）

1. 打开 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin> → **Fork**；
2. 在你自己的 fork 里：**Add file → Create new file**；
3. 文件名（路径）：

   ```
   data/plugins/youqisibun__dsh-claude-effort-slider.yml
   ```

   例：`data/plugins/yourname__dsh-claude-effort-slider.yml`

4. 内容：

   ```yaml
   url: https://github.com/youqisibun/dsh-claude-effort-slider
   name: youqisibun/dsh-claude-effort-slider
   category: ui
   description:
     en: 'A six-stop reasoning-effort slider for DeepSeek Harness: drag to switch off/low/high/max, with a pixel-texture Ultracode mode at the sixth stop.'
     zh: '给 DeepSeek Harness 的六档推理强度滑条：拖动切换 off/low/high/max，第六档 Ultracode 带像素纹理。'
   ```

5. **Commit changes** → 回到 fork 首页 → **Contribute → Open pull request**；
6. 标题写 `Add youqisibun/dsh-claude-effort-slider`，等 CI；
7. CI 失败就按提示改**同一个分支**，不用重开 PR。

### 7.3 YAML 字段规则

| 字段 | 必填 | 说明 |
|---|---|---|
| `url` | ✅ | 必须与仓库地址**完全一致** |
| `name` | ✅ | 列表里显示的链接文字，格式 `owner/repo` |
| `category` | ✅ | 见下方分类 |
| `description.en` | ✅ | 一句话，**以句号结尾** |
| `description.zh` | 可选 | 不写也可以，维护者会补 |
| `tarball` | 可选 | 源码装不上时**必需**，见 7.4 |
| `npm:` | 🚫 禁止 | 手写会被校验拒绝 |

**分类取值（23 个）**：
`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`

UI 类插件选 `ui`；主题皮肤选 `theme`（会自动进市场的主题 Tab）。

### 7.4 tarball 字段（只有需要时才写）

```yaml
tarball: https://github.com/youqisibun/dsh-claude-effort-slider/releases/latest/download/dsh-claude-effort-slider.tgz
```

规则：
- 必须 `https` + GitHub Release 托管；
- 资产名**不要带版本**（否则下次发版就 404），或者把 URL 固定到某个 tag。

### 7.5 截图（可选，强烈推荐）

在你**自己的仓库**根目录放 `screenshots.json`：

```json
["preview/two-buttons.png", "preview/light-ultracode.png"]
```

规则：1–8 张、相对路径不能跳出仓库、不要用第三方图床（会被拒）。市场会自动读取。

### 7.6 CI 会检查什么（4 项，按顺序）

| 顺序 | 检查 | 失败提示 |
|---|---|---|
| 1 | 一个 PR 最多 3 条条目 | 拆成多个 PR |
| 2 | `dsh.bundle` 是否存在 | 只声明 `dsh.client` 会失败 |
| 3 | 仓库年龄 ≥ 1 天 | 等一天再投 |
| 4 | `awesome-lint` + 站点构建 | 按报错改 YAML/描述/截图 |

### 7.7 需要提交的材料清单

- [ ] 公开 GitHub 仓库（含真实代码、LICENSE、README）
- [ ] `package.json` 里有 `dsh.bundle` + `cordis.patch.yml`
- [ ] 仓库 topic：`dsh-plugin`
- [ ] 一个 `data/plugins/owner__repo.yml`
- [ ] 英文描述（必填）+ 中文描述（可选）
- [ ] 分类
- [ ] 截图（可选，放自己仓库 + `screenshots.json`）
- [ ] tarball（仅源码装不上时需要）

---

## 8. 新手常见错误（按踩坑概率排序）

| # | 错误 | 后果 | 正确做法 |
|---|---|---|---|
| 1 | 只写 `dsh.client`，没有 `dsh.bundle` | 装不上 / 被精选库拒 | 加 `dsh.bundle.patch` + `cordis.patch.yml` |
| 2 | 描述里写「46 个工具」但代码只有 12 个 | 被打回（最伤的一条） | 数字、命令、API 名逐个对照代码 |
| 3 | YAML 描述里有 `: ` 没加引号 | CI 解析失败 | 整句用单引号包起来 |
| 4 | 仓库刚建几分钟就投稿 | CI 直接失败 | 等满 1 天 |
| 5 | 忘加 `dsh-plugin` topic | 不符合收录条件 | 仓库 About 里加 |
| 6 | 截图放第三方图床 | 被拒（隐私原因） | 图片放自己仓库，用相对路径 |
| 7 | `latest/download/` + 带版本文件名 | 发下个版本后 404 | 资产名去版本或固定 tag |
| 8 | `@deepseek-ai/*` 放 `dependencies` | 重复安装 / 版本冲突 | 放 `peerDependencies` |
| 9 | peer 范围没覆盖预发布 | 用户 `ERESOLVE` | 显式写 `>=0.1.0-rc.1 <0.2.0-0` |
| 10 | 仓库里提交了 `node_modules` / `link:` | 别人装不上 | `.gitignore` + 清理依赖 |
| 11 | PR 里顺手改了别人的条目 | 审核质疑，可能整单退回 | 只动自己那一个 yml |
| 12 | 一次 PR 提 4 个以上插件 | CI 拒绝 | 拆成多个 PR |
| 13 | 提交纯聚合包（只有依赖清单） | 不收录 | 提交有实际行为的插件 |
| 14 | 手改精选库的 README | 冲突/覆盖 | README 是生成的，只改 yml |
| 15 | Windows 脚本 `install.cmd` 行尾变 LF / 混入中文 | 用户双击报错 | 保持 ASCII + CRLF |
| 16 | tag 与 `package.json` 版本不一致 | 用户装错版本 | `npm version` 统一改 |

---

## 9. 可能被拒的原因（对照表）

| 原因 | 可挽回？ | 怎么改 |
|---|---|---|
| 没有 `dsh.bundle` | ✅ | 补 manifest + patch 文件，重投 |
| 描述夸大 / 与代码不符 | ✅ | 改那一行描述 |
| 占位、抢名、纯 README | ✅ | 提交真实代码 |
| 仓库不满 1 天 | ✅ | 等一天 |
| 纯聚合包 | ❌（按此形态） | 改投单个插件 |
| 依赖指向转载副本 | ✅ | 改为指向上游 |
| 动了无关条目 | ✅ | 只保留自己那条 |
| 一个 PR 超 3 条 | ✅ | 拆分 |
| 截图用第三方图床 | ✅ | 换 GitHub 托管 |
| 分类选偏 | ✅（不会被打回） | 维护者会直接改 |

---

## 10. 提交前自检清单

### A. 代码与清单
- [ ] `node test/...` 全部通过
- [ ] `package.json` 的 `name` / `version` / `license` 正确
- [ ] 有 `dsh.bundle.patch`，且指向存在的 `cordis.patch.yml`
- [ ] `cordis.patch.yml` 的 `name` 与包名完全一致
- [ ] 有 UI 的话 `exports` 暴露了 `./client`
- [ ] `repository` / `homepage` / `bugs` 已填
- [ ] 官方包在 `peerDependencies`
- [ ] 没有 `link:` / `file:` 依赖

### B. 打包与安装
- [ ] `npm pack --dry-run` 里有 `cordis.patch.yml`、`lib/*`、LICENSE、README
- [ ] 干净目录解包后 `dsh plugin add` 能装
- [ ] 启动 DSH 后功能真的出现
- [ ] 卸载后宿主恢复正常（没有残留 DOM/样式）

### C. GitHub
- [ ] 仓库公开、满 1 天
- [ ] 有 `dsh-plugin` topic
- [ ] tag `vX.Y.Z` 与 `package.json` 一致
- [ ] Release 说明含安装命令（+ sha256）
- [ ] README 有截图和安装命令

### D. 投稿
- [ ] 文件名 `data/plugins/<owner>__<repo>.yml`
- [ ] 只有这一个文件改动
- [ ] `url` 与仓库完全一致
- [ ] `description.en` 以句号结尾、无营销词、数字属实
- [ ] 分类选的是 `ui`（或最贴近的）
- [ ] 截图 ≤8 张、GitHub 托管

---

## 11. 本仓库可以直接照抄的命令

```bash
cd dsh-claude-effort-slider

# 1) 测试
node test/client.test.mjs

# 2) 补 .gitignore
printf "node_modules/\n*.log\n.DS_Store\nThumbs.db\n" > .gitignore

# 3) 打包自检
npm pack --dry-run
npm pack

# 4) 初始化并推送（仓库地址已填 youqisibun）
git init
git add .
git commit -m "feat: initial release v0.9.2"
git branch -M main
git remote add origin https://github.com/youqisibun/dsh-claude-effort-slider.git
git push -u origin main

# 5) 打 tag 并推
git tag v0.9.2
git push origin v0.9.2
```

然后去网页：Releases → Draft a new release → 选 `v0.9.2` → 上传 tgz → Publish。
最后按第 7 节提 PR。

---

## 12. 一句话总结

**仓库能装（`dsh.bundle` + patch + 真实产物）→ 打 tag 发 Release → 在 `data/plugins/` 放一个 4 行的 YAML 提 PR。**
精选库不看你代码写得多漂亮，只看「别人装上之后，是不是真的做到了你写的那句话」。
