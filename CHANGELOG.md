# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — unreleased

First release. Everything below shipped at once, so the notable part of this
entry is the list of defects found while building it rather than a feature
timeline.

### Added

- **A cordis plugin** that registers four tools: `tts_speak`, `tts_report`,
  `tts_engines`, `tts_voices`.
- **Built-in engine** driving Windows SAPI through `System.Speech`, with
  playback via the Win32 `PlaySound` entry point. No Python, no model download,
  no GPU, and no external media program.
- **GPT-SoVITS engine** in two modes: a local checkout (spawned and managed
  automatically) and a remote `serverUrl` (thin client, nothing installed
  locally).
- **Report compression** so a written report is not read aloud in full.
  Strategy `local` ranks sentences with no extra model call; `subagent` asks a
  child agent to rewrite, and is opt-in because it costs a model call.
- **First-run onboarding**: three questions asked once, at the first tool call,
  covering voice choice, persona, and automatic reporting.
- **Personas (`soul/`)** and a **`voice-report` skill** that keeps a spoken
  report consistent with the written one.
- **Voice packs** with a plain-directory format, plus `scripts/fetch-voice.mjs`
  for weights that are deliberately not committed.

### Defects found and fixed while building

These are recorded because each one would have shipped as a silent failure.

1. **`engine.play is not a function`** — the router called playback on every
   engine, but the GPT-SoVITS engine only synthesized. Every GPT-SoVITS user
   would have seen `ok: true` and heard nothing.
2. **`-Command` argument corruption** — passing positionally to PowerShell
   re-encodes arguments through the console code page, so a pure-ASCII path
   arrived as "illegal characters in path" on a non-English Windows. The
   PowerShell program is now a `.ps1` invoked with `-File`.
3. **`System.Speech` rejects non-ASCII output paths** — the script now chooses
   its own ASCII temp directory and reports the path back.
4. **`System.Media.SoundPlayer` is unavailable in PowerShell 5.1** — playback
   moved to a `winmm.dll` `PlaySound` P/Invoke, which also removed the ffmpeg
   dependency from the built-in engine entirely.
5. **Spoken text left on disk after a failed synthesis** — cleanup now runs in a
   `finally`, because text waiting to be spoken is private even when the call
   failed.
6. **List markers swallowed by Markdown cleaning** — `进展1. skill 管…` ran the
   items together, so the narration no longer sounded like a list.
7. **Numbered items scored after their marker was stripped** — the ranking rule
   could never match, so enumerated findings lost their weight.
8. **Short text bypassed speech normalization** — the verbatim path returned raw
   input, sending Markdown and newlines to the synthesizer. It only triggered
   when the text happened to be short.
9. **Identifiers mangled by emphasis stripping** — `` `tts_report` `` was spoken
   as "ttsreport" because the underscore was treated as markup.
10. **Incomplete enumerations kept their ordinals** — hearing "第一 …… 第四" made
    a listener think they had missed something. Markers are now dropped whenever
    the kept items do not form a complete prefix. The first fix only understood a
    line-based list ("1. …") and missed the same defect written inside sentences
    ("第一类是…；第二类是…"), so the check now reads the marker wherever it appears.
11. **Dangling back-references** — a conclusion survived while its premise was
    dropped, leaving "这类…" with no antecedent to refer to. Such sentences are
    now dropped with their premise.
12. **Test isolation** — the repository test picked up whichever voice pack
    happened to be installed and synthesized real speech with it. Tests now use
    an empty, throwaway voices directory.
13. **Repository hygiene gate** — `.ckpt`, `.pth`, and audio files outside
    `voice/` now fail the test suite, and published weights must carry their
    license notice.
14. **Private voice name and machine paths leaked into the publishable tree** —
    a non-commercial character voice name appeared in eight files, and the
    engine probe hardcoded the maintainer's own `E:\...` checkout and conda
    path, which would have broken auto-detection for everyone else.

### Notes

- The built-in engine supports Windows only. A macOS or Linux backend is a
  welcome contribution; `docs/ENGINES.md` describes the four functions to
  implement.
- `textLang` was initially hardcoded to `zh` on the GPT-SoVITS path, which sent
  English text through the Chinese tokenizer and read it as pinyin. It is now a
  per-call parameter with the pack's own language as the default.
- No model weights, voice data, or audio are committed. `voice/` carries a
  license notice and a fetch script; the weights arrive only if a user asks for
  them.
