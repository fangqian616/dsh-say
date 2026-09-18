---
name: voice-setup
description: '当需要安装、启用或排查语音插件时使用 —— 仓库叫 dsh-voice，npm 包名是 dsh-say（装的时候用 dsh-say）。触发场景：装上这个语音插件 / 为什么没声音 / 启用语音插件 / 配置语音，或者察觉到这个会话里没有 tts_speak 工具。Install, enable, or troubleshoot the dsh-say plugin.'
---

# 安装与启用 dsh-voice / Install and enable dsh-voice

> 仓库叫 **dsh-voice**，npm 包叫 **dsh-say**。**装的时候用包名 `dsh-say`。**

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
> **仓库叫 `dsh-voice`，npm 包叫 `dsh-say`。** npm 上的 `dsh-voice` 是**另一个人的项目**（另一个语音插件，同样是 dsh bundle）—— 装它不会报错，但用户会得到完全不同的东西。**装的时候必须用 `dsh-say`**，不要因为仓库叫 dsh-voice 就把包名写成 dsh-voice。

**不要手改 profile 里的任何文件。** 尤其是不要手工往 `cordis.patch.yml` 追加行 —— 那是旧办法，现在由包自己的组合层负责，手写反而会和 `dsh plugin list` / 升级路径不一致。

如果从 git 装（还没发布到 npm 时）：

```sh
dsh plugin --profile web add github:fangqian616/dsh-voice
```

git 来源靠 `prepare` 脚本构建，pnpm 默认拦着 —— `dsh plugin` 会直接打印出要加的那个键，把它加到 profile 目录的 `pnpm-workspace.yaml` 里的 `allowBuilds` 下面，然后重跑。这是 pnpm 的安全默认值，不是插件的问题，讲清楚即可。

**从本地 checkout 装**（用户在改这个仓库时）：用绝对路径，例如
`dsh plugin --profile web add "file:E:\path\to\dsh-voice"`。不要用相对路径 `.` —— pnpm 的工作目录是 profile 目录，`.` 会指到 profile 自己。

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

## 装角色声线时：素材声明（不要说错）

用户要装"角色声线"时，把来历说清楚，**不要替权利人表态**。

- 代码是 MIT，**素材不在那个许可范围内**。
- **参考音是权利人的游戏原声**，不是本项目录的。角色与声音的权利属于权利人（自带那条属于米哈游）。
- **本项目不持有这些权利，所以既不能授予、也无权禁止。** 别说成"本插件授权你非商用"或"本项目禁止你商用"；商用许可只有权利人能给。

装之前让用户读 `voice/NOTICE.txt`。**不要**补一句"放心用"或"我保证合规"。

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
