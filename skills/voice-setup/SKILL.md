---
name: voice-setup
description: 当需要安装、启用或排查 dsh-voice 插件时使用 —— 用户说"装上这个语音插件""为什么没声音""启用 dsh-voice""配置语音"，或者察觉到这个会话里没有 tts_speak 工具时。Install, enable, or troubleshoot the dsh-voice plugin.
---

# 安装与启用 dsh-voice / Install and enable dsh-voice

把插件从"仓库里的代码"变成"这个会话里能用的工具"。中间有一个**无法在会话内完成的步骤**，先说清楚，免得你卡在那儿。
Turn the plugin from code in a repository into tools in this session. One step cannot be done from inside a session — say so up front instead of getting stuck on it.

## 先判断当前处在哪一步 / Find out which step you are on

```
tts_speak 在工具列表里？ / is tts_speak in your tool list?
├─ 是 yes → 已经装好了，跳到验证 / already enabled, skip to verification
└─ 否 no  → 继续往下，找到卡在哪里 / continue and locate the blocker
```

## 三个步骤，以及为什么第二步必须由人做 / Three steps, and why the second needs a human

| 步骤 / Step | 在哪做 / Where | 谁做 / Who |
|---|---|---|
| ① 把包装进 profile | 会话内 / in session | **你 / you**（跑脚本） |
| ② **重启 profile** / restart the profile | **会话外 / outside** | **人 / the human** |
| ③ 验证工具出现 | 会话内 / in session | 你 / you |

**为什么②不能自动化 / Why ② cannot be automated**：这一步正是让插件存在的那一步。**你在会话内无法重启你自己所在的会话** —— 插件得先被挂载，你才会有 `tts_speak`。这是先有鸡还是先有蛋。
That step is the one that makes the plugin exist. You cannot restart the session you are running in: the plugin has to be mounted before you have `tts_speak`. It is a chicken-and-egg, and it does not have a clever way around it.

所以你能做①②，**必须明确告诉用户去重启** —— 不要含糊地说"配置好了"然后让他自己发现没生效。
So do ①② and then **tell the user plainly to restart**. Do not say "configured" and let them discover that nothing changed.

## 操作

### 1. 找到仓库

```
检查这些位置，找到含 package.json 且 name 为 dsh-voice 的目录：
  - 用户提到的路径
  - 当前工作目录及其子目录
  - ~/dsh-voice、~/projects/dsh-voice
```

找不到就问用户仓库在哪。**不要凭空 clone** —— 用户可能已经有一个正在改的 checkout。

### 2. 跑启用脚本（幂等，可安全重试）

```sh
node scripts/install-profile.mjs --print           # 先看会改什么
node scripts/install-profile.mjs                   # 再执行
```

它会：往 profile 的 `cordis.patch.yml` 追加一行 `{ id: tool-voice, name: dsh-voice, disabled: false }`，并把 profile 的 `package.json` 指向这个 checkout。

**这个文件 gates 整个 session，改坏了 profile 起不来。** 所以脚本内置了备份、结构校验、YAML 解析校验、幂等。**不要绕过脚本手改那个文件** —— 如果你确实需要手工处理（比如脚本报告结构不认识），改之前先备份，改完把结果给用户看。

默认目标是 `web` profile。用户可能在用别的，用 `--profile <名字>` 指定；不确定就先问，或列一下 `~/.dsh/profiles/`。

### 3. 解析依赖

```sh
dsh plugin --profile web install
```

脚本的输出里会提醒这一步。它把新增的 `file:` 依赖装进 profile 的 node_modules，不装的话启动时找不到 `dsh-voice` 这个包名。

### 4. 让用户重启（这一步你要说清楚）

明确告诉用户：

> 配置已写入。**需要重启这个 profile 才会生效** —— 重启会中断当前会话，所以请你挑个时间点自己重启。

不要说"装好了"。**没重启之前，工具不会出现。**

### 5. 验证

重启后让用户回来说一声，或者你重新检查工具列表：

```
tts_speak 在列表里 → 跑 tts_engines 看后端状态
```

`tts_engines` 会报每个后端是否可用、以及确切原因。

## 排错

| 现象 | 原因 |
|---|---|
| `tts_speak` 重启后仍不出现 | ① 依赖没装（跑 `dsh plugin --profile X install`）② 行没写对（`--print` 检查）③ 重启的是另一个 profile |
| profile 起不来 | 用脚本建的 `.bak-<时间戳>` 备份还原：`copy cordis.patch.yml.bak-<ts> cordis.patch.yml` |
| 脚本说"结构不认识" | 那个文件被人手工改成多行了。用它的提示手改，**改前备份** |
| `no such profile` | profile 名不对，列一下 `~/.dsh/profiles/` |
| 工具在但没声音 | 那是运行期问题，不是安装问题 —— 跑 `tts_engines`，或见主 README 的排错表 |

## 不要做的事

- **不要手改 `cordis.yml`** —— 它自己写着"edit cordis.patch.yml, not this file"
- **不要在没备份的情况下改 profile 文件**
- **不要声称"装好了"却没让用户重启**
- **不要为了让工具出现而重启用户的会话** —— 那是他的决定
- 不要删除 profile 目录里**不是你创建**的 `.bak` 文件。别人（或别的插件）也可能在那里放备份
