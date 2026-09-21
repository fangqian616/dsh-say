---
name: voice-setup
description: '当需要安装、启用或排查语音插件与声线时使用 —— 插件与仓库都叫 dsh-say。触发场景：装上这个语音插件 / 为什么没声音 / 启用语音插件 / 配置语音；以及装声线：把试听音频装上（包名 sample）/ 用这个包装声线 / 加载这个声线 / 从 zip 装声线。也用于察觉到这个会话里没有 tts_speak 工具时。Install, enable, or troubleshoot the dsh-say plugin; also install a voice pack from a downloaded archive.'
---

# 安装与启用 dsh-say / Install and enable dsh-say

> 注意：npm 上另有一个**别人的** `dsh-voice` 包（也是语音插件）。**本插件是 `dsh-say`，不要装错。**

把插件从"仓库里的代码"变成"这个会话里能用的工具"。只有一条命令要跑，外加一个**无法在会话内完成的步骤** —— 先说清楚，免得你卡在那儿。
Turn the plugin from code in a repository into tools in this session. There is exactly one command, plus one step that cannot be done from inside a session — say so up front instead of getting stuck on it.

## 先判断当前处在哪一步 / Find out which step you are on

```
tts_speak 在工具列表里？ / is tts_speak in your tool list?
├─ 是 yes → 已经装好了，跳到验证 / already enabled, skip to verification
└─ 否 no  → 继续往下安装 / continue and install
```

## 两步，以及为什么第二步必须由人做 / Two steps, and why the second needs a human

| 步骤 / Step | 在哪做 / Where | 谁做 / Who |
|---|---|---|
| ① `dsh plugin add` 装进 profile | 会话内 / in session | **你 / you** |
| ② **重启 profile** / restart the profile | **会话外 / outside** | **人 / the human** |
| ③ 验证工具出现 | 会话内 / in session | 你 / you |

**为什么②不能自动化 / Why ② cannot be automated**：这一步正是让插件存在的那一步。**你在会话内无法重启你自己所在的会话** —— 插件得先被挂载，你才会有 `tts_speak`。这是先有鸡还是先有蛋。
That step is the one that makes the plugin exist. You cannot restart the session you are running in: the plugin has to be mounted before you have `tts_speak`. It is a chicken-and-egg, and there is no clever way around it.

## 操作

### 1. 确认目标 profile

默认 `web`。不确定就先问，或列一下 `~/.dsh/profiles/`。用户可能在用别的（`tui`、`paperlab` ……）。

### 2. 装（一条命令）

```sh
dsh plugin --profile web add dsh-say
```

