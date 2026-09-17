/**
 * GPT-SoVITS path check: the helper script compiles, and a voice pack can be
 * registered. This does NOT run inference — synthesizing needs model weights the
 * repository must never contain, so that stays a user-side step.
 *
 *   node test/gptsovits.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import gptsovits, { discover, scanWeights, versionFromDirName } from '../lib/engines/gptsovits.js'
import { voices } from '../lib/tools.js'

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('dsh-voice GPT-SoVITS path check')

console.log('\n1. version inference from weight directory names')
check('v4', versionFromDirName('GPT_weights_v4') === 'v4')
check('v2ProPlus', versionFromDirName('GPT_weights_v2ProPlus') === 'v2ProPlus')
check('sovits side', versionFromDirName('SoVITS_weights_v2Pro') === 'v2Pro')

console.log('\n2. discovery')
const status = await discover({ engines: { gptSovits: { serverUrl: '', engineRoot: '', python: '' } } }, { force: true })
console.log(`     available=${status.available} mode=${status.mode} root=${status.engineRoot || '(none)'}`)
if (status.available && status.mode === 'local') {
  const weights = scanWeights(status.engineRoot)
  console.log(`     weights found: ${weights.gpt.length} GPT, ${weights.sovits.length} SoVITS`)
  check('a local checkout reports its python', Boolean(status.python))
  check('weight scan returns arrays', Array.isArray(weights.gpt) && Array.isArray(weights.sovits))
} else {
  console.log('     (no local checkout on this machine — skipping weight scan)')
}

console.log('\n3. helper script compiles')
// Trigger the engine far enough to write its helper, without running inference.
const workDir = join(tmpdir(), 'dsh-voice')
const helper = join(workDir, 'gptsovits_helper.py')
const emptyPack = {
  name: 'compile-probe',
  dir: join(tmpdir(), 'dsh-voice-compile-probe'),
  version: 'v2ProPlus',
  gpt: 'GPT_weights_v2ProPlus/none.ckpt',
  sovits: 'SoVITS_weights_v2ProPlus/none.pth',
  reference: join(tmpdir(), 'does-not-exist.wav'),
  promptText: '',
  problem: '',
}
const compiled = await gptsovits.synthesize({
  text: 'compile probe',
  pack: emptyPack,
  config: {
    speed: 1,
    textLang: 'zh',
    promptLang: 'zh',
    sampleSteps: 32,
    timeoutSeconds: 60,
    engines: { gptSovits: { serverUrl: '', engineRoot: '', python: '', version: 'v2ProPlus', device: 'cpu', isHalf: false } },
  },
})
check('a missing reference is refused before any model work', compiled.ok === false, compiled.reason)
check('the helper script was written', existsSync(helper))
if (existsSync(helper)) {
  try {
    execFileSync('python', ['-m', 'py_compile', helper], { stdio: 'pipe' })
    check('the helper script compiles', true)
  } catch (error) {
    // A machine without python on PATH cannot compile it; report rather than fail.
    check('the helper script compiles', false, String(error?.message || error).slice(0, 120))
  }
}

console.log('\n4. voice pack registration')
const voicesDir = join(tmpdir(), `dsh-voice-packs-${Date.now()}`)
mkdirSync(voicesDir, { recursive: true })
const refAudio = join(tmpdir(), `dsh-voice-ref-${Date.now()}.wav`)
writeFileSync(refAudio, Buffer.from('RIFF....WAVEfmt ')) // contents are not validated at registration

const ctx = { config: { voicesDir, engines: { gptSovits: { version: 'v2ProPlus' } } } }
const rejected = await voices({ action: 'add', name: 'bad name!', refAudio, gpt: 'a.ckpt', sovits: 'b.pth' }, ctx)
check('an illegal pack name is rejected', rejected.ok === false)

const missing = await voices({ action: 'add', name: 'aria', refAudio }, ctx)
check('a missing weight path is rejected', missing.ok === false)

const added = await voices({ action: 'add', name: 'aria', refAudio, promptText: '测试', gpt: 'GPT_weights_v4/aria-e10.ckpt', sovits: 'SoVITS_weights_v4/aria_e10_s220.pth' }, ctx)
check('a valid pack registers', added.ok === true, added.reason || added.name)
check('the version is inferred from the weights path', added.version === 'v4', String(added.version))
check('pack.json is written', existsSync(join(voicesDir, 'aria', 'pack.json')))
check('ref.wav is copied', existsSync(join(voicesDir, 'aria', 'ref.wav')))
if (existsSync(join(voicesDir, 'aria', 'ref.txt'))) {
  const text = readFileSync(join(voicesDir, 'aria', 'ref.txt'), 'utf8')
  check('ref.txt keeps the transcript', text.trim() === '测试', text.trim())
}

const listed = await voices({ action: 'list' }, ctx)
check('the pack appears in the listing', (listed.packs || []).some((pack) => pack.name === 'aria'))
check('a healthy pack has no problem reported', (listed.packs || []).every((pack) => !pack.problem), JSON.stringify(listed.packs))

rmSync(voicesDir, { recursive: true, force: true })
rmSync(refAudio, { force: true })

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
