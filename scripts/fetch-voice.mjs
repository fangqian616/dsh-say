/**
 * Fetch and install the optional voice weights.
 *
 *   node scripts/fetch-voice.mjs                       # download using scripts/SOURCE.json
 *   node scripts/fetch-voice.mjs --from <archive.zip>   # use a local archive
 *   node scripts/fetch-voice.mjs --print-commands       # just show the install steps
 *
 * The weights are NOT in this repository on purpose: they are hundreds of
 * megabytes, they are non-commercial, and Git is a poor place for either. This
 * script puts them in voice/ and prints how to register the resulting pack.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const voiceDir = join(repoRoot, 'voice')
// The fetch configuration lives beside this script, not with the voice data: it
// describes where to get weights from, which is a scripting concern.
const sourcePath = join(repoRoot, 'scripts', 'SOURCE.json')

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const fromPath = fromIndex >= 0 ? args[fromIndex + 1] : ''
const printOnly = args.includes('--print-commands')

const source = existsSync(sourcePath)
  ? JSON.parse(readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''))
  : {}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function install(archive, label) {
  console.log(`extracting ${label} into voice/`)
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${voiceDir}' -Force`,
  ], { stdio: 'inherit' })

  const files = walk(voiceDir)
  const gpt = files.find((file) => file.endsWith('.ckpt'))
  const sovits = files.find((file) => file.endsWith('.pth'))
  const references = files.filter((file) => file.endsWith('.wav'))

  console.log('\ninstalled:')
  console.log(`  checkpoint : ${gpt ? gpt.replace(`${repoRoot}\\`, '') : 'NOT FOUND'}`)
  console.log(`  weights    : ${sovits ? sovits.replace(`${repoRoot}\\`, '') : 'NOT FOUND'}`)
  console.log(`  references : ${references.length}`)
  if (references.length > 0) {
    console.log(`               e.g. ${references[0].split(/[\\/]/).pop()}`)
  }

  const gptRel = gpt ? gpt.replace(`${repoRoot}\\`, '').split('\\').join('/') : '<GPT_weights…/*.ckpt>'
  const sovitsRel = sovits ? sovits.replace(`${repoRoot}\\`, '').split('\\').join('/') : '<SoVITS_weights…/*.pth>'
  const refRel = references.length > 0
    ? references[0].replace(`${repoRoot}\\`, '').split('\\').join('/')
    : '<reference_audios/…wav>'

  console.log('\nnext steps:')
  console.log('  1. copy the weights into your GPT-SoVITS checkout:')
  console.log(`       copy ${gptRel}   ->  <engineRoot>/GPT_weights_v2ProPlus/`)
  console.log(`       copy ${sovitsRel} ->  <engineRoot>/SoVITS_weights_v2ProPlus/`)
  console.log('  2. ask your agent to register the pack:')
  console.log(`       tts_voices action=add name=<voice> refAudio=<abs path to ${refRel}> \\`)
  console.log(`         promptText="<the reference clip's exact transcript>" \\`)
  console.log(`         gpt=GPT_weights_v2ProPlus/${gpt ? gpt.split(/[\\/]/).pop() : '<file>.ckpt'} \\`)
  console.log(`         sovits=SoVITS_weights_v2ProPlus/${sovits ? sovits.split(/[\\/]/).pop() : '<file>.pth'}`)
  console.log('\n  The reference filenames from this pack carry their own transcripts.')
}

if (printOnly) {
  console.log('voice weights are not bundled. Fetch them, then:')
  console.log('  node scripts/fetch-voice.mjs')
  process.exit(0)
}

if (fromPath) {
  const archive = resolve(fromPath)
  if (!existsSync(archive)) {
    console.error(`no such archive: ${archive}`)
    process.exit(1)
  }
  install(archive, archive)
  process.exit(0)
}

const url = source.url
if (!url) {
  console.error('scripts/SOURCE.json has no "url" set.')
  console.error('Either fill it in, or pass a local archive:')
  console.error('  node scripts/fetch-voice.mjs --from <archive.zip>')
  process.exit(1)
}

mkdirSync(voiceDir, { recursive: true })
const archive = join(voiceDir, source.archive || 'voice-weights.zip')

console.log(`downloading ${url}`)
const response = await fetch(url, { redirect: 'follow' })
if (!response.ok) {
  console.error(`download failed: HTTP ${response.status}`)
  process.exit(1)
}
const bytes = Buffer.from(await response.arrayBuffer())
writeFileSync(archive, bytes)
console.log(`saved ${(bytes.length / 1024 / 1024).toFixed(1)} MB to ${archive.replace(`${repoRoot}\\`, '')}`)

if (source.sha256) {
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest.toLowerCase() !== String(source.sha256).toLowerCase()) {
    console.error(`checksum mismatch:\n  expected ${source.sha256}\n  actual   ${digest}`)
    console.error('refusing to extract an archive that does not match SOURCE.json')
    process.exit(1)
  }
  console.log('checksum ok')
}

install(archive, 'the downloaded archive')
