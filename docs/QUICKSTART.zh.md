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

## 4. 项目自带的测试声线（5 分钟）

想听角色声线而不是系统语音？**本仓库自带一条可以直接装的**：`silver-wolf`，参考音也一并附带。只缺模型权重 —— 它有几百 MB，必须单独取。

```sh
# 1. 取权重（或者你自己把权重拷进 voice/）
node scripts/fetch-voice.mjs --from "D:/下载/权重.zip"

# 2. 拷进 GPT-SoVITS 并登记声线
node scripts/install-voice.mjs
```

如果 GPT-SoVITS 不在脚本默认找的位置，指定一下：

```sh
node scripts/install-voice.mjs --engine "D:/GPT-SoVITS" --weights "D:/GPT-SoVITS"
```

然后对智能体说：

> 用 silver-wolf 这条声线念一句"设置完成，这条声线可以用"

**用之前请先读 [../voice/LICENSE.txt](../voice/LICENSE.txt)**：学习与研究用途，禁止商用，最终版权归米哈游所有。如果你需要一条能自由分发的声线，请改用许可宽松的数据集 —— 见 [VOICE-LICENSING.zh.md](VOICE-LICENSING.zh.md)。

## 5. 可选：你自己的声线（后续）

想要一条不在本仓库里的声线，就自己带。你需要一个 GPT-SoVITS 检出，以及**你有权使用的声音** —— 说明见 [VOICES.md](VOICES.md)。

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
