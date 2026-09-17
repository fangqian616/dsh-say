# Voice (optional)

A voice pack for the GPT-SoVITS engine. Everything here is optional: dsh-voice
works without it, using the speech voices your operating system already has.

## Contents

```
voice/
├─ LICENSE.txt            non-commercial notice — read this first
├─ GPT_weights_v2ProPlus/ the GPT checkpoint
├─ SoVITS_weights_v2ProPlus/ the SoVITS weights
└─ reference_audios/      reference clips, one per emotion
```

## Installing it

Point the engine at these weights, then register the pack. With a GPT-SoVITS
checkout at `$ENGINE`:

```sh
cp voice/GPT_weights_v2ProPlus/*      "$ENGINE/GPT_weights_v2ProPlus/"
cp voice/SoVITS_weights_v2ProPlus/*   "$ENGINE/SoVITS_weights_v2ProPlus/"
```

Then tell your agent, naming the reference clip you want as the voice's tone:

> register a voice pack named "silver" using
> voice/reference_audios/【中立】…wav as the reference,
> gpt=GPT_weights_v2ProPlus/<file>.ckpt,
> sovits=SoVITS_weights_v2ProPlus/<file>.pth

The reference filenames carry their own transcripts, so the pack publisher's
naming is the transcript. See [../docs/VOICES.md](../docs/VOICES.md) for why the
reference clip matters more than any parameter.

## Before you use it

Read [LICENSE.txt](LICENSE.txt). **学习与研究用途，禁止商用。最终版权归米哈游所有。**

The weights live outside this repository — the project stays small, and a large
binary in Git helps nobody. Fetch them, then install:

```sh
node scripts/fetch-voice.mjs                 # downloads into voice/ from the URL in voice/SOURCE.json
```

If you already have the archive locally, pass it instead of downloading:

```sh
node scripts/fetch-voice.mjs --from "D:/downloads/voice.zip"
```

The weights reproduce a character voice. Rights to the character and the voice
belong to their owner, which is why the notice above says so explicitly — keep
this non-commercial, and think twice before publishing anything you make with it.
