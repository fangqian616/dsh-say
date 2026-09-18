/**
 * Install the voice pack that ships in this repository.
 *
 *   node scripts/install-voice.mjs                       # auto-detect the engine
 *   node scripts/install-voice.mjs --engine "D:/GPT-SoVITS"
 *
 * Two steps, and the second one is the one people get wrong:
 *
 *   1. copy the model weights from voice/ into the GPT-SoVITS checkout, because
 *      GPT-SoVITS only loads weights from its own directories;
 *   2. register a voice pack in dsh-say, copying the reference clip into the
 *      user's voices directory and recording the weight paths relative to the
 *      checkout.
 *
 * The weights are not in this repository. Fetch them first with
 * `scripts/fetch-voice.mjs`, or copy them into voice/ yourself.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { discover } from '../lib/engines/gptsovits.js'
import { voices } from '../lib/tools.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const voiceDir = join(root, 'voice')
// The repository ships exactly one voice pack, so its files sit directly in
// voice/ rather than under voice/voice-packs/<name>/. Four levels of nesting to
// hold three files was the structure implying a capability nobody had.
const packDir = voiceDir

const engineFlag = process.argv.indexOf('--engine')
const engineOverride = engineFlag >= 0 ? process.argv[engineFlag + 1] : ''
const nameFlag = process.argv.indexOf('--name')
const packName = nameFlag >= 0 ? process.argv[nameFlag + 1] : ''
// Weights often live outside the checkout the archive was unpacked to, so the
// location is a parameter rather than an assumption.
const weightsFlag = process.argv.indexOf('--weights')
const weightsDir = weightsFlag >= 0 ? resolve(process.argv[weightsFlag + 1]) : voiceDir

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

// Which pack are we installing? The repository ships one; a user may have added
// more, so ask rather than assume when it is ambiguous.
const chosen = packName || 'silver-wolf'
console.log(`pack      : ${chosen}`)

// Locate the reference clip and the weights this pack expects.
const reference = join(packDir, 'ref.wav')
if (!existsSync(reference)) {
  console.error(`no voice pack found: ${reference} is missing.`)
  console.error('  run this from the repository root, or fetch the weights first:')
  console.error('    node scripts/fetch-voice.mjs')
  process.exit(1)
}
const promptPath = join(packDir, 'ref.txt')
const promptText = existsSync(promptPath) ? readFileSync(promptPath, 'utf8').replace(/^\uFEFF/, '').trim() : ''
const packConfig = existsSync(join(packDir, 'pack.json'))
  ? JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8').replace(/^\uFEFF/, ''))
  : {}
const version = packConfig.version || 'v2ProPlus'

// Step 1: the weights. If they are not here yet, fetch them — the two scripts
// are one operation from the user's point of view, and asking someone to run
// `fetch` and then `install` and then work out where the file went is exactly
// the friction that makes a voice pack feel hard.
function weightsPresent(dir) {
  const files = walk(dir)
  return files.some((file) => file.endsWith('.ckpt')) && files.some((file) => file.endsWith('.pth'))
}

if (!weightsPresent(weightsDir)) {
  if (weightsDir !== voiceDir) {
    console.error(`\nmodel weights are not present in ${weightsDir}.`)
    console.error('  expected a .ckpt and a .pth somewhere under it')
    process.exit(1)
  }
  console.log('\nweights are not downloaded yet — fetching them now')
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'fetch-voice.mjs')], { stdio: 'inherit' })
  } catch {
    console.error('\ncould not fetch the weights automatically.')
    console.error('  download the archive from the project\'s Releases page and pass it:')
    console.error('    node scripts/install-voice.mjs --from "<archive.zip>"')
    process.exit(1)
  }
}

// Which files are the *voice*.
//
// The release bundle also carries the four base models inference needs, and that
// broke the obvious `.find(endsWith('.pth'))`: walk() returns files in name order,
// so `s2Gv2ProPlus.pth` (the base) sorted ahead of `silver-wolf_e10_s120.pth` (the
// voice), and the pack was registered pointing at the base model instead. Both are
// valid files, so nothing failed loudly - the voice simply was not the voice.
// Excluding the bundled base models by name is what makes the pick unambiguous.
const BUNDLED_BASE = new Set([
  's1v3.ckpt',
  's2Gv2ProPlus.pth',
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'pytorch_model.bin',
])

const voiceCandidates = walk(weightsDir).filter((file) => !BUNDLED_BASE.has(basename(file)))

const gptFile = voiceCandidates.find((file) => file.endsWith('.ckpt'))
const sovitsFile = voiceCandidates.find((file) => file.endsWith('.pth'))
if (!gptFile || !sovitsFile) {
  console.error(`\nmodel weights are still not present in ${weightsDir} after fetching.`)
  console.error('  expected a .ckpt and a .pth that are not one of the bundled base models')
  process.exit(1)
}
console.log(`weights in: ${weightsDir}`)

const engineRoot = engineOverride || (await discover({ engines: { gptSovits: { serverUrl: '', engineRoot: '', python: '' } } }, { force: true })).engineRoot
if (!engineRoot) {
  console.error('\nno GPT-SoVITS checkout found.')
  console.error('  pass one explicitly:  node scripts/install-voice.mjs --engine "D:/GPT-SoVITS"')
  process.exit(1)
}
console.log(`engine    : ${engineRoot}`)

const gptRelDir = `GPT_weights_${version}`
const sovitsRelDir = `SoVITS_weights_${version}`
mkdirSync(join(engineRoot, gptRelDir), { recursive: true })
mkdirSync(join(engineRoot, sovitsRelDir), { recursive: true })

// The release bundle also carries the four base models inference needs, because
// the official GPT-SoVITS package is 6.4 GB of training code, ASR, vocal
// separation and a pretrained weight for every model version. Those belong in the
// engine's pretrained_models/, not in voice/, and each one is skipped when it is
// already there so an existing checkout is never overwritten.
const PRETRAINED = [
  ['bert', join('GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large')],
  ['hubert', join('GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base')],
  ['s1v3.ckpt', join('GPT_SoVITS', 'pretrained_models', 's1v3.ckpt')],
  ['s2Gv2ProPlus.pth', join('GPT_SoVITS', 'pretrained_models', 'v2Pro', 's2Gv2ProPlus.pth')],
]

let placedModels = 0
let skippedModels = 0
for (const [staged, target] of PRETRAINED) {
  const from = join(weightsDir, staged)
  if (!existsSync(from)) continue
  const to = join(engineRoot, target)
  if (existsSync(to)) { skippedModels += 1; continue }
  if (statSync(from).isDirectory()) {
    // Walk with the prefix so a nested file keeps its relative path; slicing the
    // absolute path instead would collapse it to a bare name and leave the
    // destination directory uncreated.
    for (const file of walk(from)) {
      const rel = file.slice(from.length + 1)
      const dest = join(to, rel)
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(file, dest)
    }
  } else {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  placedModels += 1
}
if (placedModels > 0 || skippedModels > 0) {
  console.log(`base models: ${placedModels} placed, ${skippedModels} already present`)
}

const gptName = `${chosen}-e10.ckpt`
const sovitsName = `${chosen}_e10_s120.pth`
copyFileSync(gptFile, join(engineRoot, gptRelDir, gptName))
copyFileSync(sovitsFile, join(engineRoot, sovitsRelDir, sovitsName))
console.log(`weights   : ${gptRelDir}/${gptName}`)
console.log(`            ${sovitsRelDir}/${sovitsName}`)

// Step 2: register the pack, so the plugin can find it.
const voicesDir = process.env.DSH_VOICE_VOICES_DIR || join(homedir(), '.dsh', 'voice-packs')
const registered = await voices(
  {
    action: 'add',
    name: chosen,
    refAudio: reference,
    promptText,
    gpt: `${gptRelDir}/${gptName}`,
    sovits: `${sovitsRelDir}/${sovitsName}`,
    version,
    // The notice travels with the material, from its own pack.json. The installer
    // must not invent terms: it holds no rights in a cloned voice, so a default
    // it made up would be a claim it cannot support.
    notice: packConfig.notice || packConfig.license || 'terms not recorded in pack.json — see voice/NOTICE.txt',
  },
  { config: { voicesDir, engines: { gptSovits: { version } } } },
)
if (!registered.ok) {
  console.error(`\nregistration failed: ${registered.reason}`)
  process.exit(1)
}
if (registered.problem) {
  console.error(`\npack registered but incomplete: ${registered.problem}`)
  process.exit(1)
}

console.log(`\nregistered: "${chosen}" in ${registered.dir}`)
console.log('\ntry it:')
console.log(`  say something out loud`)
console.log(`  or: tts_report with voice="${chosen}"`)
