# 哪些声音可以用 / Which voices you may use

dsh-voice 不带任何声线，将来也不会带。这就把一个问题摆到每个用户面前：**我该往声线包里放什么声音？** 这一页用来源回答，不用观点回答。
dsh-voice ships no voice and never will. That puts one question in front of every user: *which voice may I put in a pack?* This page answers it with sources rather than opinions.

以下内容不构成法律意见。涉及收费或公开发布时，请自行阅读每一行里链接的原始条款再决定。
Nothing here is legal advice. When money or a public release is involved, read the primary source linked in each row and decide for yourself.

## 决定一切的三问 / The three questions that decide everything

按顺序问。任何一步答"否"，就到此为止。
Ask them in this order. A "no" at any step ends it.

**1. 音频从哪来？/ Where did the audio come from?**
录音的版权属于录制者，而声音本身可能还涉及说话人的人身权利。用某段录音训练出的模型，会继承这段录音的全部问题。
A recording is copyrighted by whoever made it, and the voice itself may be a personal right of the speaker. A model trained on a recording inherits the problems of that recording.

**2. 模型自己的许可允许你这样用吗？/ Does the model's own license allow your use?**
许多社区声线模型会附带明确条款 —— 常见的是*仅限非商用、禁止二次分发、必须署名*。这些条款对你有约束力。
Many community voice models add explicit terms — often *non-commercial only, no redistribution, credit required*. Those terms bind you.

**3. 你是要自己用，还是要分发出去？/ Will you redistribute, or just use it?**
私人使用和公开发布是两种不同的行为。允许你听，不代表允许你发布声线包 —— 而开源项目的麻烦恰恰出在"发布"上。
Private use and publishing are different acts. A license that lets you listen does not necessarily let you publish the pack, and publishing is where open-source projects get into trouble.

## 一句话版本 / The short version

| 声音来源 / Voice source | 自己用 / Private | 发布声线包 / Publish | 商用 / Commercial |
|---|---|---|---|
| 你自己的声音 / your own voice | 可以 / yes | 可以 —— 是你的 / yes, it is yours | 可以 / yes |
| 已明确同意的朋友 / a consenting colleague | 可以 / yes | 可以，保留书面同意 / yes, with written consent | 需其同意 / with consent |
| **Apache-2.0 / CC0 / CC-BY** 数据集 | 可以 / yes | 通常可以，仍需核对 / usually, check terms | 核对条款 / check terms |
| 社区角色模型（如游戏角色）/ community character model | 通常被默许 / usually tolerated | **不可以** / **no** | **不可以** / **no** |
| 商业音源（Vocaloid 等）/ commercial voicebank | 依其 EULA / per its EULA | **不可以** / **no** | **不可以** / **no** |
| 未经同意的真人 / a real person without consent | 技术上可行，伦理上不可 / possible, not ethical | **不可以** / **no** | **不可以** / **no** |

## 安全的起点 / Safe starting points

这些数据集的条款明确考虑了"训练语音模型"这件事。
These are datasets whose terms explicitly contemplate training speech models.

