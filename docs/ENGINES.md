# Engines

dsh-voice is a thin layer over text-to-speech backends. It ships none of them.

| Engine | Install cost | Voices | Quality |
|---|---|---|---|
| `builtin` | **zero** — the OS already has it | Whatever your system ships | Robotic but clear |
| `gpt-sovits` (local) | ~2 GB+ (Python, torch, weights, plus a voice model) | Character voices, zero-shot cloning | Very good |
| `gpt-sovits` (`serverUrl`) | zero on this machine — someone else runs the engine | Depends on that server | Same as above |

## `builtin`

Drives Windows SAPI through `System.Speech` from a PowerShell script. Playback uses the Win32 `PlaySound` entry point, so the whole engine needs **no external program at all** — no ffmpeg, no ffplay.

What it cannot do: voice cloning, character voices, or anything beyond the voices already installed. To see them:

```
tts_voices action=list
```

A voice identifier is the SAPI name, e.g. `Microsoft Huihui Desktop`. Set `defaultVoiceBuiltin` to make one the default.

### Why the PowerShell script is a file

The program is written to a `.ps1` and invoked with `-File`, not passed through `-Command`. Two problems make `-Command` unusable here:

1. Positional arguments are re-encoded through the console code page, so a non-English Windows mangles them — even a pure-ASCII path can arrive as "illegal characters in path".
2. `System.Speech` refuses a **non-ASCII output path**, which is why the script picks its own ASCII temp directory and reports the path back instead of trusting the one it was given.

Both are covered by `test/smoke.mjs`, which synthesizes real audio.

### Non-Windows

`builtin` reports a clear reason and declines. A macOS (`say`) or Linux (`espeak-ng`) backend would be a small, welcome contribution: implement `probe`, `listVoices`, `synthesize`, `play` in a new file in `lib/engines/` and add it to the router in `lib/tools.js`.

## `gpt-sovits`

Two modes, chosen automatically:

**`local`** — a GPT-SoVITS checkout is found. dsh-voice writes a small Python helper, starts `api_v2.py` on first use if it is not already listening, and synthesizes over its local HTTP API. Discovery looks at `engines.gptSovits.engineRoot`, then `DSH_VOICE_ENGINE_ROOT`, then common locations such as `~/GPT-SoVITS`. The Python interpreter is detected from a venv in the checkout, then the `gpt-sovits` conda environment, then `DSH_VOICE_PYTHON`.

**`server`** — set `engines.gptSovits.serverUrl` and dsh-voice posts to that machine's API instead. Nothing else is needed locally: this is the thin-client mode, useful when the GPU lives on another box or in a container.

```
tts_engines
```

prints which mode is active, which checkout was found, and which weight files exist inside it.

## Why no weights are bundled

Three reasons, and the first alone decides it:

1. **Licensing.** Character voice models are derivative works of someone else's performance and often of a copyrighted character. Redistributing them is not ours to do. Pretrained base weights are downloadable from their own upstream projects, with their own terms.
2. **Size.** A GPT-SoVITS inference setup is 2 GB at the very best (CPU-only torch) and 12 GB as commonly installed. Bundling that into a plugin is hostile.
3. **Consent.** A cloned voice belongs to the person it came from. A tool that ships voices normalizes taking them; a tool that requires you to supply your own does not.

So: `dsh-voice` asks your OS to speak, or drives an engine you installed, or talks to a server you run. It never carries a voice of its own.
