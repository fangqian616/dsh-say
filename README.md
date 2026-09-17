# dsh-voice

**中文** ｜ 给你的 DSH 智能体一副嗓子：把文字从你的音响念出来，汇报也能听着走。装完就能用 —— 默认走系统语音，零下载。
**English** | Give your DSH agent a voice: speak text aloud through your speakers, reports included. It works the moment you install it — the default backend is your operating system's own voices, with nothing to download.

```
你 / you：    把早安念出来 / say good morning out loud
智能体 / agent： [tts_speak] → 从音响念出来 / speaks it through your speakers
```

## 三分钟上手 / Quick start

### 1. 安装 / Install

```sh
dsh plugin --profile web add dsh-voice
```

在 profile 的组合文件里加一行 / Add the row to that profile's composition:

```yaml
- id: tool-voice
  name: dsh-voice
```

重启该 profile / Restart the profile.

### 2. 听它说话 / Hear it

对智能体说 / Ask your agent:

> 把"你好，我现在会说话了"念出来 / say "hello, I can speak now" out loud

它会调用 `tts_speak`，声音从音响出来。**安装到此结束** —— 不需要 Python、不需要下模型、不需要显卡。
It calls `tts_speak` and the words come out of your speakers. **That is the whole install** — no Python, no model download, no GPU.

### 3. 确认后端状态 / Check what is available

> 跑一下 tts_engines / run tts_engines

```
selected: builtin (configured: auto)
built-in: available, 3 voice(s)
gpt-sovits: unavailable — no GPT-SoVITS checkout found
voice packs: 0 in ~/.dsh/voice-packs
```

**没声音时先跑这个** —— 它会指出确切原因。 / **Run this first whenever nothing is audible** — it names the exact reason.

### 4. 项目自带的测试声线（可选）/ The voice that ships with the project (optional)

想要角色声线？**本仓库自带一条可以直接装的**：`silver-wolf`，参考音也一并附带，只缺模型权重（几百 MB，必须单独取）。
Want a character voice? This repository carries one ready to install — **`silver-wolf`** — with its reference clip included. Only the weights are missing, because they are hundreds of megabytes.

**一条命令，不用手动下载，也不用自己找文件夹** —— 脚本会自动取权重、自动找你的 GPT-SoVITS、自动放到位并登记。
**One command. No manual download, and nothing to place by hand** — the script fetches the weights, finds your GPT-SoVITS, installs them and registers the pack.

```sh
node scripts/install-voice.mjs
```

找不到 GPT-SoVITS 时才需要告诉它 / Only if it cannot find GPT-SoVITS:

```sh
node scripts/install-voice.mjs --engine "D:/GPT-SoVITS"
```

权重已经下好了、在别处？用 `--weights` 指过去，不用搬文件。/ Already downloaded them somewhere else? Point at that directory with `--weights`.

⚠️ **用之前读一下声明 / read the notice before using it**: 学习与研究用途，禁止商用，最终版权归米哈游所有。详见 [voice/LICENSE.txt](voice/LICENSE.txt) / Learning and research use only, non-commercial; rights to the character and voice belong to miHoYo.

想要一条能自由分发的声线，请用许可宽松的数据集 / For a voice you may redistribute freely, use a permissively licensed dataset: [docs/VOICE-LICENSING.md](docs/VOICE-LICENSING.md).

### 5. 用你自己的声线（可选）/ Bring your own voice (optional)

你需要一个 GPT-SoVITS 检出，以及**你有权使用的声音** / You need a GPT-SoVITS checkout and material **you are allowed to use**:

```sh
git clone https://github.com/RVC-Boss/GPT-SoVITS
# 照它的 README 装好 Python 环境 / follow its README to set up Python
```

然后让智能体登记 / Then ask your agent to register it:

> 登记一个叫 narrator 的声线包，参考音 C:\voices\narrator.wav，文本"这是一段参考音频。"，gpt=GPT_weights_v4/narrator-e10.ckpt，sovits=SoVITS_weights_v4/narrator_e10_s220.pth

之后 `tts_speak` 自动改用它 —— `engine: auto` 在有可用声线包时优先 GPT-SoVITS。
From then on `tts_speak` uses it automatically — `engine: auto` prefers GPT-SoVITS as soon as a healthy pack exists.

## 工具 / Tools

| 工具 / Tool | 作用 / Purpose |
|---|---|
| `tts_speak` | 短句直接念 / Speak a short line |
| `tts_report` | **长汇报：先压缩再念** / **Long report: compress, then speak** |
| `tts_engines` | 诊断后端 + 返回当前人设 / Diagnose backends, return the active persona |
| `tts_voices` | 列出或登记声线 / List or register voice packs |

