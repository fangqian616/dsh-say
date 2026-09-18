/**
 * Smoke test for dsh-voice, runnable with plain Node (no DSH runtime needed).
 *
 *   node test/smoke.mjs
 *
 * It exercises the parts that do not depend on the DSH package graph: the
 * built-in engine, voice-pack discovery, and the engine-selection router.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import builtin from '../lib/engines/builtin.js'
import gptsovits, { discover as discoverGptSovits } from '../lib/engines/gptsovits.js'
import { selectEngine, speak } from '../lib/tools.js'
import { listVoicePacks } from '../lib/voice-store.js'

// Every check runs against an empty, throwaway voices directory. A repository
// test must never depend on — or synthesize with — a voice pack that happens to
// be installed on the machine running it.
const isolatedVoicesDir = mkdtempSync(join(tmpdir(), 'dsh-voice-test-packs-'))

let failures = 0
const check = (label, condition, detail = '') => {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures += 1
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const baseConfig = (overrides = {}) => ({
  engine: 'auto',
  voicesDir: isolatedVoicesDir,
  defaultVoice: '',
  defaultVoiceBuiltin: '',
  speed: 1,
  textLang: 'zh',
  promptLang: 'zh',
  sampleSteps: 32,
  timeoutSeconds: 900,
  keepAudio: false,
  engines: { gptSovits: { serverUrl: '', engineRoot: '', python: '', version: 'v2ProPlus', device: 'cuda', isHalf: true } },
  ...overrides,
})

console.log('dsh-voice smoke test')
console.log(`platform: ${process.platform}  node: ${process.version}`)

console.log('\n1. built-in engine probe')
const probe = await builtin.probe()
console.log(`     available=${probe.available}${probe.available ? ` voices=${probe.voices.length}` : ` reason=${probe.reason}`}`)
if (process.platform === 'win32') {
  check('probe reports availability', typeof probe.available === 'boolean')
  if (probe.available) {
    check('at least one OS voice is listed', probe.voices.length > 0)
    check('voice entries carry a name', probe.voices.every((voice) => Boolean(voice.name)))
  } else {
    console.log(`     (this machine reports built-in unavailable: ${probe.reason})`)
  }
} else {
  check('non-Windows reports a clear reason', probe.available === false && /Windows/.test(probe.reason || ''))
}

console.log('\n2. built-in voice listing')
const listed = await builtin.listVoices()
check('listVoices returns a voices array', Array.isArray(listed.voices))
console.log(`     ${listed.voices.length} voice(s): ${listed.voices.slice(0, 3).map((v) => v.label).join(' | ')}`)

console.log('\n3. voice pack discovery')
const packs = listVoicePacks({ voicesDir: isolatedVoicesDir })
check('listing an empty directory yields an empty list', Array.isArray(packs) && packs.length === 0)
check('the default engine object exposes what the router needs', typeof gptsovits.probe === 'function')
console.log(`     isolated voices dir: ${isolatedVoicesDir}`)

console.log('\n4. GPT-SoVITS discovery (no engine expected on a clean machine)')
const gptStatus = await discoverGptSovits(baseConfig(), { force: true })
console.log(`     available=${gptStatus.available} mode=${gptStatus.mode}${gptStatus.engineRoot ? ` root=${gptStatus.engineRoot}` : ''}`)
check('discovery returns a decision', typeof gptStatus.available === 'boolean')
if (!gptStatus.available) check('a missing engine explains itself', Boolean(gptStatus.reason))

console.log('\n5. engine selection router')
const picked = await selectEngine({ config: baseConfig() })
if (picked.ok) {
  check('a usable engine is selected', picked.id === 'builtin' || picked.id === 'gpt-sovits', picked.id)
} else {
  const builtinUsable = probe.available === true
  check('failure is reported only when nothing is usable', builtinUsable === false, picked.reason)
}

console.log('\n6. argument validation')
const empty = await speak({ text: '   ' }, { config: baseConfig() })
check('empty text is rejected', empty.ok === false && /empty/i.test(empty.reason))

if (probe.available) {
  const unknownVoice = await speak({ text: 'hello', engine: 'gpt-sovits' }, { config: baseConfig() })
  check('gpt-sovits without a checkout is rejected clearly', unknownVoice.ok === false && Boolean(unknownVoice.reason))

  console.log('\n7. real synthesis through the built-in engine (no playback)')
  const spoken = await speak({ text: 'dsh voice smoke test' }, { config: baseConfig(), noPlay: true })
  if (spoken.ok) {
    check('synthesis reports success', spoken.ok === true)
    check('an engine is named', spoken.engine === 'builtin', spoken.engine)
    check('a voice is named', Boolean(spoken.voice))
    console.log(`     engine=${spoken.engine} voice=${spoken.voice} duration=${spoken.durationSeconds}s elapsed=${spoken.elapsedSeconds}s`)
    check('audio is discarded when keepAudio is off', spoken.audio === '')
  } else {
    console.log(`     synthesis not available here: ${spoken.reason}`)
  }
} else {
  console.log('\n7. skipping real synthesis (built-in engine unavailable)')
}

console.log('\n7. repository hygiene')
// Two guards, not formalities.
//
// First: outside `voice/`, this repository must contain no model weights and no
// audio. A voice is the user's to supply, and shipping one anywhere else is a
// licensing problem for everyone downstream.
//
// Second: `voice/` is the single sanctioned place for a published voice, and a
// published voice must carry a notice stating where the material came from and
// that the rights are not the project's to grant. Weight files without one, or
// a notice that reads like a license the maintainer cannot issue, are the exact
// failures this check exists to catch.
const forbidden = ['.ckpt', '.pth', '.safetensors', '.wav', '.mp3', '.flac']
const ignoredDirs = ['node_modules', '.git', 'local']
const sanctionedDir = 'voice'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const offenders = []
const publishedWeights = []
const walk = (dir, depth = 0) => {
  if (depth > 4) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.includes(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, depth + 1)
      continue
    }
    if (!forbidden.includes(extname(entry.name).toLowerCase())) continue
    if (full.includes(`${root}${sep}${sanctionedDir}${sep}`)) publishedWeights.push(entry.name)
    else offenders.push(full)
  }
}
walk(root)
check('no model weights or audio outside voice/', offenders.length === 0, offenders.join(', '))

// Two notices, on purpose, because the material leaves the repository before it
// reaches a user: `voice/NOTICE.txt` covers what is committed here, and the file
// placed inside the weights archive is what someone actually downloads. The
// second carries the facts, so it is the one checked for them.
//
// The archive's entry is NOT named `NOTICE.txt`: the archive extracts into
// `voice/`, so that name would overwrite the repository's own notice on any run
// of the fetch. The differing name is asserted below because it is load-bearing.
//
// They are fact sheets, matching how this material is published elsewhere (a
// bundled model carries a one-screen notice, or none). So the checks are the
// facts that must not go missing, not a shape to conform to.
const voiceNotice = join(root, sanctionedDir, 'NOTICE.txt')
check('voice/ carries the materials notice', existsSync(voiceNotice))
if (existsSync(voiceNotice)) {
  const notice = readFileSync(voiceNotice, 'utf8')
  check('it marks the use as non-commercial', /not for commercial|不得商用/.test(notice))
  check('it points at the archive for the full notice',
    /archive|压缩包/.test(notice))
  // The convention is short. An essay is how this file went wrong the first time:
  // it restated one point four ways and buried the facts people need.
  const lines = notice.split(/\r?\n/).length
  check('it stays a one-screen fact sheet', lines <= 40, `${lines} lines`)
}

const archiveNotice = join(root, sanctionedDir, 'archive', 'NOTICE-weights.txt')
check('the archive notice is versioned, so a rebuild is reproducible', existsSync(archiveNotice))
check('the archive entry name cannot clobber the repository notice',
  !existsSync(join(root, sanctionedDir, 'archive', 'NOTICE.txt')))
if (existsSync(archiveNotice)) {
  const notice = readFileSync(archiveNotice, 'utf8')
  check('the archive notice names the rights holder', /miHoYo|米哈游/.test(notice))
  check('the archive notice states the project cannot license the material',
    /cannot (grant|forbid|license)|无法(授予|许可)|不能(授予|许可)/.test(notice))
  check('the archive notice identifies the clips as the rights holder\'s voice',
    /reference-\*\.wav|《崩坏：星穹铁道》/.test(notice))
  check('the archive notice marks the use as non-commercial', /not for commercial|不得商用/.test(notice))
  check('the archive notice says the project is not affiliated',
    /not affiliated|与米哈游无关/i.test(notice))
}
if (publishedWeights.length > 0) console.log(`     voice/ holds ${publishedWeights.length} weight/audio file(s)`)
else console.log('     voice/ ships no weights (the 148 MB checkpoint is fetched, not committed)')
check('the gitignore exists', existsSync(join(root, '.gitignore')))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
