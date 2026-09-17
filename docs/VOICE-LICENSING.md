# Which voices you may use

dsh-voice ships no voice and never will. That puts one question in front of every user: *which voice may I put in a pack?* This page answers it with sources rather than opinions.

Nothing here is legal advice. When money or a public release is involved, read the primary source linked in each row and decide for yourself.

## The three questions that decide everything

Ask them in this order. A "no" at any step ends it.

**1. Where did the audio come from?**
A recording is copyrighted by whoever made it, and the voice itself may be a personal right of the speaker. A model trained on a recording inherits the problems of that recording.

**2. Does the model's own license allow your use?**
Many community voice models add explicit terms — often *non-commercial only, no redistribution, credit required*. Those terms bind you.

**3. Will you redistribute, or just use it?**
Private use and publishing are different acts. A license that lets you listen does not necessarily let you publish the pack, and publishing is where open-source projects get into trouble.

## The short version

| Voice source | Private use | Publish the pack | Commercial |
|---|---|---|---|
| Your own voice | Yes | Yes — it is yours | Yes |
| A friend/colleague who consented | Yes | Yes, with their written consent | With consent |
| Dataset licensed **Apache-2.0 / CC0 / CC-BY** | Yes | Usually yes — check the terms | Check the terms |
| Community character model (e.g. a game character) | Usually tolerated | **No** — redistribution is commonly forbidden | **No** |
| A commercial voicebank (Vocaloid, etc.) | Per its EULA | **No** | **No** |
| A real person without consent | Technically possible, ethically not | **No** | **No** |

## Safe starting points

These are datasets whose terms explicitly contemplate training speech models.

| Resource | License | Notes |
|---|---|---|
| [AISHELL-3](https://www.openslr.org/93/) | Apache-2.0 | 85 hours, 218 Mandarin speakers, built for multi-speaker TTS. A permissive license, so it is the cleanest choice for a demo voice. 19 GB. |
| [MagicHub open-source TTS sets](https://magichub.com/datasets/) | Per dataset — read each page | Chinese dialects and standard Mandarin TTS corpora released openly. Licenses vary per dataset. |
| [LibriTTS-R](https://www.openslr.org/141/) | CC BY 4.0 | English, derived from LibriVox public-domain readings. |
| [LJSpeech](https://keithito.com/LJ-Speech-Dataset/) | Public domain | English, single speaker, 24 hours. A classic cloning target. |
| [Common Voice](https://commonvoice.mozilla.org/) | CC0 | Many languages, crowd-sourced. Speaker consent is explicit in its collection process. |

To make a reference clip from one of these, take a 3-10 second clean segment, write down its **exact** transcript, and register the pack.

## Hatsune Miku, and character voices generally

This one gets misread constantly, so here is the primary source.

Crypton Future Media licenses the **original illustrations** of Hatsune Miku and the other Piapro Characters under [CC BY-NC 3.0](https://piapro.net/intl/en_for_creators.html). The same page rules out the reading people usually want:

> "Those licenses only apply to the original illustrations of the characters, and any music, videos, illustrations and 3DCG related to Crypton's characters are NOT licensed under CC license unless otherwise noted."

> Q5: Can I also use music associated with Hatsune Miku under the CC BY-NC? **A5: No.** The CC BY-NC only applies to the original illustrations of the Characters.

And on the voice specifically:

> "For music composers using the vocal track of Hatsune Miku and/or other Crypton software on your own musical works, please refer to each software's Terms and Conditions of its End User License Agreement."

So:

- **The CC BY-NC license does not cover the voice.** It covers artwork. Training a voice model on Miku's singing or speech is not granted by it.
- **Using the voicebank is governed by its EULA**, which permits creative works but restricts commercial use and redistribution.
- **Separately, the voice comes from a human voice actress** (Saki Fujita). Her recordings and her voice are her own; a synthesizer license does not silently transfer them.
- Crypton offers no blanket permission for AI voice training that this page states. If you need certainty for a commercial or redistributed work, ask them — their business contact is on that page.

### What this means in practice

| Your situation | Reading |
|---|---|
| You train a Miku voice model for yourself, at home, non-commercially | Widely tolerated in the community, but **not** something any official license confirms. It is a gray area you are choosing to enter. |
| You publish a Miku voice pack in a GitHub repo | **Don't.** It redistributes a derived voice, and the model terms almost always forbid it. |
| You build a tool whose *documentation* showcases Miku | Avoid. A project that advertises a gray area inherits it. |
| You ship something commercial using that voice | **No license covers this.** You need Crypton's permission. |

**For an open-source project the answer is clean: don't ship character voices, don't bundle them, and don't feature them in examples.** Point users at permissively licensed datasets instead. That is why this repository contains no voice at all — the design choice and the legal answer are the same one.

## What dsh-voice does to help

- **Ships nothing.** `voicesDir` lives in your home directory, outside the package.
- **Asks for the licence at registration.** `tts_voices action=add license="..."` records the terms in `pack.json`, so a future you knows the constraints.
- **Reports incomplete packs** instead of failing silently, so a misconfigured voice is visible.
- **Never uploads anything.** Synthesis is local, and no audio leaves the machine.

## If you are unsure

Default to not using it. A permissively licensed dataset voice sounds slightly less like the character you had in mind and cannot get your project taken down or your users into trouble.
