# 两种后端：用你自己的 GPT-SoVITS，还是用我们的 ONNX 版

这个文档说明**为什么要有这个选择**、**什么时候问用户**、以及**选完之后各自发生什么**。

所有数字都是本机实测，方法写在最后一节。

## 为什么是"问"，不是"自动选"

两种后端对**不同的人**代价完全相反：

| | 用你自己的 GPT-SoVITS | 用 ONNX 版（Genie） |
|:--|:--|:--|
| 已经装好的人 | **下载 0** | 还要下约 800 MB |
| 没装的人 | 下 **6.4 GB**（官方整合包） | 下 **约 1.1 GB**（venv 411 MB + 资源 391 MB + 声线 320 MB） |
| 报告长度一句话（66 字，生成 12s 音频） | **4.7s** | **8.9s**（CPU） |
| 需要 Python | 要（官方整合包自带，不用自己装） | **要** |

**已经装好的人没有任何理由换** —— 他下载是 0，而且更快。
没装的人省下的将近 5.5 GB，代价是慢一倍。同一件事对不同人一赚一亏，所以不该替他决定。

## 一个必须先说清的事实

**ONNX 版不是"不要 Python"。** Genie 是 Python 包，只是用 onnxruntime 换掉 torch。
省掉的是 PyTorch + CUDA 那几 GB，不是解释器本身。

要走真的零 Python，得用 `onnxruntime-node` 在 JS 里重写整条推理管线
（已验证运行时可用，但管线移植是几周的工程）。**那是另一个项目，不在这个设计里。**

## 不能说"更快"

我最初的结论是 ONNX 更快，**那是错的** —— 它来自包含模型加载的冷态数字。
GPT-SoVITS 的 API 是常驻进程、模型只加载一次，而当时测 ONNX 时把它每次重新加载的
时间也算进去了。

热态实测（同一句话、同一声线）：

| 文本 | ONNX（CPU） | GPT-SoVITS（GPU） |
|:--|:--|:--|
| 25 字 | 3.0s | **1.9s** |
| 66 字（生成 12s 音频） | 8.9s | **4.7s** |

**GPT-SoVITS 快约 1.6-1.9 倍。**

但仍然可以说的是：**两者都远快于实时**（12 秒音频 8.9 秒生成），ONNX 慢的那些秒
对一个语音汇报来说不构成问题。所以 ONNX 卖的是**体积**，不是速度。

## 什么时候问

**只在需要问的时候问。** 加载时先检测两个引擎，再决定：

```
有可用的 GPT-SoVITS？
├─ 有 → 不打断用户，直接用它（它更快，而且下载是 0）
└─ 没有 → 有可用的 ONNX 吗？
          ├─ 有 → 也不问，直接用它
          └─ 都没有 → 首次要角色声线时问一次，四选一
```

**两个引擎任意一个可用就不问** —— 那种情况下没有真正需要用户决定的事，
问只是在打断他。现有的 onboarding 已经因为"问一些答案显而易见的问题"被改过一次。

## 注意：问题不能做成"看第一题答什么再问第二题"

`userQuestions.ask` 是**一次性批量提问**，所以后端问题作为**条件性的第 4 问进同一批**，
只在两个引擎都没有时才出现。做成第二轮会把打断次数翻倍。

## 四个选项各自发生什么

| 答案 | 写什么 | 后续 |
|:--|:--|:--|
| 用自带的 ONNX 版 | `engine = "onnx"` | todo：跑 `install-onnx.mjs` |
| 我已经有 GPT-SoVITS 了 | **不写** | todo：问路径，写 `engines.gptSovits.engineRoot` |
| 我自己装官方的 | **不写** | todo：给链接就停，**不要替他下 6.4 GB** |
| 先用系统语音 | `engine = "builtin"` | 无 todo（这是决定，不是待办） |

**"我已经有 GPT-SoVITS 了"这一支不能把 `engine` 钉成 `gpt-sovits`。**
用户说它存在、我们没找到，此时钉死会让后续每次调用硬失败；保持 `auto`，
拿到路径后再由 `auto` 选中它。

## 必须处理的一个坑：GPU 会静默回退到 CPU

**本机实测（onnxruntime 1.22.0 + 一个最小的 Add 模型）：**

```
build offers: TensorrtExecutionProvider, CUDAExecutionProvider, CPUExecutionProvider
a session gets: CPUExecutionProvider
```

而且**把日志开到最高 verbose（severity 0）也一条消息都不打**。不是"打一行警告"，
是完全没有痕迹。

所以设计要求是：**不信 `get_available_providers()`，要遍历已建好的 session 调
`get_providers()`**，把实际拿到的那个报给用户。这条已经实现并被这个案例验证过 ——
插件正确输出了 "CUDA was requested but the sessions are running on the CPU"。

### 三个关于 GPU 的实测事实

1. **`onnxruntime-gpu` 没有 1.22.1 这个版本**（CPU 包有）。GPU 包是 1.22.0 → 1.23.0。
   所以"钉住同一个版本"这条路不存在，只能装最接近的，并接受 `pip check` 报冲突。
2. **本机即使把 CUDA 12 + cuDNN 9 的 DLL 目录加进搜索路径，仍然回退到 CPU**，
   且没有任何错误输出。原因未查明。
3. 因此**不承诺 GPU**：默认装 CPU 版（正是 Genie 钉的那个版本），`--gpu` 作为
   可选项，装完**实测**它到底有没有生效并如实转述。

