/**
 * Entry-point checks. Run: node test/entry.mjs
 *
 * The plugin once shipped with `import { ... } from './lib/config.js'` inside
 * `lib/index.js` - the paths were written while the file sat at the repository root
 * and never updated when it moved into `lib/`. Every relative import therefore
 * resolved to `lib/lib/...`, which does not exist, so the module threw on load and
 * the plugin mounted nothing at all. No other test noticed: the bundle checks prove
 * the loader can find and parse the patch, and the other tests import the leaf
 * modules directly, so the one file that has to load first was never loaded.
 *
 * These checks walk the entry point's own import graph. They need no runtime and no
 * dependencies, because they only ask whether each path resolves to a real file.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entry = manifest.main

console.log('entry-point checks\n')
console.log('1. the manifest points at a file that exists')
check('main is declared', typeof entry === 'string' && entry.length > 0, String(entry))
const entryPath = join(root, entry)
check('the entry file exists', existsSync(entryPath), entry)

console.log('\n2. every relative import in the graph resolves')
// Only relative specifiers are checked: a bare package name is a dependency, and
// whether it is installed is the deployment's business, not this test's.
const RELATIVE = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g
const seen = new Set()
const broken = []
const queue = [entryPath]

while (queue.length > 0) {
  const file = queue.pop()
  if (seen.has(file) || !existsSync(file)) continue
  seen.add(file)
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(RELATIVE)) {
    const specifier = match[1] ?? match[2]
    const target = resolve(dirname(file), specifier)
    if (!existsSync(target)) {
      broken.push(`${file.slice(root.length + 1)} imports '${specifier}' -> missing ${target.slice(root.length + 1)}`)
      continue
    }
    queue.push(target)
  }
}

check('the graph has more than the entry file', seen.size > 1, `${seen.size} files`)
check('no relative import dangles', broken.length === 0, broken.slice(0, 4).join(' | '))
console.log(`     walked ${seen.size} file(s) from ${entry}`)

console.log('\n3. each file it reaches is a readable file, not a directory')
for (const file of [...seen].sort()) {
  check(file.slice(root.length + 1), statSync(file).isFile())
}

console.log('\n4. the tool definitions are what ctx.tools.register accepts')
// The second way this plugin failed to mount: the definitions were wrapped in
// `defineTool` from @deepseek-ai/dsh-tools, which takes its own parameterSchemaSpec
// DSL and rejects JSON Schema with "parameters.type must be a value schema object".
// That throws while loading, so no tool ever registered. Registration takes plain
// JSON Schema, which is what these checks pin.
// A dynamic import needs a file:// URL on Windows; a bare path is rejected with
// ERR_UNSUPPORTED_ESM_URL_SCHEME.
const { defineTools } = await import(pathToFileURL(join(root, 'lib', 'tools.js')).href)
const tools = defineTools()
check('it defines tools', Array.isArray(tools) && tools.length > 0, `${tools.length} tool(s)`)
for (const tool of tools) {
  const name = tool?.name ?? '(unnamed)'
  check(`${name}: has a description`, typeof tool?.description === 'string' && tool.description.length > 20)
  check(`${name}: parameters are JSON Schema`,
    tool?.parameters?.type === 'object' && typeof tool.parameters.properties === 'object',
    `type=${JSON.stringify(tool?.parameters?.type)}`)
  // A function anywhere in the schema is the DSL leaking back in, and the registry
  // would reject it at load.
  const hasFunction = (value) => {
    if (typeof value === 'function') return true
    if (Array.isArray(value)) return value.some(hasFunction)
    if (value !== null && typeof value === 'object') return Object.values(value).some(hasFunction)
    return false
  }
  check(`${name}: the schema carries no functions`, !hasFunction(tool?.parameters))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