| 资源 / Resource | 许可 / License | 说明 / Notes |
|---|---|---|
| [AISHELL-3](https://www.openslr.org/93/) | Apache-2.0 | 85 小时、218 位普通话说话人，专为多说话人 TTS 构建。许可是宽松的，是做法演示声线最干净的选择。19 GB。/ 85 hours, 218 Mandarin speakers, built for multi-speaker TTS. The cleanest choice for a demo voice. |
| [MagicHub 开源 TTS 数据集](https://magichub.com/datasets/) | 逐数据集 / per dataset | 中文方言与标准普通话语料，许可因数据集而异。/ Chinese dialects and standard Mandarin; licenses vary. |
| [LibriTTS-R](https://www.openslr.org/141/) | CC BY 4.0 | 英文，源自 LibriVox 公有领域朗读。/ English, from public-domain LibriVox readings. |
| [LJSpeech](https://keithito.com/LJ-Speech-Dataset/) | 公有领域 / public domain | 英文单说话人，24 小时。/ English, single speaker. |
| [Common Voice](https://commonvoice.mozilla.org/) | CC0 | 多语言、众包采集，采集流程中含明确同意。/ Many languages; speaker consent is explicit in collection. |

从这些数据集做参考音：截取 3-10 秒干净片段，写下它的**逐字**文本，然后登记声线包。
To make a reference clip from one of these, take a 3-10 second clean segment, write down its **exact** transcript, and register the pack.

## 初音未来，以及角色声线 / Hatsune Miku, and character voices generally

这一条被误读得最多，所以直接引原文。Crypton Future Media 将初音未来等 Piapro 角色的**原始插画**以 [CC BY-NC 3.0](https://piapro.net/intl/en_for_creators.html) 授权，而同一页明确否定了大家通常想当成的那个解读：
This one gets misread constantly, so here is the primary source. Crypton Future Media licenses the **original illustrations** of Hatsune Miku and the other Piapro Characters under [CC BY-NC 3.0](https://piapro.net/intl/en_for_creators.html). The same page rules out the reading people usually want:

> "Those licenses only apply to the original illustrations of the characters, and any music, videos, illustrations and 3DCG related to Crypton's characters are NOT licensed under CC license unless otherwise noted."

> Q5: Can I also use music associated with Hatsune Miku under the CC BY-NC? **A5: No.** The CC BY-NC only applies to the original illustrations of the Characters.

关于声音本身 / On the voice itself:

> "For music composers using the vocal track of Hatsune Miku and/or other Crypton software on your own musical works, please refer to each software's Terms and Conditions of its End User License Agreement."

所以 / So:

- **CC BY-NC 不覆盖声音**，它覆盖的是美术作品。用它训练声音模型并不在这份授权范围内。/ **The CC BY-NC license does not cover the voice.** It covers artwork.
- **使用该音源受其 EULA 约束** —— 允许创作作品，但限制商用与再分发。/ Using the voicebank is governed by its EULA, which permits creative works but restricts commercial use and redistribution.
- **另外，这个声音来自一位真人声优**（藤田咲）。她的录音和她的声音属于她本人。/ Separately, the voice comes from a human voice actress (Saki Fujita).
- 该页面上，Crypton **没有**给出针对 AI 声音训练的概括性许可。/ Crypton offers no blanket permission for AI voice training that this page states.

### 实际意味着什么 / What this means in practice

| 你的情形 / Your situation | 结论 / Reading |
|---|---|
| 在家自己训一个、非商用 / train one for yourself, non-commercially | 社区广泛默许，但**没有官方许可确认它** —— 是你主动选的灰色地带。/ Widely tolerated, but **no official license confirms it**. |
| 把角色声线包发到 GitHub / publish a character voice pack | **不要。** 那是二次分发派生声音，模型条款几乎都禁止。/ **Don't.** It redistributes a derived voice. |
| 项目文档里拿角色当卖点 / showcase one in your docs | 避免。宣传灰色地带的项目会继承这个灰色地带。/ Avoid. |
| 商用 / commercial use | **没有许可覆盖它。** 需要角色所有方的授权。/ **No license covers this.** |

**对一个开源项目来说，答案很干净：不打包角色声线、不内嵌、不在示例里主推。** 转而引导用户去用许可明确的数据集。这也是本仓库不含任何声线的原因。
**For an open-source project the answer is clean: don't ship character voices, don't bundle them, don't feature them in examples.** That is why this repository contains no voice at all.

## dsh-voice 做了什么来配合 / What dsh-voice does to help

- **什么都不带。** `voicesDir` 在你的家目录，不在包里。/ Ships nothing; `voicesDir` lives in your home directory.
- **登记时索要许可信息。** `tts_voices action=add license="..."` 会把条款记进 `pack.json`。/ Asks for the licence at registration and records it in `pack.json`.
- **报告不完整的声线包**，而不是静默失败。/ Reports incomplete packs instead of failing silently.
- **不上传任何东西。** 合成完全本地。/ Never uploads anything; synthesis is local.

## 拿不准的时候 / If you are unsure

默认选择"不用"。用一个许可宽松的数据集声音，只是稍微不像你心里那个角色，但它不会让你的项目被下架。
Default to not using it. A permissively licensed dataset voice sounds slightly less like the character you had in mind and cannot get your project taken down.
