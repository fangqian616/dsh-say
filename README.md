<div align="center">

<img src="site/assets/readme-banner.png" alt="dsh-say" width="100%">

# dsh-say

**让你的 DSH 用你喜欢的声音开口说话、汇报内容！**

[![tests](https://github.com/fangqian616/dsh-say/actions/workflows/tests.yml/badge.svg)](https://github.com/fangqian616/dsh-say/actions/workflows/tests.yml)
[![license](https://img.shields.io/badge/license-MIT-0b1f3a.svg)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A520-2563eb.svg)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-46617f.svg)

[**三分钟上手**](#-三分钟上手) &nbsp;·&nbsp;
[工具](#-工具) &nbsp;·&nbsp;
[配置](#-配置) &nbsp;·&nbsp;
[排错](#-排错) &nbsp;·&nbsp;
[English](#english)

</div>

---

## ⚡ 三分钟上手

> **不需要下载任何东西。** 默认走你操作系统自带的语音 —— 不用 Python、不用显卡、不用账号。

### 1 · 装插件

```sh
npx dsh-say
```

**就这一条，不用参数。** 它默认装进 `web` profile；用别的 profile 加 `--profile <名字>`，想看它要执行什么加 `--print`。

等价的手写命令（`npx` 那条就是替你跑这个）：

```sh
dsh plugin --profile web add dsh-say
```

**然后重启 profile** —— 这一步必须由你做，命令行没法替你重启你正开着的会话。`npx` 跑完会把这句再说一遍，因为它只负责装，重启不了你的会话。

装完就结束。这条命令会把包装好、登记进 profile、并自动应用本包自带的组合层，`tts_*` 工具在重启后出现。

<details>
<summary><b>从源码装 / 用 git 地址（git 来源首次需要放行构建）</b></summary>

<br>

```sh
git clone https://github.com/fangqian616/dsh-say
dsh plugin --profile web add "file:E:/path/to/dsh-say"    # 或用 git 地址：
dsh plugin --profile web add github:fangqian616/dsh-say
```

git 来源的插件靠 `prepare` 脚本构建，pnpm 默认拦着。`dsh plugin` 会直接打印出要放行的那个键 —— 把它加到 profile 目录的 `pnpm-workspace.yaml` 的 `allowBuilds` 下，再重跑一次即可。

本地 `file:` 路径要用**绝对路径**：pnpm 的工作目录是 profile 目录，相对路径 `.` 会指到 profile 自己。

</details>

<details>
<summary><b>它在 profile 里动什么</b></summary>

<br>

profile 根目录的 `cordis.yml` 是空的，它自己写着不要改它。真正的用户层是 `cordis.patch.yml`，**但这里也不用你手写** —— 本包声明了：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

`dsh plugin add` 识别到这个声明后，会把它列进 profile 的 `dsh.profile.bundles` 层栈，并在启动时套用包内那一行：

```yaml
- insert:
    - id: say
      name: dsh-say
```

这是 dsh 插件的标准打包方式，所以升级、卸载、`dsh plugin list` 都能正常跟踪。

</details>

> 如果智能体已经能读到仓库，直接说一句 **"装上这个语音插件"** 就行。它会用 `voice-setup` skill 走完这一步，并且在没重启之前不会谎称装好了。

### 2 · 让它说话

对智能体说：

> 把"你好，我现在会说话了"念出来

它会调用 `tts_speak`，声音从音响里出来。**安装到此结束。**

### 3 · 确认后端状态

> 跑一下 `tts_engines`

```
selected: builtin (configured: auto)
built-in: available, 3 voice(s)
gpt-sovits: unavailable — no GPT-SoVITS checkout found
voice packs: 0 in ~/.dsh/voice-packs
```

**没声音时先跑这个** —— 它会指出确切原因。

### 4 · 想要角色声线（可选）

> **先说清楚 main 和 release 的分工 —— 这是本项目唯一需要你选的地方。**
>
> | | **main（本仓库）** | **[Releases](../../releases/latest)（那个 1.34 GB 的包）** |
> |:--|:--|:--|
> | 是什么 | **插件本体**：调用 TTS、压缩汇报、人设、声线注册 | **推理素材**：4 个 base 模型 + 声线权重 + 可训练参考音 |
> | 声音从哪来 | **你系统自带的语音**（SAPI） | 声线包里的角色声线（GPT-SoVITS） |
> | 下载量 | **0** | **1.34 GB** |
> | 要不要 Python | **不要** | **要** —— 模型在包里，**运行时不在** |
>
> main 可以用系统语音，零下载。想用 GPT-SoVITS 角色声线，去 [Releases](../../releases/latest) 下载包，继续往下看。

#### 包里整合了什么、没整合什么

**整合的是「模型」，不是「程序」。** 这两件事经常被当成一件，所以写清楚：

| | 在包里吗 | 说明 |
|:--|:--|:--|
| 4 个 base 模型（推理必需） | ✅ 在 | chinese-roberta、chinese-hubert、s1v3、s2Gv2ProPlus，约 1.14 GB |
| 声线权重 + 参考音 | ✅ 在 | 约 316 MB |
| GPT-SoVITS 程序本身 | ❌ 不在 | 代码只有几 MB，但**没有 torch 跑不起来** |
| Python + torch 运行时 | ❌ 不在 | **约 6 GB，而且分平台** |

**为什么运行时整合不了**：Python 和 torch 加起来好几 GB，还分 Windows/Linux、分 CUDA 版本。npm 单文件上限 100 MB，Release 也不适合塞一个平台专属的运行环境。所以**你要跑它，仍然需要本机已有能跑的 GPT-SoVITS**。

包里给的东西替你省掉的是：**自己找那四个 base 模型、自己裁参考音、自己听写文本** —— 这部分最容易装错（模型版本对不上、参考音不规范），现在不用你操心。

> 想彻底不要 GPT-SoVITS？那需要换一条**推理路径**（把模型转 ONNX，用小体积运行时，就不需要 Python/torch 了）。那是另一个工程，不是文档改动 —— 想做的话说一声。

#### 怎么装

把上面那个 zip 下载好，对你的 AI 说一句：

> 把试听音频装上

它自己会去 Downloads 找到那个包、解压、把四个 base 模型铺进 `GPT_SoVITS/pretrained_models/`、把声线权重铺进 `GPT_weights_v2ProPlus/` 和 `SoVITS_weights_v2ProPlus/`，然后登记声线包。**已经存在的文件会跳过**，不会覆盖你调好的环境。

装完直接说「用XX声线念一下这段」就能听到。



<details>
<summary><b>想自己动手 / AI 没有自动做</b></summary>

<br>

一条命令，**不用传路径** —— 它会去 Downloads、当前目录找这个包：

```sh
node scripts/install-voice.mjs
```

要指定别的包或别的 GPT-SoVITS：

```sh
node scripts/install-voice.mjs --from "D:/downloads/某个.zip" --engine "D:/GPT-SoVITS"
```

</details>

> [!IMPORTANT]
> **前置条件：本机要有一个能跑的 GPT-SoVITS 检出加 Python 环境。**
> [Releases](../../releases/latest) 那个包给的是**模型**，不是**运行时** —— Python 和 torch 那几 GB 装不进 Release，也不该装。
> 还没有的话，官方 Windows 整合包解压双击即可（[下载](https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v3lora-20250228.7z)，6.4 GB）。
> **两者不冲突**：整合包负责运行时，Releases 那个包负责让它用试听音频的声音，而且比整合包自带的那套小得多。

装之前先读 [`voice/NOTICE.txt`](voice/NOTICE.txt)：**本声音资源仅供学习交流，严禁用于商业用途，如有侵权，请联系作者，作者得知后会于24小时内删除。**

---

## 🛠 工具

| 工具 | 作用 |
|:--|:--|
| `tts_speak` | 短句直接念 |
| **`tts_report`** | **长汇报：先压缩再念**，避免把整篇念完 |
| `tts_engines` | 诊断后端 + 返回当前人设 |
| `tts_voices` | 列出或登记声线包 |
| `tts_config` | 读改设置，不用碰配置文件 |

### 为什么汇报要先压缩

中文语音实测约 **5 字/秒** —— 一份 500 字的汇报整篇念完要 **100 秒**，比读它还慢，用户会直接关掉声音。

`tts_report` 会先把长报告压成短稿再朗读，并返回它**实际念出来的文本**，方便确认没漏关键信息：

| | 字数 | 约合时长 |
|:--|--:|--:|
| 原文 | 500 | 100 秒 |
| 朗读 | 120 | 24 秒 |

压缩是**本地句序排序**，零额外模型调用。要更多细节就调大 `budget`。

---

## ⚙️ 配置

### 需要你配什么（大多数情况下是「什么都不用」）

| 项 | 默认 | 什么时候要动 |
|:--|:--|:--|
| **GPT-SoVITS 目录** | **自动找** | 找不到时（见下） |
| 声线包目录 | `~/.dsh/voice-packs` | 一般不动 |
| 系统语音（默认引擎） | 用系统自带的 | 不用配 |
| Python 环境 | 引擎目录里的 / conda / PATH 上的 | 引擎能用就不用管 |
| profile | 你装插件时指定的那个（`web` 等） | 用别的 profile 时 |
| 环境变量 | **一个都不需要** | — |

**环境变量全都不必需。** `DSH_VOICE_ENGINE_ROOT`、`DSH_VOICE_VOICES_DIR`、`DSH_VOICE_CONFIG` 都只是**覆盖项**，设了会优先于配置文件。下面这些走配置文件就够。

### GPT-SoVITS 目录是怎么找到的

**自动搜索，不需要你填。** 顺序是：

1. 配置里的 `engines.gptSovits.engineRoot`（你手动指定时）
2. 环境变量 `DSH_VOICE_ENGINE_ROOT`（一般不用）
3. `~/GPT-SoVITS`、`~/GPT-SoVITS-main`、`~/gpt-sovits`
4. **每个盘符根目录下名字像 `GPT-SoVITS…` 的文件夹**（所以解压到 `E:\` 或 `F:\` 也能找到）
5. 已经跑起来的 API（配了 `serverUrl` 时）

第 4 条是关键：官方整合包是个 7z，**大家通常解压到空间大的盘根目录**，不是 `C:\`。以前写死 `C:\`/`D:\`，引擎明明在那儿却报"找不到"。

**真的找不到时**（引擎在很深的子目录里之类），跟智能体说一句就行：

> GPT-SoVITS 在 `E:\tools\GPT-SoVITS-main`，帮我配上

它会用 `tts_config` 写进 `engines.gptSovits.engineRoot`。**不用你手改文件。**

### 设置文件

**你不用手改配置文件。** 插件自己维护一份设置，存在你家目录：

```
~/.dsh/voice/config.json
```

首次加载时它会问你三个问题（声线、人设、要不要自动播报），答案直接写进去。之后想改，**跟智能体说就行**：

> 把语速调到 1.2
> 默认声线换成 XX
> 看看现在的配置

<details>
<summary><b>可用的键</b></summary>

<br>

| 键 | 作用 |
|:--|:--|
| `engine` | `auto` \| `builtin` \| `gpt-sovits` |
| `defaultVoice` / `defaultVoiceBuiltin` | 默认声线包 / 默认系统语音 |
| `speed` | 语速 0.5–2.0 |
| `textLang` | 朗读文本的语言 |
| `reportBudget` | 汇报保留字数 |
| `keepAudio` | 是否保留 wav |
| `engines.gptSovits.engineRoot` | GPT-SoVITS 目录 |
| `engines.gptSovits.serverUrl` | 或指向已运行的 API |
| `engines.gptSovits.python` | 指定用哪个 python |
| `engines.gptSovits.version` | 模型版本（`v2ProPlus` 等） |

**优先级**：用户文件 > 组合里的 `config` > 内置默认。部署方仍可在组合里固定值，但**用户自己设的赢**。

</details>

---

## 🎚 两种后端

| | 系统语音（默认） | GPT-SoVITS（可选） |
|:--|:--|:--|
| 安装成本 | **零** | 约 2 GB 起 |
| 音质 | 清晰但机械 | 角色声线、零样本克隆 |
| 英文 | 原生分语言 | 声明语言即可 |
| 依赖 | Windows SAPI| 本地检出或远端 API |

`engine: auto` 会在你登记声线包之后**自动切到 GPT-SoVITS**，不用改配置。

---

## 🔧 排错

<details>
<summary><b>常见问题</b></summary>

<br>

| 现象 | 原因 |
|:--|:--|
| 没声音但 `played: true` | 输出设备选错或静音 |
| `System.Speech is unavailable` | 系统没装 SAPI 语音，或 PowerShell 被策略拦截 |
| `no GPT-SoVITS checkout found` | 设 `engines.gptSovits.engineRoot` |
| `voice pack ... is incomplete` | 声线包缺 `ref.wav`、`ref.txt` 或权重 |
| GPT-SoVITS 太慢 | 把 `sampleSteps` 从 32 降到 16 |

先跑 `tts_engines` —— 它会给出后端不可用的确切原因。

</details>

<details>
<summary><b>环境要求</b></summary>

<br>

- **内置引擎**：Windows（SAPI）。目前仅此平台；macOS / Linux 后端欢迎 PR
- **GPT-SoVITS 引擎**：Windows 或 Linux，需一个带 Python 环境的检出。显卡可选
- Node 20+

</details>

---

## 📦 开发

```sh
git clone https://github.com/fangqian616/dsh-say && cd dsh-say
npm test              # 7 个测试，不出声
npm run test:audible  # 真实播放检查
```

无构建步骤，纯 ESM JavaScript。改代码必须让 `npm test` 通过 —— 详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

**仓库不含任何模型权重、声音数据或音频。** 参考音和声线定义在仓库里，权重单独取（单个文件 148 MB，超过 GitHub 的 100 MB 上限）。

---

<a id="english"></a>

## English

**Give your DSH agent a voice — speak and report in one you like.**

The default backend is whatever speech voices your operating system already has, so step 1 and 2 need no download: no Python, no GPU, no account.

```sh
dsh plugin --profile web add dsh-say
```

Restart the profile, then ask the agent to *"say hello out loud"*. `npx dsh-say` does the same thing with no arguments and then repeats the restart step, because installing is all it can do — it cannot restart your session.

| Tool | Purpose |
|:--|:--|
| `tts_speak` | Speak a short line |
| `tts_report` | **Compress a long report, then speak it** |
| `tts_engines` | Diagnose backends, return the active persona |
| `tts_voices` | List or register voice packs |
| `tts_config` | Read and change settings without editing files |

**Why reports are compressed:** Chinese speech measures about 5 characters per second, so a 500-character report read in full takes 100 seconds — slower than reading it.

**Configuration lives in `~/.dsh/voice/config.json`**, written by first-run onboarding and editable through `tts_config`. Precedence is user file > composition > default.

**Engines:** the built-in one drives SAPI on Windows and needs no external media program; GPT-SoVITS is optional and switches in automatically once a voice pack exists.

### The character voice (optional)

Everything above works with the voices your system already has, at zero download. A
character voice needs the bundle from
**[Releases](https://github.com/fangqian616/dsh-say/releases/latest)** — **1.34 GB**,
carrying the `sample` voice plus the four base models inference needs. (The
official GPT-SoVITS package is 6.4 GB because it also carries training code, ASR,
vocal separation and a pretrained weight for every model version. None of that is
needed to talk.)

**No commands.** Download the bundle, then tell your agent:

> install the sample audio

It finds the archive in Downloads, unpacks it, places the base models into
`GPT_SoVITS/pretrained_models/` and the voice weights into `GPT_weights_v2ProPlus/`
and `SoVITS_weights_v2ProPlus/`, then registers the pack. Files that already exist
are skipped, so your tuned engine is never overwritten. Then ask it to *"read this
out loud in the sample voice"*.

**What the bundle integrates, and what it does not.** It carries the **models**, not
the **program**. The four base models and the voice weights are what is easy to get
wrong — mismatched model versions, reference clips that are not cut to spec — so those
ship in the bundle. GPT-SoVITS itself is a Python program, and Python plus torch is
several GB and platform-specific: it cannot go in npm (100 MB per file) or sensibly in
a Release. **So you still need a working GPT-SoVITS on the machine.** Without one, the
official Windows package unzips and runs as-is
([download](https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v3lora-20250228.7z),
6.4 GB); the two do not conflict — the package supplies the runtime, the bundle
supplies the models.

> Removing that requirement entirely means a different inference path — the models
> converted to ONNX with a small runtime, no Python or torch. That is a real project,
> not a documentation change.

**The six reference clips** are samples for picking a tone, and one of them is also
trainable material:

| | | |
|:--|:--|:--|
| `reference/中立.wav` + `reference/中立.txt` | audio **with** its transcript | audition it, and import the pair to fine-tune |
| the other five (开心/吃惊/生气/难过/恐惧) | audio only, **no transcript** | audition them to pick a tone |

A wrong transcript is worse than a missing one, so none is invented for the five:
the emotion in the filename is a label for the listener, not the line being spoken.

Read [`voice/NOTICE.txt`](voice/NOTICE.txt) before installing: **this voice resource is for learning and exchange only; commercial use is strictly prohibited; if it infringes any right, contact the author and it will be removed within 24 hours.**

---

<div align="center">

**MIT** · 不附带任何模型权重、声音数据或音频

<sub>代码 MIT · 角色、声音与参考音的权利归其所有者 · Code is MIT; character, voice, and reference-audio rights belong to their owners</sub>

</div>
