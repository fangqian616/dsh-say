# Contributing

Thanks for considering it. This project is small and the rules are short.

## Before you start

```sh
git clone <this repo> && cd dsh-say
npm install
npm test              # five checks, no audio
npm run test:audible  # speaks through your speakers, to prove playback works
```

There is no build step. The package is plain ESM JavaScript; the only runtime
dependency is the harness's own schema library.

## The rules

**1. `npm test` must pass before you open a pull request.**

All six checks. If you add behaviour, add a check for it — and make sure the
check actually exercises the code path you changed. A test that passes without
touching the new branch is worse than no test, because it looks like coverage.
More than one defect in this repository was found by a test that was quietly
testing nothing.

**2. Never commit model weights, voice data, or audio.**

`test/smoke.mjs` fails if weights or audio appear outside `voice/`, and if the
notice there is missing or claims rights this project does not hold. This is
deliberate and it is not negotiable: the project's promise is that installing it
never downloads a voice. `voice/` is the single sanctioned place for a published
voice, and `voice/NOTICE.txt` must travel with it.

Keep that notice short and factual — owner, source, non-commercial, not
affiliated. It cannot grant anything, so do not write one that reads like a
license; the test will fail if you do.

**3. Do not add a hard dependency on an optional service.**

`subagents`, `userQuestions`, and `settings` may all be absent in a valid
composition. Read them with `ctx.get(name)` and handle `undefined`; a missing
service degrades a feature, it does not crash a tool. The report compressor is
the worked example: it prefers a child agent and falls back to a local
summarizer, so it still reports when delegation is unavailable.

**4. Keep user text off disk.**

Synthesized audio is deleted after playback unless `saveTo` or `keepAudio` asks
otherwise. Waiting text is deleted in a `finally`, including when synthesis
fails — audio the user hears is private, and so is text waiting to be spoken.

**5. Comment the why, not the what.**

The code says what it does. A comment earns its place by recording a constraint
that is not visible from the code: a platform quirk, a licensing boundary, a
failure mode that was actually hit. Existing examples are in
`lib/engines/builtin.js` (PowerShell argument encoding) and `lib/summarize.js`
(why incomplete enumerations lose their ordinals).

## Adding an engine

An engine is an object with four functions:

```js
export default {
  name: 'my-engine',
  label: 'My Engine',
  async probe(),                 // → { available: boolean, reason?: string }
  async listVoices(),            // → { available: boolean, voices: [...] }
  async synthesize(request),     // → { ok: true, audio } | { ok: false, reason }
  async play(file, options),     // optional; falls back to the shared player
}
```

`play` is optional on purpose: an engine that only produces audio still works,
because the router falls back to the shared player. Add the engine to
`lib/engines/`, wire it into `selectEngine` in `lib/tools.js`, and extend
`test/smoke.mjs` so the router is covered.

A macOS (`say`) or Linux (`espeak-ng`) backend for the built-in engine is the
most wanted contribution: implement `probe`, `listVoices`, `synthesize` and
`play` in a new file under `lib/engines/`, then wire it into `selectEngine`.

## Voice material

Only contribute material you are allowed to contribute. A real person's voice
needs their permission; a character voice belongs to whoever owns the character,
separately from whoever trained the model, and a reference clip taken from
existing audio belongs to the rights holder as well. `voice/NOTICE.txt` shows the
notice format for anything published in `voice/` — and it does not grant anything,
so do not write one that purports to.

## Reporting a bug

Include what you ran, what you expected, and what happened. For a silent
playback problem, the output of `tts_engines` is the fastest path to an answer:
it reports exactly why a backend is unavailable.