**就这一步。** dsh-say 声明了 `dsh.bundle`（`package.json` 里的 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`），所以 `dsh plugin add` 会自动：

- 把包装进 profile 的 `node_modules`
- 把它列进 profile `package.json` 的 `dsh.profile.bundles`
- 启动时套用包内自带的 `cordis.patch.yml`，插入 `id: say` 那一行

> [!IMPORTANT]
> **装的是 `dsh-say`。** npm 上另有一个**别人的** `dsh-voice`（也是语音插件，同样是 dsh bundle）—— 装它不会报错，但用户会得到完全不同的东西。包名不要写错。

**不要手改 profile 里的任何文件。** 尤其是不要手工往 `cordis.patch.yml` 追加行 —— 那是旧办法，现在由包自己的组合层负责，手写反而会和 `dsh plugin list` / 升级路径不一致。

如果从 git 装（还没发布到 npm 时）：

```sh
dsh plugin --profile web add github:fangqian616/dsh-say
```

git 来源靠 `prepare` 脚本构建，pnpm 默认拦着 —— `dsh plugin` 会直接打印出要加的那个键，把它加到 profile 目录的 `pnpm-workspace.yaml` 里的 `allowBuilds` 下面，然后重跑。这是 pnpm 的安全默认值，不是插件的问题，讲清楚即可。

**从本地 checkout 装**（用户在改这个仓库时）：用绝对路径，例如
`dsh plugin --profile web add "file:E:\path\to\dsh-say"`。不要用相对路径 `.` —— pnpm 的工作目录是 profile 目录，`.` 会指到 profile 自己。

### 3. 让用户重启（这一步你要说清楚）

明确告诉用户：

> 插件已装进 profile。**需要重启这个 profile 才会生效** —— 重启会中断当前会话，所以请你挑个时间点自己重启。

不要说"装好了"。**没重启之前，工具不会出现。**

### 4. 验证

重启后让用户回来说一声，或者你重新检查工具列表：

```
tts_speak 在列表里 → 跑 tts_engines 看后端状态
```

`tts_engines` 会报每个后端是否可用、以及确切原因。

## 5. 装声线本身（用户下载了那个 1.34 GB 的包）

**这是另一件事，别和装插件混起来。**

- **装插件** = 让会话里有 `tts_speak` 工具（上面 1-4 步）
- **装声线** = 让工具能发出**某个角色**的声音，素材在 Releases 那个包里

用户说"把试听音频装上""装那个 sample 包""用这个包装声线""加载这个声线"时，就是这个。**用户不该自己敲命令** —— 他下载了 zip，剩下的你来做：

```sh
node scripts/install-voice.mjs
```

**不用传路径** —— 脚本会去 Downloads、当前目录找那个包。用户说的是别的包或别的位置时才加 `--from "<路径>"`。

它会：解压 → 在包里找到 4 个 base 模型和声线权重 → 找用户的 GPT-SoVITS → base 模型铺进 `GPT_SoVITS/pretrained_models/`、声线权重铺进 `GPT_weights_v2ProPlus/` 和 `SoVITS_weights_v2ProPlus/` → 登记声线包。

**已存在的文件会跳过**，不会覆盖用户调好的环境，所以重跑是安全的。

**找不到 GPT-SoVITS 时加 `--engine "<路径>"`。**

### 用户没有 GPT-SoVITS 时：两条路，让他选

**不要替他默认选一条。** 两条路的代价对两种人完全相反，先跑 `tts_engines` 看现状，然后如实说：

| | ONNX 后端 | 官方整合包 |
|:--|:--|:--|
| 下载 | 约 1.1 GB | 6.4 GB |
| 报告长度一句话（生成 12 秒音频） | 8.9s | **4.7s** |
| 语速调节 | **不支持** | 支持 |
| Python | 要（脚本自己建环境） | 整合包自带 |

**ONNX 那条（推荐给"不想下 6.4 GB"的人）：**

```sh
node scripts/install-onnx.mjs          # 装引擎（约 800 MB）
node scripts/install-onnx.mjs --voice  # 再装声线（290.8 MB，去 Downloads 找那个包）
```

**声线是另一个包**：`sample-onnx-v2ProPlus.zip`（290.8 MB），里面是**已经转好的 ONNX 模型** —— 不需要 PyTorch、不需要引擎、不需要任何 base 模型，Genie 自带 hubert 和 BERT。用户下载到 Downloads 之后，`--voice` 会自己找到它；在别处就用 `--from "<zip路径>"`。

**别让用户去下那个 1.34 GB 的包。** 那份是给 GPT-SoVITS 后端的，含 4 个 base 模型；ONNX 路线用不上，白下 1 GB。

引擎那条命令会建受管 venv（Python 3.9-3.13）、装 genie-tts、下 Genie 运行时资源。三件它替你处理掉的坑，**失败时不要去让用户装 Visual Studio**：

1. `jieba_fast` 是 C 扩展源码包、任何平台都没有 wheel —— 脚本装一个纯 Python 垫片代替
2. `import genie_tts` 在导入时就检查运行时数据，缺了会阻塞或抛异常 —— 所以数据必须先下
3. 它会往 stdout 打 emoji 警告，GBK 控制台下直接崩 —— 协议因此把 stdout 让给 stderr

**几条必须如实转述的事（都有实测依据，不要凭印象说）：**

- **不要说 ONNX 更快。** 实测报告长度的一句话，ONNX 8.9s 而 GPT-SoVITS 4.7s。它的价值是**省将近 5.5 GB**
- **ONNX 引擎没有语速控制** —— 用户设了 `speed` 没反应是正常的，直接说明
- **GPU 是碰运气的。** onnxruntime 找不到 CUDA 运行库时会**静默回退到 CPU**，连最高 verbose 都不打一条日志。`--gpu` 可以试，装完用 `--check` **实测**；本机即使把 CUDA 库加进搜索路径仍然回退，原因未查明。**不要说"装了就是 GPU"**
- 插件会把**实际在用的 provider** 报出来 —— 转述它，不要自己判断

**官方整合包那条：**

```
https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v3lora-20250228.7z
```

解压双击 `_go-webui.bat`，不用装 Python。**给了他链接就停下 —— 6.4 GB 是他的决定，不是你的任务。**

### 用户说"我已经有 GPT-SoVITS 了"但检测不到时

**不要再劝他装任何东西。** 自动查找扫过常见位置和每个盘根目录，没找到就问路径（解压出来的那个文件夹，里面应该有 `api_v2.py`），拿到后写 `engines.gptSovits.engineRoot`，再跑 `tts_engines` 确认。

### 包里的参考音（用户问"能不能自己训"时看这里）

包里六条参考音，**只有中立那条是成对的**：

| 文件 | 有文本吗 | 能干嘛 |
|:--|:--|:--|
| `reference/reference-中立.wav` + `reference/reference-中立.txt` | **有**（25 字，与音频对应） | 试听**和**微调。可直接导入 GPT-SoVITS 训练 |
| 其余五条（开心/吃惊/生气/难过/恐惧） | **没有** | 只用来试听挑音色 |

用户问"能不能自己训练"时：**能** —— 中立那对就是可用素材，不用重新切音频、不用听写。把 `.wav` 和 `.txt` 一起丢进 GPT-SoVITS 的微调流程即可。

**其余五条不要替它编文本。** 文件名里的情绪是给人看的标签，不是它的台词；**配错文本比没有更糟**，微调会照着错的学。用户问那五条的文本时，直接说没有。

**两件必须说清的事：**

1. **前置条件是要有一个能跑的推理后端。** 那个包给的是模型，不是运行时。用户没有 GPT-SoVITS 的话，指他去上面两条路之一（**让他选**），并说明**两者不冲突**：后端管运行时，这个包管声音。
2. 装之前让用户读包里的 `NOTICE-weights.txt`。声明规则见下一节。

**装完立刻验证**：跑 `tts_voices action=list`，确认登记的是**声线权重**而不是 base 模型（`gpt=` 应含声线名，不该是 `s1v3.ckpt`；`sovits=` 不该是 `s2Gv2ProPlus.pth`）。**这一步不能省** —— 名字选错时安装会报成功，只有听的时候才发现声音不对。

## 装角色声线时：素材声明

用户要装"角色声线"时，把这句话说清楚：

> **本声音资源仅供学习交流，严禁用于商业用途，如有侵权，请联系作者，作者得知后会于24小时内删除。**

这句就写在包内 `NOTICE-weights.txt` 和仓库的 `voice/NOTICE.txt` 里，让用户读一眼。

**不要多做两件事**：不要补一句"放心用"或"我保证合规"；也不要替任何人表态权利归属。**不要给法律意见。**

## 排错

| 现象 | 原因 |
|---|---|
| `tts_speak` 重启后仍不出现 | ① 装到了别的 profile ② 重启的是另一个 profile ③ 装完没重启。先 `dsh plugin --profile web list` 确认它在层栈里 |
| `dsh plugin add` 报 pnpm 构建被拦 | git 来源的正常提示，按提示放行一次（见上） |
| profile 起不来 | `dsh plugin --profile web remove dsh-say` 移除本插件那一层，再启动 |
| `no such profile` | profile 名不对，列一下 `~/.dsh/profiles/` |
| 包装上了但 `name: dsh-say` 解析不到 | profile 的 `node_modules` 里没有它 —— 在 profile 目录重跑 `dsh plugin --profile web install` |
| 工具在但没声音 | 那是运行期问题，不是安装问题 —— 跑 `tts_engines`，或见主 README 的排错表 |

## 不要做的事

- **不要手改 profile 的 `cordis.patch.yml` 或 `cordis.yml`** —— 组合层由包自己带，手写会和安装状态脱节
- **不要声称"装好了"却没让用户重启**
- **不要为了让工具出现而重启用户的会话** —— 那是他的决定
- 不要删除 profile 目录里**不是你创建**的 `.bak` 文件。别人（或别的插件）也可能在那里放备份
