/**
 * Voice discovery and registration.
 *
 * dsh-say does not ship any voice. The built-in engine uses whatever voices
 * the operating system already has; the GPT-SoVITS engine uses voice packs the
 * user registers here, and each pack's reference audio is material the user is
 * responsible for being allowed to use.
 *
 * @module dsh-say/lib/voice-store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/**
 * Read a JSON file, returning `undefined` when it is absent or malformed.
 *
 * A leading BOM is stripped before parsing. `JSON.parse` rejects one, and a BOM
 * is what any Windows editor produces by default - Notepad, PowerShell's
 * `Set-Content -Encoding UTF8`, and the PowerShell snippets people paste into
 * issue reports. Without this, a hand-written pack.json is reported as
 * "missing or malformed" when it is sitting right there and perfectly valid.
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return undefined
  }
}

/** All direct subdirectories of `dir`, or `[]` when it does not exist. */
export function listDirs(dir) {
  try {
    return readdirSync(dir)
      .filter((entry) => {
        try {
          return statSync(join(dir, entry)).isDirectory()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

/** All `.wav` files directly inside `dir`, sorted by name. */
export function listWavs(dir) {
  try {
    return readdirSync(dir)
      .filter((entry) => entry.toLowerCase().endsWith('.wav'))
      .sort()
  } catch {
    return []
  }
}

/**
 * List registered voice packs.
 *
 * A voice pack is a directory `voicesDir/<name>/` holding `pack.json` and one
 * or more reference wavs. Packs missing any of that are reported with a
 * `problem` so `tts voices` can explain what is wrong instead of silently
 * hiding them.
 *
 * A pack may carry PyTorch weights (`gpt` + `sovits`, for GPT-SoVITS), an ONNX
 * model directory (`onnx`, for the ONNX engine), or both. Demanding the PyTorch
 * pair would mark a perfectly usable ONNX-only pack as broken, which is exactly
 * the pack a user gets from the release archive when they have no engine yet.
 *
 * @param {{ voicesDir: string, defaultVoice?: string }} options
 */
export function listVoicePacks(options) {
  const { voicesDir } = options
  return listDirs(voicesDir).map((name) => {
    const dir = join(voicesDir, name)
    const pack = readJson(join(dir, 'pack.json'))
    const refs = listWavs(dir)
    const promptText = readPromptText(dir)
    const problems = []
    const hasTorch = Boolean(pack?.gpt && pack?.sovits)
    const hasOnnx = Boolean(pack?.onnx)
    if (!pack) problems.push('pack.json missing or malformed')
    if (refs.length === 0) problems.push('no reference .wav in the pack directory')
    if (!promptText) problems.push('ref.txt (the exact transcript of the reference audio) is empty')
    if (pack && !hasTorch && !hasOnnx) {
      problems.push('pack.json names no model: give either "gpt"+"sovits" (PyTorch) or "onnx" (an ONNX model directory)')
    }
    const gpt = pack?.gpt || ''
    const sovits = pack?.sovits || ''
    // Only meaningful for the ONNX engine, and only useful as an absolute path.
    // A pack built from the release archive keeps its model inside the pack
    // (`onnx` is a relative directory name); one registered against an existing
    // conversion points somewhere else entirely, and joining an absolute path
    // onto the pack directory would produce a path that cannot exist.
    const onnx = pack?.onnx || ''
    const onnxDir = onnx ? (isAbsolute(onnx) ? onnx : join(dir, onnx)) : ''
    return {
      name,
      dir,
      version: pack?.version || 'v2ProPlus',
      gpt,
      sovits,
      onnx,
      onnxDir,
      // Which engines can speak this pack, so a caller picks one it can serve
      // rather than discovering the mismatch at synthesis time.
      engines: [hasTorch ? 'gpt-sovits' : '', hasOnnx ? 'onnx' : ''].filter(Boolean),
      reference: refs.length > 0 ? join(dir, refs[0]) : join(dir, 'ref.wav'),
      promptText,
      // The provenance note travel with the pack. `license` is the older key and
      // is still read, because packs registered before the rename exist on disk.
      notice: pack?.notice || pack?.license || '',
      problem: problems.length > 0 ? problems.join('; ') : '',
    }
  })
}

/** The reference transcript, preferring `ref.txt` then `prompt.txt`. */
function readPromptText(dir) {
  for (const candidate of ['ref.txt', 'prompt.txt']) {
    const path = join(dir, candidate)
    if (!existsSync(path)) continue
    try {
      return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
    } catch {
      return ''
    }
  }
  return ''
}

/** One registered pack by name, or `undefined`. */
export function findVoicePack(options, name) {
  if (!name) return undefined
  return listVoicePacks(options).find((pack) => pack.name === name)
}

/** The pack used when a call names no voice: the configured default, else the first healthy one. */
export function pickVoicePack(packs, preferred) {
  if (preferred) {
    const exact = packs.find((pack) => pack.name === preferred)
    if (exact) return exact
  }
  return packs.find((pack) => !pack.problem)
}

/** Ensure the voices directory exists so a user can drop a pack into it. */
export function ensureVoicesDir(voicesDir) {
  mkdirSync(voicesDir, { recursive: true })
  return voicesDir
}