Doc 早先写的"要装 `nvidia-cublas-cu12` + `nvidia-cudnn-cu12`"在本机**没有解决问题**，
所以那句话降级为"可以试"，而不是"这样就修好了"。

## Genie 把 CPU 写死在源码里

`ModelManager.__init__` 里是 `self.providers = ["CPUExecutionProvider"]`，
所以要在**第一个 session 建立之前**接管它（所有 session 都是惰性建立的，
导入后立刻改就来得及）：

```python
from genie_tts.ModelManager import model_manager
model_manager.providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
```

**这条要当成补丁对待**：Genie 升级可能改掉这个属性名，所以接管失败要退回 CPU
并**告诉用户**，不要静默变慢。

## 装起来会撞到的三件事

这三件都实测撞过，`install-onnx.mjs` 里都处理了：

1. **`jieba_fast` 任何平台都没有 wheel**，是 C 扩展源码包，`pip install genie-tts`
   需要 MSVC。而 Genie 只用到 `cut_for_search` / `posseg` / `setLogLevel`，
   纯 Python 的 `jieba` 全都有 —— 所以装一个满足 pip 元数据的垫片。
   **不要叫用户去装 Visual Studio。**
2. **`import genie_tts` 在导入时就会 `input()` 询问**，缺数据时阻塞；缺 hubert 时
   直接抛 `FileNotFoundError`。所以数据必须先下好，而且 worker 要把 `sys.stdin`
   换成 devnull（同时**保留真 stdin 给协议用** —— 这个 bug 被测试抓到过）。
3. **`import genie_tts` 会往 stdout 打印**（"⚠️ GenieData folder not found."），
   而且是 emoji，在 GBK 控制台下直接 `UnicodeEncodeError` 崩溃。JSON-over-stdio
   的协议必须把 stdout 让给 stderr，只留私有句柄传协议。

## 两个后端怎么共存

`engine` 四个值：

| 值 | 含义 |
|:--|:--|
| `auto` | 默认。有 GPT-SoVITS 用它，否则 ONNX，否则系统语音 |
| `builtin` | 只用系统语音 |
| `gpt-sovits` | 强制本机 GPT-SoVITS |
| `onnx` | 强制 ONNX |

`tts_engines` 报**两个后端各自的可用性、缺什么、以及 ONNX 实际在跑哪个 provider**。

## 声线包要能"二选一"

发布包里的 ONNX 声线**没有** `gpt`/`sovits` 字段。原来的 `listVoicePacks` 强制要求
这两个字段，会把一个完全可用的纯 ONNX 包判成坏的 —— 而那正是没引擎的用户拿到的东西。
现在改成：**PyTorch 对（`gpt`+`sovits`）或 ONNX 目录（`onnx`）居其一即可**，
并把包能跑在哪些引擎上写进 `engines` 字段。

## 发布形态：两个资产，不是一个

| 资产 | 大小 | 给谁 |
|:--|:--|:--|
| `sample-onnx-v2ProPlus.zip` | **290.8 MB** | ONNX 后端 |
| `sample-full-v2ProPlus.zip` | 1,343.8 MB | GPT-SoVITS 后端 |

**为什么必须分开。** 那 1.14 GB 的 base 模型只有 PyTorch 那条路需要 ——
Genie 自带 hubert 和 BERT。合成一个包会把用不上的 1 GB 推给选了 ONNX 的人，
而"省 5 GB"正是 ONNX 存在的理由。

ONNX 那个包**不需要引擎、不需要 PyTorch、不需要 base 模型**，就是转好的模型本身：

```
onnx/                 9 个模型文件（fp16 权重 + 几个 fp32 的图定义）
pack.json             指向 onnx/
ref.wav + ref.txt     参考音与它逐字的文本
NOTICE-weights.txt    素材声明
```

**包里就是 pack 该有的样子**，所以"安装"就是把它复制进
`~/.dsh/voice-packs/<name>/` —— 中间没有转换步骤，也就没有会和插件读法不一致的地方。

```sh
node scripts/install-onnx.mjs --voice       # 去 Downloads 找那个包
node scripts/install-onnx.mjs --from "<zip>"  # 或直接指定
node scripts/install-onnx.mjs --voice-only --from "<zip>"   # 只装声线，不碰引擎
```

`--voice-only` 是测试入口，也是"引擎已经装好了、只想换个声线"的真实用法。

## 实测方法

```bash
node local/bench-routes.mjs 3 "<文本>"    # 两条路各自冷/热态，同一句话
node local/probe-cuda.py                  # 复现 CUDA 静默回退并抓 ORT 自己的日志
node scripts/install-onnx.mjs --check     # 报告引擎状态与实际 provider
node local/build-onnx-release.mjs         # 重新构建 ONNX 声线包
```

热态 = 丢弃第一次调用（含模型加载 / API 服务启动），对后三次取平均。

## 一个还没做的清理

现有的 `sample-full-v2ProPlus.zip` 里有 `sample_e10_s120.pth`（89.2 MB），
而**它 111 个 key 全是 `discriminators.*`** —— 是训练残渣，覆盖不了任何东西
（真正的生成器是 base `s2Gv2ProPlus.pth`，已验证 781 个 key）。

所以那 89 MB 是白下的。去掉它需要同时改 `install-voice.mjs`（让它把 base 生成器
当作声线的 sovits 权重登记）和 `SOURCE.json`，属于独立的一次改动，没有塞进这一轮。

## 工作量

适配层和安装脚本已经写完了 —— 因为推理本身交给 Genie，我们只做适配。
真正花时间的是那三个安装坑和 provider 的诚实报告，不是推理本身。
