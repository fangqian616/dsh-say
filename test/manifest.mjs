/**
 * Package manifest check: what we declare versus what the code actually uses.
 *
 * This exists because the package once declared
 *
 *   "peerDependencies": { "@deepseek-ai/cordis": "*", "@deepseek-ai/dsh-tools": "*" }
 *
 * while importing neither of them. `*` looks permissive and is not: node-semver only
 * lets a prerelease version satisfy a range when some comparator in that range sits on
 * the same major.minor.patch tuple and itself carries a prerelease tag. `*` has no
 * comparator on any tuple, so it excludes every prerelease - and every published
 * version of those packages is a prerelease. The range therefore matched nothing that
 * exists, which is the shape that produces ERESOLVE for the user installing it.
 *
 * Worth knowing while reading this: no range string fixes that in general. `^0.1.0-rc.6`,
 * which is what several published plugins use, matches `0.1.0-rc.6` and excludes
 * `0.1.2-alpha.3`, `0.1.5-rc.1` and `0.1.6-alpha.2` just the same. Only semver's
 * `includePrerelease` option covers them, and an option cannot be written into a range.
 *
 * So the rule this enforces is the only safe one: declare a package only when the code
 * uses it, and when you do, declare it where it can actually resolve.
 *
 *   node test/manifest.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** Every source file we ship. */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(?:m?js)$/.test(entry)) out.push(full)
  }
  return out
}

const files = [...sourceFiles(join(ROOT, 'lib')), ...sourceFiles(join(ROOT, 'bin'))]

/** Bare specifiers imported at runtime, ignoring relative and builtin paths. */
function importedPackages() {
  const found = new Map()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const pattern = /(?:^|[^\w.])(?:import\s[^'"]*?from\s*|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
    let match = pattern.exec(source)
    while (match !== null) {
      const specifier = match[1]
      if (!specifier.startsWith('.') && !specifier.startsWith('node:') && !specifier.startsWith('/')) {
        // A subpath import resolves through the package that owns it.
        const parts = specifier.split('/')
        const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
        if (!found.has(name)) found.set(name, file.slice(ROOT.length + 1))
      }
      match = pattern.exec(source)
    }
  }
  return found
}

console.log('dsh-say manifest check')

const imported = importedPackages()
console.log(`  runtime packages imported: ${[...imported.keys()].join(', ') || '(none)'}`)

console.log('\n1. the bundle manifest is installable')
check('dsh.bundle is declared', Boolean(pkg.dsh?.bundle), JSON.stringify(pkg.dsh))
check('it points at a patch file', typeof pkg.dsh?.bundle?.patch === 'string', String(pkg.dsh?.bundle?.patch))
const patchPath = join(ROOT, pkg.dsh?.bundle?.patch || '')
check('the patch file exists', existsSync(patchPath), pkg.dsh?.bundle?.patch)
if (existsSync(patchPath)) {
  const patch = readFileSync(patchPath, 'utf8')
  check('the patch names this package', patch.includes(pkg.name), pkg.name)
  check('the patch inserts a row', /^\s*-\s*insert:/m.test(patch))
}

console.log('\n2. every package the code imports is declared')
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
])
for (const [name, file] of imported) {
  check(`${name} is declared`, declared.has(name), declared.has(name) ? '' : `imported by ${file}`)
}

console.log('\n3. nothing is declared that the code never uses')
// A declaration the code does not use cannot help it resolve, and a peer that the host
// does not satisfy is exactly the ERESOLVE this file was written about.
for (const name of Object.keys(pkg.peerDependencies || {})) {
  check(`peer "${name}" is actually imported`, imported.has(name), imported.has(name) ? '' : 'declared but never imported')
}
for (const name of Object.keys(pkg.dependencies || {})) {
  check(`dependency "${name}" is actually imported`, imported.has(name), imported.has(name) ? '' : 'declared but never imported')
}

console.log('\n4. no peer range is a bare wildcard')
// `*` and `latest` read as "any version" and mean "no prerelease, ever".
for (const [name, range] of Object.entries(pkg.peerDependencies || {})) {
  check(`peer "${name}" is not "*"`, range !== '*' && range !== '' && range !== 'latest', String(range))
}

console.log('\n5. no build artifacts are sitting in the published tree')
// The tests compile lib/engines/*.py to check they are valid, which leaves a
// __pycache__ behind. .gitignore keeps that out of git and does nothing for npm:
// the `files` whitelist walks straight into it, so a release would carry .pyc files
// compiled for whichever Python happened to run the packer.
//
// This walks every file rather than reusing sourceFiles(), which filters to
// .js/.mjs - against that list the check could never fail, and a guard that cannot
// fail is not a guard. Verified by planting a .pyc and watching it turn red.
function everyFile(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) everyFile(full, out)
    else out.push(full)
  }
  return out
}

const artifacts = []
for (const root of ['lib', 'bin', 'scripts', 'skills', 'soul']) {
  for (const file of everyFile(join(ROOT, root))) {
    if (/\.pyc$/.test(file) || file.includes('__pycache__')) artifacts.push(file.slice(ROOT.length + 1))
  }
}
check('no compiled bytecode under the published directories', artifacts.length === 0, artifacts.join(', '))
check('`files` excludes __pycache__ as a backstop',
  (pkg.files || []).some((entry) => entry.includes('__pycache__')),
  JSON.stringify(pkg.files || []))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
