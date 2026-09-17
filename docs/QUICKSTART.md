# Three-minute quick start

Get from nothing to hearing your machine speak. The first part needs no download at all.

## 1. Install (30 seconds)

```sh
dsh plugin --profile web add dsh-voice
```

Add the row to that profile's composition, next to your other tool rows:

```yaml
- id: tool-voice
  name: dsh-voice
```

Restart the profile.

## 2. Hear it (10 seconds)

Ask your agent:

> say "hello, I can speak now" out loud

It calls `tts_speak` and the words come out of your speakers. That is the whole install — no Python, no model download, no GPU.

Prefer a different system voice? List them:

> use tts_voices to show me the available voices

Then pin one in the config:

```yaml
- id: tool-voice
  name: dsh-voice
  config:
    defaultVoiceBuiltin: Microsoft Huihui Desktop
```

## 3. Check what is available (20 seconds)

> run tts_engines

You get a straight answer about each backend:

```
selected: builtin (configured: auto)
built-in: available, 3 voice(s)
gpt-sovits: unavailable — no GPT-SoVITS checkout found
voice packs: 0 in ~/.dsh/voice-packs
```

Read this first whenever nothing is audible — it names the exact reason.

## 4. A test voice that ships with the project (5 minutes)

Want to hear a character voice rather than the system one? This repository
carries one ready to install: **`silver-wolf`**, with its reference clip
included. Only the model weights are missing, because they are hundreds of
megabytes and must be fetched separately.

```sh
# 1. get the weights (or copy them into voice/ yourself)
node scripts/fetch-voice.mjs --from "D:/path/to/weights.zip"

# 2. copy them into GPT-SoVITS and register the pack
node scripts/install-voice.mjs
```

If GPT-SoVITS is not where the installer looks, name it:

```sh
node scripts/install-voice.mjs --engine "D:/GPT-SoVITS" --weights "D:/GPT-SoVITS"
```

Then ask your agent:

> say "设置完成，这条声线可以用" using the silver-wolf voice

**Read [../voice/LICENSE.txt](../voice/LICENSE.txt) before using it:**
学习与研究用途，禁止商用，最终版权归米哈游所有. If you need a voice you may
redistribute freely, use a permissively licensed dataset —
[VOICE-LICENSING.md](VOICE-LICENSING.md) lists several.

## 5. Optional: your own voice (the rest of the time)

If you want a voice that is not in this repository, bring your own. You need a
GPT-SoVITS checkout and material **you are allowed to use** — see
[VOICES.md](VOICES.md) for what that means.

```sh
git clone https://github.com/RVC-Boss/GPT-SoVITS
# follow its README to install its Python environment and download the base weights
```

Drop the model's weights in place, then register the pack:

> register a voice pack named "narrator" using C:\voices\narrator.wav (transcript: "这是一段参考音频。"), gpt=GPT_weights_v4/narrator-e10.ckpt, sovits=SoVITS_weights_v4/narrator_e10_s220.pth

From then on, `tts_speak` uses it automatically — `engine: auto` prefers
GPT-SoVITS as soon as a healthy pack exists, so nothing else changes.

## Common first-run surprises

| What you see | What it means |
|---|---|
| Nothing is audible, `played: true` | Wrong output device or muted volume. The wav played. |
| `System.Speech is unavailable` | No SAPI voices installed, or PowerShell blocked by policy. |
| `no GPT-SoVITS checkout found` | Expected before step 4. Set `engines.gptSovits.engineRoot` if yours lives elsewhere. |
| `voice pack ... is incomplete` | The pack is missing `ref.wav`, `ref.txt`, or a weight path. |
| Speech is slow on the GPT-SoVITS engine | Lower `sampleSteps` (32 → 16), or use a GPU. |

## Where things land

| Path | What |
|---|---|
| `~/.dsh/voice-packs/` | Your voice packs. Nothing here ships with the project. |
| system temp `/dsh-voice/` | Helper scripts and in-flight audio. Safe to delete. |

Audio is deleted after playback unless you pass `saveTo` or set `keepAudio: true`. A failed synthesis deletes its text as well, so no spoken content is left on disk.
