# dsh-voice

Give your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent a voice. It speaks text aloud through your speakers, and it works the moment you install it — then gets better if you want character voices.

```
you:    say good morning out loud
agent:  [tts_speak] → speaks it through your speakers
```

## Why it installs in seconds

The default backend is **whatever speech voices your operating system already has**. No model download, no Python, no GPU, no account. On Windows that is SAPI — `Microsoft Huihui Desktop` and friends are usually already installed.

If you want *character* voices or voice cloning, install [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) separately and register a voice pack. dsh-voice switches to it automatically once a pack exists. This project ships **no model weights and no voice data**, ever — see [docs/ENGINES.md](docs/ENGINES.md) for why, and [docs/VOICE-LICENSING.md](docs/VOICE-LICENSING.md) for which voices you may legally use.

**New here? → [Three-minute quick start](docs/QUICKSTART.md)**

## Install

```sh
# into a profile (this forwards to pnpm inside the profile directory)
dsh plugin --profile web add dsh-voice
```

Then name it in that profile's composition, alongside the other tool rows:

```yaml
- id: tool-voice
  name: dsh-voice
```

Restart the profile. The agent gains three tools.

## Tools

| Tool | What it does |
|---|---|
| `tts_speak` | Speaks `text`. Options: `voice`, `engine`, `speed`, `saveTo`. |
| `tts_engines` | Reports what can speak right now — built-in voices, a local GPT-SoVITS checkout, or a remote API. Start here when nothing is audible. |
| `tts_voices` | `action=list` shows registered voice packs and OS voices; `action=add` registers a pack. |

By default the synthesized wav is **discarded after playback** — nothing accumulates on disk. Pass `saveTo` to keep one.

## Configuration

All fields are optional; the defaults are usable.

```yaml
- id: tool-voice
  name: dsh-voice
  config:
    engine: auto              # auto | builtin | gpt-sovits
    voicesDir: ~/.dsh/voice-packs
    defaultVoice: ''          # preferred voice pack
    defaultVoiceBuiltin: ''   # preferred OS voice, e.g. Microsoft Huihui Desktop
    speed: 1                  # 0.5 - 2.0
    textLang: zh              # language of the text being spoken
    sampleSteps: 32           # GPT-SoVITS quality/speed knob
    keepAudio: false          # keep generated wav files
    engines:
      gptSovits:
        engineRoot: ''        # a GPT-SoVITS checkout; auto-detected when empty
        serverUrl: ''         # or point at a running API instead (thin client)
        python: ''
        version: v2ProPlus
        device: cuda
        isHalf: true
```

`engine: auto` (the default) prefers GPT-SoVITS as soon as a healthy voice pack exists, and otherwise uses the built-in voices. So installing GPT-SoVITS later needs no configuration change.

## Adding a character voice

1. Put the model's `.ckpt` in `GPT_weights_<version>/` and its `.pth` in `SoVITS_weights_<version>/` inside your GPT-SoVITS checkout.
2. Register the pack — the agent can do this for you:

```
tts_voices action=add name=<voice> \
  refAudio=<a 3-10s clean reference wav> \
  promptText=<its exact transcript> \
  gpt=GPT_weights_v4/<voice>-e10.ckpt \
  sovits=SoVITS_weights_v4/<voice>_e10_s220.pth
```

Notes and gotchas are in [docs/VOICES.md](docs/VOICES.md).

## Requirements

- **Built-in engine** — Windows (SAPI). This is the only platform the built-in engine supports today; a macOS/Linux backend is a welcome contribution.
- **GPT-SoVITS engine** — Windows or Linux, a GPT-SoVITS checkout with its Python environment. GPU optional.
- Node 20+.

## Troubleshooting

Run `tts_engines` first — it reports the exact reason a backend is unusable.

| Symptom | Cause |
|---|---|
| `System.Speech is unavailable` | No SAPI voices installed, or PowerShell is blocked by policy. |
| `no GPT-SoVITS checkout found` | Set `engines.gptSovits.engineRoot`, or `DSH_VOICE_ENGINE_ROOT`. |
| `voice pack ... is incomplete` | The pack is missing `ref.wav`, `ref.txt`, or a weight path. |
| Synthesis succeeds, nothing is heard | The audio device is muted or the wrong output is selected. |

## Development

```sh
git clone <this repo> && cd dsh-voice
node test/smoke.mjs   # engine discovery + synthesis, no audio
node test/play.mjs    # audible playback check
```

No build step: the package is plain ESM JavaScript, and the only runtime dependency is the harness's own schema library.

## License

MIT — see [LICENSE](LICENSE). Third-party programs dsh-voice calls (GPT-SoVITS, FFmpeg) keep their own licenses; both are documented in that file. You are responsible for the rights to any voice model or reference audio you register — [docs/VOICE-LICENSING.md](docs/VOICE-LICENSING.md) walks through it.

## More

- [Three-minute quick start](docs/QUICKSTART.md)
- [Engines and why no weights are bundled](docs/ENGINES.md)
- [Voice packs: format and a good reference clip](docs/VOICES.md)
- [Which voices you may use](docs/VOICE-LICENSING.md)
