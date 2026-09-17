# 三分钟上手

从零到听见你的电脑说话。第一步**完全不需要下载任何东西**。

## 1. 安装（30 秒）

```sh
dsh plugin --profile web add dsh-voice
```

然后在那个 profile 的组合文件里加一行，和其他工具行并列：

```yaml
- id: tool-voice
  name: dsh-voice
```

重启该 profile。

## 2. 听它说话（10 秒）

对智能体说：

> 把"你好，我现在会说话了"念出来

它会调用 `tts_speak`，声音从你的音响出来。**安装到此结束** —— 不需要 Python、不需要下模型、不需要显卡。

想换系统语音？先列出来：

> 用 tts_voices 看看有哪些可用声线

然后在配置里指定：

```yaml
- id: tool-voice
  name: dsh-voice
  config:
    defaultVoiceBuiltin: Microsoft Huihui Desktop
```

## 3. 确认后端状态（20 秒）

> 跑一下 tts_engines

它会明确告诉你每个后端的情况：

```
selected: builtin (configured: auto)
built-in: available, 3 voice(s)
gpt-sovits: unavailable — no GPT-SoVITS checkout found
voice packs: 0 in ~/.dsh/voice-packs
```

**没声音时先跑这个**，它会指出确切原因。

## 4. 可选：更好的嗓子（后续）

只有想要角色声线、不满足于系统语音时才做。你需要一个 GPT-SoVITS 检出，以及**你有权使用的声音** —— 说明见 [VOICES.md](VOICES.md)。

```sh
git clone https://github.com/RVC-Boss/GPT-SoVITS
# 照它的 README 装好 Python 环境并下载底模
```

把模型权重放到位，然后登记声线包：

> 登记一个叫 narrator 的声线包，参考音 C:\voices\narrator.wav，文本"这是一段参考音频。"，gpt=GPT_weights_v4/narrator-e10.ckpt，sovits=SoVITS_weights_v4/narrator_e10_s220.pth

之后 `tts_speak` **自动改用它** —— `engine: auto` 在有可用声线包时优先 GPT-SoVITS，不需要改配置。

## 首次运行容易困惑的地方

| 现象 | 含义 |
|---|---|
| 没听到声音，但 `played: true` | 输出设备选错或音量静音；音频是播出去了的 |
| `System.Speech is unavailable` | 系统没装 SAPI 语音，或 PowerShell 被策略拦截 |
| `no GPT-SoVITS checkout found` | 第 4 步之前是正常的；装在别处就设 `engines.gptSovits.engineRoot` |
| `voice pack ... is incomplete` | 声线包缺 `ref.wav`、`ref.txt` 或权重路径 |
| GPT-SoVITS 引擎太慢 | 把 `sampleSteps` 从 32 降到 16，或用显卡 |

## 文件落在哪

| 路径 | 内容 |
|---|---|
| `~/.dsh/voice-packs/` | 你的声线包。项目本身不含任何声线。 |
| 系统临时目录 `/dsh-voice/` | 辅助脚本与飞行中的音频，可随时删。 |

音频播放后即删，除非你传 `saveTo` 或设 `keepAudio: true`。合成失败时连朗读文本也会一并删除，磁盘上不留朗读内容。
