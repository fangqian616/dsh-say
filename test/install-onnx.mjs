/**
 * ONNX voice archive install check.
 *
 * The release ships two assets and this covers the second one: the ONNX voice,
 * about 291 MB, which carries the model and nothing else - no PyTorch, no engine
 * checkout, no base models, because Genie-TTS supplies its own hubert and BERT.
 *
 * The fixture is a real zip built with a real archiver and installed by the real
 * script, because the parts worth testing here are the layout contract (the
 * archive is already in the shape the plugin reads) and the refusals. No engine
 * is needed, so this runs on CI.
 *
 *   node test/install-onnx.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SCRIPT = join(ROOT, 'scripts', 'install-onnx.mjs')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const work = join(tmpdir(), `dsh-say-onnx-archive-${Date.now()}`)
const staging = join(work, 'staging')
const voicesDir = join(work, 'voices')

/** Zip a directory. PowerShell on Windows, `zip` elsewhere. */
function zipDirectory(source, out) {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Compress-Archive -Path (Join-Path $env:DSH_SRC "*") -DestinationPath $env:DSH_OUT -Force'],
    { stdio: 'pipe', env: { ...process.env, DSH_SRC: source, DSH_OUT: out } })
    return
  }
  execFileSync('zip', ['-r', '-q', out, '.'], { stdio: 'pipe', cwd: source })
}

function archiverAvailable() {
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'pipe' })
      return true
    }
    execFileSync('zip', ['-v'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** Run the installer and capture everything. */
function runInstaller(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, DSH_VOICE_VOICES_DIR: voicesDir, ...env },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout || '', stderr: error.stderr || '' }
  }
}

console.log('dsh-say ONNX voice archive check')
console.log(`  work: ${work}`)

if (!archiverAvailable()) {
  console.log('\n  (no archiver available — skipping)')
  process.exit(0)
}

// A faithful fixture: the archive's layout is the pack's layout, which is the
// whole contract. `onnx/` holds a placeholder here; the real one is 320 MB of
// model files that this check has no reason to carry.
mkdirSync(join(staging, 'onnx'), { recursive: true })
writeFileSync(join(staging, 'onnx', 'vits_fp32.onnx'), 'not really a model')
writeFileSync(join(staging, 'onnx', 't2s_shared_fp16.bin'), 'nor this')
writeFileSync(join(staging, 'pack.json'), JSON.stringify({
  name: 'fixture',
  version: 'v2ProPlus',
  onnx: 'onnx',
  notice: '本声音资源仅供学习交流，严禁用于商业用途，如有侵权，请联系作者，作者得知后会于24小时内删除。',
}, null, 2), 'utf8')
writeFileSync(join(staging, 'ref.wav'), 'RIFF....WAVEfmt ')
writeFileSync(join(staging, 'ref.txt'), '试听音频', 'utf8')
writeFileSync(join(staging, 'NOTICE-weights.txt'), 'notice', 'utf8')

const archive = join(work, 'sample-onnx-v2ProPlus.zip')
zipDirectory(staging, archive)
check('the fixture archive was built', existsSync(archive))

console.log('\n1. it installs the archive into the voices directory')
const install = runInstaller(['--voice-only', '--from', archive])
check('the installer exits clean', install.code === 0, install.stderr.trim().slice(0, 200) || install.stdout.trim().slice(-200))
check('the archive was recognised as a voice', /installed "fixture"/.test(install.stdout || ''), (install.stdout || '').trim().slice(-200))

const packDir = join(voicesDir, 'fixture')
check('the pack directory exists', existsSync(packDir))
check('pack.json came across', existsSync(join(packDir, 'pack.json')))
check('the reference clip came across', existsSync(join(packDir, 'ref.wav')))
check('the transcript came across', existsSync(join(packDir, 'ref.txt')))
check('the model directory came across', existsSync(join(packDir, 'onnx', 'vits_fp32.onnx')))
check('the notice came across', existsSync(join(packDir, 'NOTICE-weights.txt')))

const written = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'))
check('pack.json still points at the model directory', written.onnx === 'onnx', written.onnx)
check('the notice survived the round trip', /学习交流/.test(written.notice || ''), (written.notice || '').slice(0, 40))

console.log('\n2. the plugin can read what the installer wrote')
{
  const { listVoicePacks } = await import('../lib/voice-store.js')
  const packs = listVoicePacks({ voicesDir })
  const pack = packs.find((entry) => entry.name === 'fixture')
  check('the pack is listed', Boolean(pack))
  check('it reports no problem', pack?.problem === '', pack?.problem)
  check('it is offered to the ONNX engine', (pack?.engines || []).join(',') === 'onnx', (pack?.engines || []).join(','))
  check('its model directory resolves inside the pack', pack?.onnxDir === join(packDir, 'onnx'), pack?.onnxDir)
}

console.log('\n3. a re-install replaces the model rather than merging it')
// A half-overwritten model directory loads and sounds wrong, which is worse than
// one that fails to load, so the model directory is replaced wholesale.
writeFileSync(join(packDir, 'onnx', 'stale-file-from-an-older-build.onnx'), 'leftover')
const again = runInstaller(['--voice-only', '--from', archive])
check('the re-install exits clean', again.code === 0, again.stderr.trim().slice(0, 200))
check('the stale file is gone', !existsSync(join(packDir, 'onnx', 'stale-file-from-an-older-build.onnx')))
check('the model is still there', existsSync(join(packDir, 'onnx', 'vits_fp32.onnx')))

console.log('\n4. it refuses things that are not a voice archive')
const notVoice = join(work, 'not-a-voice.zip')
mkdirSync(join(work, 'junk'), { recursive: true })
writeFileSync(join(work, 'junk', 'README.md'), 'hello')
zipDirectory(join(work, 'junk'), notVoice)
const refused = runInstaller(['--voice-only', '--from', notVoice])
check('a wrong archive is refused', refused.code !== 0, String(refused.code))
check('the refusal says what was expected', /does not look like an ONNX voice archive/.test(refused.stderr || ''), (refused.stderr || '').trim().slice(0, 200))
check('and it did not create a pack', !existsSync(join(voicesDir, 'junk')))

const missing = runInstaller(['--voice-only', '--from', join(work, 'nope.zip')])
check('a missing file is refused', missing.code !== 0)

// Run with no archive discoverable anywhere. The installer deliberately looks in
// Downloads, the working directory, and the release staging directory, so this
// case needs all three pointed at empty places - otherwise it asserts against
// whatever the developing machine happens to have downloaded.
const emptyHome = join(work, 'empty-home')
const emptyTemp = join(work, 'empty-temp')
const emptyCwd = join(work, 'empty-cwd')
for (const dir of [emptyHome, emptyTemp, emptyCwd]) mkdirSync(dir, { recursive: true })

const noPath = (() => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--voice-only'], {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: emptyCwd,
      env: {
        ...process.env,
        DSH_VOICE_VOICES_DIR: voicesDir,
        USERPROFILE: emptyHome,
        HOME: emptyHome,
        TEMP: emptyTemp,
        TMP: emptyTemp,
      },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout || '', stderr: error.stderr || '' }
  }
})()
check('with no archive and no --from, it says how to get one',
  noPath.code !== 0 && /releases\/latest\/download\/sample-onnx/.test(noPath.stderr || ''),
  (noPath.stderr || '').trim().slice(0, 200))

rmSync(work, { recursive: true, force: true })

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
