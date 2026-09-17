# soul —— 播报人设

这里存放播报角色的**人设文件**（纯文本，随仓库分发）。声线权重不在这里，见 [../voice/](../voice/)。

```
soul/
├─ voice-pack.json    默认声线包名与语速
├─ <角色名>.md        当前人设
└─ _template.md       新建人设的模板
```

## 用法

`voice-report` skill 在每次播报前读这里的文件，取语气、节奏、禁忌，把汇报稿改写成该角色的口气。

**改人设**：直接编辑对应的 `.md`。改完立刻念一句验证。

**换角色**：复制 `_template.md` 成 `soul/<新名字>.md`，填好小节，然后在 `voice-pack.json` 里把 `pack` 改成对应的声线包名。

**换声线**：改 `voice-pack.json` 的 `pack`。留空则用插件配置的默认值，插件也没有就用系统语音。

## 边界

- 人设**只影响措辞**，不影响事实、判断和结论的准确性。
- 失败与风险优先用平实语气说清，人设让位于清晰。
- 写法细则与反例见 [../skills/voice-report/docs/persona-guide.md](../skills/voice-report/docs/persona-guide.md)。
