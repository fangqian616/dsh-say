# dsh-voice

给你的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 智能体一副嗓子。它把文字从你的音响念出来，**装完立刻能用**，想要角色声线再往上加。

```
你：    把早安念出来
智能体： [tts_speak] → 从音响里念出来
```

## 为什么装完就能用

默认后端是**你操作系统里已有的语音**。不用下模型、不用 Python、不用显卡、不用账号。Windows 上走 SAPI，`Microsoft Huihui Desktop` 这类中文声线通常已经装好了。

想要**角色声线**或音色克隆，再单独安装 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 并登记一个声线包，dsh-voice 会自动切过去。本项目**永远不附带任何模型权重和声音数据**，原因见 [docs/ENGINES.md](docs/ENGINES.md)，哪些声音可以合法使用见 [docs/VOICE-LICENSING.zh.md](docs/VOICE-LICENSING.zh.md)。

**第一次来？ → [三分钟上手](docs/QUICKSTART.zh.md)**

## 安装

```sh
# 装进某个 profile（内部转发给该 profile 目录下的 pnpm）
dsh plugin --profile web add dsh-voice
```

然后在那个 profile 的组合文件里引用它，和其他工具行并列：

```yaml
- id: tool-voice
  name: dsh-voice
```

重启该 profile，智能体就多出三个工具。

## 工具

| 工具 | 作用 |
|---|---|
| `tts_speak` | 朗读 `text`；可选 `voice`、`engine`、`speed`、`saveTo` |
| `tts_engines` | 报告当前哪些后端可用（系统语音 / 本地 GPT-SoVITS / 远端 API）。**没声音时先跑这个** |
| `tts_voices` | `action=list` 列出声线与系统语音；`action=add` 登记声线包 |

默认情况下，合成的 wav 在播放后**立即删除**，不在磁盘留痕。需要留文件就传 `saveTo`。

## 配置

所有字段都可选，默认值即可用。

```yaml
- id: tool-voice
  name: dsh-voice
  config:
    engine: auto              # auto | builtin | gpt-sovits
    voicesDir: ~/.dsh/voice-packs
    defaultVoice: ''          # 首选声线包
    defaultVoiceBuiltin: ''   # 首选系统语音，如 Microsoft Huihui Desktop
    speed: 1                  # 0.5 - 2.0
    textLang: zh              # 朗读文本的语言
    sampleSteps: 32           # GPT-SoVITS 质量/速度权衡
    keepAudio: false          # 是否保留生成的 wav
    engines:
      gptSovits:
        engineRoot: ''        # GPT-SoVITS 目录；留空自动探测
        serverUrl: ''         # 或指向已在运行的 API（瘦客户端模式）
        python: ''
        version: v2ProPlus
        device: cuda
        isHalf: true
```

`engine: auto`（默认）在有可用声线包时优先用 GPT-SoVITS，否则用系统语音 —— 所以以后装 GPT-SoVITS **不需要改配置**。

## 添加角色声线

1. 把模型的 `.ckpt` 放进 GPT-SoVITS 目录的 `GPT_weights_<版本>/`，`.pth` 放进 `SoVITS_weights_<版本>/`。
2. 登记声线包，让智能体替你跑：

```
tts_voices action=add name=<声线名> \
  refAudio=<3-10 秒干净参考音> \
  promptText=<参考音的逐字文本> \
  gpt=GPT_weights_v4/<名>-e10.ckpt \
  sovits=SoVITS_weights_v4/<名>_e10_s220.pth
```

注意事项见 [docs/VOICES.md](docs/VOICES.md)。

## 环境要求

- **内置引擎**：Windows（SAPI）。目前仅此平台，macOS/Linux 后端欢迎 PR。
- **GPT-SoVITS 引擎**：Windows 或 Linux，需一个带 Python 环境的 GPT-SoVITS 检出。显卡可选。
- Node 20+。

## 排错

先跑 `tts_engines`，它会给出后端不可用的确切原因。

| 现象 | 原因 |
|---|---|
| `System.Speech is unavailable` | 系统没装 SAPI 语音，或 PowerShell 被策略拦截 |
| `no GPT-SoVITS checkout found` | 设置 `engines.gptSovits.engineRoot` 或环境变量 `DSH_VOICE_ENGINE_ROOT` |
| `voice pack ... is incomplete` | 声线包缺 `ref.wav`、`ref.txt` 或权重路径 |
| 合成成功但没声音 | 输出设备被静音，或选错了播放设备 |

## 开发

```sh
git clone <本仓库> && cd dsh-voice
node test/smoke.mjs   # 引擎探测 + 合成，不出声
node test/play.mjs    # 真实播放检查
```

无构建步骤：包就是纯 ESM JavaScript，唯一的运行时依赖是 harness 自带的 schema 库。

## 许可

MIT，见 [LICENSE](LICENSE)。dsh-voice 调用的第三方程序（GPT-SoVITS、FFmpeg）各自保留其许可，已在该文件中注明。你登记的任何声线模型与参考音频，其权利由你自行负责 —— 具体判断见 [docs/VOICE-LICENSING.zh.md](docs/VOICE-LICENSING.zh.md)。

## 更多文档

- [三分钟上手](docs/QUICKSTART.zh.md)
- [引擎说明与「为何不打包模型」](docs/ENGINES.md)
- [声线包格式与参考音要点](docs/VOICES.md)
- [哪些声音可以用](docs/VOICE-LICENSING.zh.md)
