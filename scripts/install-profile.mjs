/**
 * Enable dsh-voice in a DSH profile, without asking anyone to hand-edit YAML.
 *
 *   node scripts/install-profile.mjs                 # enable in the web profile
 *   node scripts/install-profile.mjs --profile tui
 *   node scripts/install-profile.mjs --print         # show what it would change
 *
 * Two edits, and they are separate concerns:
 *
 *   1. the plugin row, appended to the profile's `cordis.patch.yml`. That file is
 *      a one-line YAML array of loader patch entries, and its own header says to
 *      edit it rather than cordis.yml. Adding a row is data, not prose, so a
 *      script should do it.
 *   2. the package reference in the profile's package.json dependencies, pointing
 *      at this checkout. A published version would not need this.
 *
 * A profile is the surface that boots the whole session, so this is deliberately
 * cautious: it backs the patch file up first, refuses to touch anything it does
 * not recognise, validates before writing, and is a no-op when already enabled.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const profileFlag = args.indexOf('--profile')
const profile = profileFlag >= 0 ? args[profileFlag + 1] : 'web'
const printOnly = args.includes('--print')
const rowId = 'tool-voice'

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
const patchPath = join(profileDir, 'cordis.patch.yml')
const pkgPath = join(profileDir, 'package.json')

function fail(message, hint) {
  console.error(`\n${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

if (!existsSync(profileDir)) {
  const available = existsSync(join(dshHome, 'profiles'))
    ? readFileSync(join(dshHome, 'profiles'), 'utf8')
    : ''
  fail(`no such profile: ${profileDir}`, 'list them with: ls ~/.dsh/profiles')
}
if (!existsSync(patchPath)) fail(`profile has no cordis.patch.yml: ${patchPath}`)

const original = readFileSync(patchPath, 'utf8')

// The file is a comment header plus one array line. Anything else means the
// shape changed and this script's assumption no longer holds, so stop rather
// than corrupt a profile that boots the session.
const lines = original.split(/\r?\n/)
const arrayIndex = lines.findIndex((line) => line.trim().startsWith('['))
if (arrayIndex < 0) {
  fail(
    'cordis.patch.yml has no top-level array to append to.',
    `Add this row by hand, then re-run: { id: ${rowId}, name: dsh-voice, disabled: false }`,
  )
}
const arrayLine = lines[arrayIndex]
if (arrayLine.includes(`id: ${rowId}`)) {
  console.log(`already enabled: ${rowId} is present in ${patchPath}`)
  process.exit(0)
}
if (!arrayLine.trim().endsWith(']')) {
  fail('cordis.patch.yml spans multiple lines; refusing to guess at the shape.', `Edit it by hand: ${patchPath}`)
}

const row = `{ id: ${rowId}, name: dsh-voice, disabled: false }`
// Insert before the closing bracket, keeping the array on one line as it was.
const insertAt = arrayLine.lastIndexOf(']')
const before = arrayLine.slice(0, insertAt).trimEnd()
const separator = before.endsWith('[') ? ' ' : ', '
const updatedArray = `${before}${separator}${row} ]`
const updatedLines = [...lines]
updatedLines[arrayIndex] = updatedArray
const updated = updatedLines.join('\n')

// The package reference. `file:` mirrors how this profile already references a
// local plugin checkout, so nothing needs publishing first.
const pkgOriginal = readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(pkgOriginal)
const depTarget = `file:${root.split('\\').join('/')}`
const needsDep = pkg.dependencies?.['dsh-voice'] !== depTarget

// A structural check, not a bracket count: the file gates the session, so the
// result must actually parse as the array of entries the loader expects.
//
// The parser is resolved relative to the PROFILE, not to this script: `yaml`
// lives in the profile's node_modules, so a plain import from here would not
// find it and the check would silently skip on exactly the machine it matters on.
let parseYaml = null
{
  const requireFromProfile = createRequire(join(profileDir, 'package.json'))
  for (const candidate of ['yaml', 'js-yaml']) {
    try {
      const api = requireFromProfile(candidate)
      const target = api && typeof api.parse === 'function' ? api : api?.default
      if (target && typeof target.parse === 'function') {
        parseYaml = (text) => target.parse(text)
        break
      }
    } catch {
      /* try the next one */
    }
  }
}

function assertParses(text, label) {
  if (parseYaml === null) {
    console.log(`note: no YAML parser reachable from the profile; skipping the parse check for ${label}`)
    return null
  }
  let doc
  try {
    doc = parseYaml(text)
  } catch (error) {
    fail(`${label} does not parse as YAML: ${String(error?.message || error)}`, 'nothing was written')
  }
  if (!Array.isArray(doc)) fail(`${label} is not a top-level array`, 'nothing was written')
  const malformed = doc.filter((entry) => !entry || typeof entry !== 'object' || !entry.id || !entry.name)
  if (malformed.length > 0) {
    fail(`${label} has ${malformed.length} entr(ies) without id and name`, 'nothing was written')
  }
  return doc.length
}

const beforeCount = assertParses(original, 'the current cordis.patch.yml')
const afterCount = assertParses(updated, 'the proposed cordis.patch.yml')

if (printOnly) {
  console.log(`profile   : ${profile}`)
  console.log(`patch     : ${patchPath}`)
  console.log(`entries   : ${beforeCount ?? '?'} -> ${afterCount ?? '?'}`)
  console.log(`row       : ${row}`)
  console.log(`dependency: dsh-voice -> ${depTarget}${needsDep ? '' : ' (already set)'}`)
  process.exit(0)
}

// Back up before touching a file that gates the session.
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${patchPath}.bak-${stamp}`
copyFileSync(patchPath, backup)
writeFileSync(patchPath, updated, 'utf8')

if (needsDep) {
  pkg.dependencies = { ...(pkg.dependencies || {}), 'dsh-voice': depTarget }
  copyFileSync(pkgPath, `${pkgPath}.bak-${stamp}`)
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

console.log(`profile   : ${profile}`)
console.log(`enabled   : ${row}`)
console.log(`patch     : ${patchPath}`)
console.log(`backup    : ${backup}`)
if (needsDep) console.log(`dependency: dsh-voice -> ${depTarget}`)
console.log('\nnext:')
console.log('  dsh plugin --profile ' + profile + ' install     # resolve the new dependency')
console.log('  restart the profile, then ask the agent to speak')
