# Voice (optional)

A voice pack for the GPT-SoVITS engine, with its reference clip included so the
setup can be verified the moment it finishes. Everything here is optional:
dsh-voice works without it, using the speech voices your operating system
already has.

**Read [LICENSE.txt](LICENSE.txt) first.** 学习与研究用途，禁止商用。最终版权归米哈游所有。

## Contents

```
voice/
├─ LICENSE.txt              non-commercial notice — read this first
├─ SOURCE.json              where to fetch the model weights
└─ voice-packs/
   └─ silver-wolf/
      ├─ pack.json          version and expected weight paths
      ├─ ref.wav            参考音（3-10 秒干净人声）
      └─ ref.txt            参考音的逐字文本
```

The model weights are **not** here. They are hundreds of megabytes and
non-commercial, so they live outside the repository and are fetched on demand.

## Install

Two steps, and the second is the one people get wrong: GPT-SoVITS loads weights
only from its own directories, so they must be copied into the checkout before
dsh-voice can point at them. The installer does both.

```sh
# 1. get the weights (or copy them into voice/ yourself)
node scripts/fetch-voice.mjs --from "D:/downloads/voice.zip"

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

## What you get

One voice, `silver-wolf`, using the 【开心】 reference clip. The pack publisher
names each clip after its own transcript, so `ref.txt` needed no transcription.

The three emotion clips that ship with the archive sound nearly identical in
this model — the training set appears to carry too little emotional range for
the reference to move the output. One reference is enough; registering several
is cheap if you want to compare.

## Before you use it

Read [LICENSE.txt](LICENSE.txt). The weights reproduce a character voice, and
rights to the character and the voice belong to their owner — which is why the
notice says so explicitly. Keep it non-commercial, and think twice before
publishing anything you make with it.

If you want a voice you can redistribute freely, use a permissively licensed
dataset instead; [../docs/VOICE-LICENSING.md](../docs/VOICE-LICENSING.md) lists
several with their terms.
