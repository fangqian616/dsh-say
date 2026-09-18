# Voice packs

A voice pack is a directory that tells dsh-say how to speak in one voice.

```
~/.dsh/voice-packs/
└── aria/
    ├── pack.json     model paths and version
    ├── ref.wav       3-10s clean reference audio
    └── ref.txt       the exact transcript of ref.wav
```

`voicesDir` sets the parent directory; each subdirectory is one pack, and its name is the `voice` id you pass to `tts_speak`.

## Registering one

```
tts_voices action=add \
  name=aria \
  refAudio=C:\voices\aria-sample.wav \
  promptText=这是一段参考音频的逐字文本。 \
  gpt=GPT_weights_v4/aria-e10.ckpt \
  sovits=SoVITS_weights_v4/aria_e10_s220.pth
```

`gpt` and `sovits` are **relative to the GPT-SoVITS checkout**, matching how its own config refers to them. `version` is inferred from the weight directory name (`GPT_weights_v4` → `v4`) and can be overridden.

You can also write the files yourself — the format is deliberately plain.

## Getting the reference audio right

This matters more than any parameter.

- **3-10 seconds.** Shorter and the timbre is unstable; longer does not help.
- **One speaker, no music, no reverb, no overlapping noise.** A clean clip beats a long one every time.
- **The transcript must be exact**, including punctuation. GPT-SoVITS conditions on it, so a wrong transcript degrades every later line.
- **Emotion carries over.** A happy reference yields a happier voice, an angry one a harder voice. Keep several emotion clips as separate packs if you want to switch register.

## Adding weights

Put the files where GPT-SoVITS expects them:

```
<engineRoot>/GPT_weights_<version>/<name>.ckpt
<engineRoot>/SoVITS_weights_<version>/<name>.pth
```

Run `tts_engines` afterwards — it lists every weight file it found and the exact relative paths to use.

## Rights and consent

Only register material you are allowed to use, and think about what that means before you do:

- **A real person's voice** — you need their permission. A voice is personal data in many jurisdictions; cloning someone who has not agreed is not a technical question.
- **A character voice model** — check the terms of whoever trained it. Community models commonly forbid commercial use and redistribution, and require credit.
- **A reference clip** — if it is an excerpt of existing audio (a game, a film, a recording), then it is the rights holder's work, not yours, even though you are the one registering it.
- **Redistribution** — do not publish a voice pack you do not own. dsh-say never will; that is why `voicesDir` lives in your home directory and not in the package.

Record where the material came from in `pack.json`'s `notice` field when you register, so your future self knows the constraints. It is a **note for your records, not a license**: registering a pack grants nothing, because the rights in a cloned voice belong to whoever owns the character and the recording — not to you, and not to this plugin. `tts_voices add` accepts `license` as an older alias for the same field.
