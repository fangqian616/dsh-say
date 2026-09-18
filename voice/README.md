# Voice (optional)

A voice pack for the GPT-SoVITS engine, with its reference clip included so the
setup can be verified the moment it finishes. The clip is an excerpt of the
game's own audio, not something this project recorded — see
[NOTICE.txt](NOTICE.txt). Everything here is optional: dsh-voice works without
it, using the speech voices your operating system already has.

**Read [NOTICE.txt](NOTICE.txt) first.** 先读 [NOTICE.txt](NOTICE.txt)。

## Contents

```
voice/
├─ NOTICE.txt              materials notice — read this first
├─ README.md                this file
├─ pack.json                version, expected weight paths, provenance note
├─ ref.wav                  参考音（3-10 秒干净人声，米哈游游戏原声）
└─ ref.txt                  参考音的逐字文本
```

The model weights are **not** here. Three hundred megabytes of weights would
make every clone of this repository three hundred megabytes larger, and GitHub
rejects any file over 100 MB anyway — the checkpoint alone is 148 MB. So the
repository carries the pack definition and the reference clip, and the weights
are fetched when a user actually wants the voice.

The published archive uses neutral filenames (`silver-wolf-e10.ckpt`,
`reference-中立.wav`) and its checksum is recorded in
[../scripts/SOURCE.json](../scripts/SOURCE.json), which the fetch script verifies
before extracting.

## Install

Two steps, and the second is the one people get wrong: GPT-SoVITS loads weights
only from its own directories, so they must be copied into the checkout before
dsh-voice can point at them. The installer does both.

```sh
# 1. get the weights (or copy them into voice/ yourself)
node scripts/fetch-voice.mjs                     # uses the url in SOURCE.json
node scripts/fetch-voice.mjs --from "D:/downloads/silver-wolf-weights.zip"

# 2. copy them into the engine and register the pack
node scripts/install-voice.mjs
```

If the weights already sit somewhere else, say so instead of moving them:

```sh
node scripts/install-voice.mjs --weights "D:/GPT-SoVITS" --engine "D:/GPT-SoVITS"
```

The installer prints the registered pack name when it finishes. Then ask your
agent to speak, or run:

```sh
node local/verify-pack.mjs silver-wolf "测试一句"
```

If `fetch-voice.mjs` reports no url, the maintainer has not published an archive
yet — use `--from` with a copy you obtained yourself.

## What you get

One voice, `silver-wolf`, using the 【开心】 reference clip. The pack publisher
names each clip after its own transcript, so `ref.txt` needed no transcription.

The three emotion clips that ship with the archive sound nearly identical in
this model — the training set appears to carry too little emotional range for
the reference to move the output. One reference is enough; registering several
is cheap if you want to compare.

## Before you use it

Read [NOTICE.txt](NOTICE.txt). The weights reproduce a character voice and the
reference clip *is* the game's own audio. Keep it non-commercial.

If you want a voice you can redistribute freely, use a permissively licensed
dataset instead of a character voice — those terms are what let you publish what
you make with it.