汇报一律用 `tts_report`。中文语音约 14 字/秒，一份 500 字的汇报整篇念完要 35 秒以上 —— 比读它还慢。
Always use `tts_report` for a report. Chinese speech runs about 14 characters per second, so a 500-character report read in full takes over 35 seconds — slower than reading it.

合成的音频**播放后即删**，除非你传 `saveTo`。 / Audio is **deleted after playback** unless you pass `saveTo`.

## 配置 / Configuration

**你不用手改配置文件。** 插件自带一套设置，存在你自己家目录里：

**You do not edit a configuration file.** The plugin keeps its own settings in your home directory:

```
~/.dsh/voice/config.json
```

首次加载插件时，它会问你三个问题（声线、人设、要不要自动播报），答案直接写进这个文件。之后想改，**跟智能体说就行**：
On first load the plugin asks three questions — voice, persona, automatic reporting — and writes the answers there. To change anything later, **just tell the agent**:

> 把语速调到 1.2 / set the speaking rate to 1.2
> 默认声线换成 silver-wolf / use silver-wolf by default
> 看看现在的配置 / show me the current settings

它调用 `tts_config` 读写。可用键：
It uses `tts_config`. Available keys:

| 键 / Key | 作用 / Meaning |
|---|---|
| `engine` | `auto` \| `builtin` \| `gpt-sovits` |
| `defaultVoice` / `defaultVoiceBuiltin` | 默认声线 / default voice pack or OS voice |
| `speed` | 语速 0.5-2.0 / speaking rate |
| `textLang` | 朗读文本的语言 / language of the text |
| `reportBudget` | 汇报保留字数 / characters kept when reporting |
| `keepAudio` | 是否保留 wav / keep generated wav files |
| `engines.gptSovits.engineRoot` | GPT-SoVITS 目录 / path to a GPT-SoVITS checkout |
| `engines.gptSovits.serverUrl` | 或指向已运行的 API / or a running API instead |

**优先级 / Precedence**：用户文件 > 组合里的 `config` > 内置默认。组合配置仍然可用，供部署方固定某个值；但**用户自己设的赢**。
User file > the composition's `config` > built-in default. A deployment can still pin a value in the composition, but **what the user set wins**.

```yaml
# 只有部署方需要固定默认值时才写这段 / only if a deployment must pin a default
- id: tool-voice
  name: dsh-voice
  config:
    engine: builtin
```

## 环境要求 / Requirements

- **内置引擎 / built-in engine**：Windows（SAPI）。目前仅此平台 / Windows only for now.
- **GPT-SoVITS 引擎 / engine**：Windows 或 Linux，需要一个带 Python 环境的检出 / Windows or Linux, a checkout with Python. 显卡可选 / GPU optional.
- Node 20+.

## 排错 / Troubleshooting

先跑 `tts_engines` / Run `tts_engines` first.

| 现象 / Symptom | 原因 / Cause |
|---|---|
| 没声音但 `played: true` / silent but played | 输出设备选错或静音 / wrong output device or muted |
| `System.Speech is unavailable` | 系统没装 SAPI 语音，或 PowerShell 被策略拦截 / no SAPI voice, or PowerShell blocked |
| `no GPT-SoVITS checkout found` | 设 `engines.gptSovits.engineRoot` / set the engine root |
| `voice pack ... is incomplete` | 声线包缺 `ref.wav`、`ref.txt` 或权重 / the pack is missing a part |
| GPT-SoVITS 太慢 / slow | 把 `sampleSteps` 从 32 降到 16 / lower sample steps |

## 开发 / Development

```sh
git clone https://github.com/fangqian616/dsh-voice && cd dsh-voice
npm test              # 五个测试，不出声 / five checks, no audio
npm run test:audible  # 真实播放检查 / proves playback works
```

无构建步骤，纯 ESM JavaScript / No build step: plain ESM JavaScript. 改代码必须让 `npm test` 通过 / A change must keep `npm test` green: [CONTRIBUTING.md](CONTRIBUTING.md).

## 更多文档 / More

- [引擎说明与「为何不打包模型」/ Engines, and why no weights are bundled](docs/ENGINES.md)
- [声线包格式与参考音要点 / Voice pack format and a good reference clip](docs/VOICES.md)
- [哪些声音可以用 / Which voices you may use](docs/VOICE-LICENSING.md)
- [变更日志 / Changelog](CHANGELOG.md)

## 许可 / License

MIT，见 [LICENSE](LICENSE) / MIT, see [LICENSE](LICENSE)。dsh-voice 调用的第三方程序（GPT-SoVITS、FFmpeg）各自保留其许可 / Third-party programs keep their own licenses.
