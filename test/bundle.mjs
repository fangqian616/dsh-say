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

// Publishing metadata, which only matters once the package is on npm and is
// therefore easy to forget: without `repository` the registry cannot resolve the
// README's relative image and link paths, so the npm page renders a broken
// banner, and `access` left unset risks an unscoped package going up restricted,
// invisible to everyone it was meant for.
check('repository points at the source, so npm can resolve README assets',
  typeof manifest.repository?.url === 'string' && manifest.repository.url.includes('github.com'), String(manifest.repository?.url))
check('public access is explicit, not left to a default', manifest.publishConfig?.access === 'public', String(manifest.publishConfig?.access))
check('the tarball ships a README and a license', manifest.files?.includes('README.md') && manifest.files?.includes('LICENSE'))
// A release helper added for the maintainer's own publish flow shipped to users
// the first time it existed, because `files` lists whole directories. The
// exclusion is easy to drop in a later reshuffle, and nothing else would notice.
check('the maintainer-only publish helper is excluded from the tarball',
  manifest.files?.includes('!scripts/publish.mjs'), 'a later files[] edit could silently republish it')
check('the scripts users run are still shipped',
  manifest.files?.includes('scripts') && !manifest.files?.includes('!scripts'))

// The repository and the npm package are both `dsh-say`. The name is pinned
// because it is not free to choose: `dsh-voice` is taken on npm by an unrelated
// voice plugin that is also a dsh bundle, so installing under that name would
// silently mount someone else's project. A rename "back" to it must fail here.
check('the package name is the free npm name', packageName === 'dsh-say', String(packageName))
check('the npm name is not the one another project owns', packageName !== 'dsh-voice')

// The entry point the row resolves must be the plugin this package actually
// exports, or the layer mounts and contributes no tools.
check('main points at the plugin entry', manifest.main === 'lib/index.js', String(manifest.main))

console.log(failures === 0 ? '\nbundle: ok' : `\nbundle: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
