/**
 * Bundle-contract checks. Run: node test/bundle.mjs
 *
 * dsh treats a package as a profile layer ("bundle") only when its manifest
 * declares `dsh.bundle.patch` AND the referenced file exists in the published
 * tarball. When either half is missing, `dsh plugin add` installs the package
 * as an inert dependency and nothing mounts — a failure that is invisible in
 * the repository and only shows up on a user's machine after a restart.
 *
 * These checks pin both halves plus the naming contract the loader relies on.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageName = manifest.name

// --- half one: the manifest declaration -------------------------------------

const patchRel = manifest.dsh?.bundle?.patch
check('package.json declares dsh.bundle.patch', typeof patchRel === 'string' && patchRel.length > 0, String(patchRel))
check('the patch path is relative, as the loader expects', patchRel?.startsWith('./') === true)
check('the patch is listed in files[] so npm publishes it', Array.isArray(manifest.files) && manifest.files.includes('cordis.patch.yml'))
check('the package is not private', manifest.private !== true)

// --- half two: the patch itself ---------------------------------------------

let patch
try {
  patch = readFileSync(join(root, patchRel), 'utf8')
  check(`${patchRel} exists`, true)
} catch {
  check(`${patchRel} exists`, false, 'missing — the bundle would mount nothing')
}

// The profile loader resolves the row through this package's own `name`, so the
// two must agree; a stale name here fails only on a user's machine.
//
// `yaml` is deliberately not a dependency of this package, so parse with it when
// the environment happens to have it and fall back to the narrow subset this
// patch uses otherwise. A missing parser must not read as a broken bundle.
const parseRows = (text) => {
  const rows = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '')
    if (line.trim() === '') continue
    const id = /^\s*-\s*id:\s*(.+?)\s*$/.exec(line)
    const name = /^\s*name:\s*(.+?)\s*$/.exec(line)
    const flag = /^\s*disabled:\s*(.+?)\s*$/.exec(line)
    if (id) {
      current = { id: id[1].replace(/^['"]|['"]$/g, '') }
      rows.push(current)
    } else if (name && current) {
      current.name = name[1].replace(/^['"]|['"]$/g, '')
    } else if (flag && current) {
      current.disabled = flag[1].trim() === 'true'
    }
  }
  return rows
}

let rows = []
let parseError = ''
try {
  const { createRequire } = await import('node:module')
  const require = createRequire(join(root, 'package.json'))
  const YAML = require('yaml')
  const parsed = YAML.parse(patch ?? '')
  rows = (Array.isArray(parsed) ? parsed : []).flatMap((entry) => entry?.insert ?? [])
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    parseError = error.message
    rows = parseRows(patch ?? '')
  } else {
    rows = parseRows(patch ?? '')
  }
}
check('the patch parses as YAML', parseError === '', parseError)
check('it contributes exactly one row', rows.length === 1, `got ${rows.length}`)
check('the row names this package', rows[0]?.name === packageName, `row=${rows[0]?.name} package=${packageName}`)
check('the row carries an id', typeof rows[0]?.id === 'string' && rows[0].id.length > 0, rows[0]?.id)
check('the row id is the package short name', rows[0]?.id === 'say', String(rows[0]?.id))
check('the row is not disabled', rows[0]?.disabled !== true)

// The npm package is `dsh-say` while the repository is `dsh-voice`, so the two
// names deliberately differ. Pinning it here stops a well-meaning rename back to
// the repository name — which is already taken on npm by an unrelated project
// that is also a dsh bundle, so installing it would silently mount the wrong one.
check('the package name is the free npm name, not the repo name', packageName === 'dsh-say', String(packageName))

// The entry point the row resolves must be the plugin this package actually
// exports, or the layer mounts and contributes no tools.
check('main points at the plugin entry', manifest.main === 'lib/index.js', String(manifest.main))

console.log(failures === 0 ? '\nbundle: ok' : `\nbundle: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
