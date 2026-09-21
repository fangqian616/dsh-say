/**
 * Release asset policy check.
 *
 * This exists because getting the policy wrong is destructive and silent: a
 * version that deleted every archive-shaped asset meant uploading the 290 MB ONNX
 * bundle removed the 1.34 GB PyTorch one, and the only sign was a line in the
 * upload log that was easy to read as intended.
 *
 * No token and no network, so it runs with the rest of the suite.
 *
 *   node test/release-assets.mjs
 */

import { ARCHIVE_LIKE, CURRENT_ASSETS, assetsToReplace } from '../scripts/release-assets.mjs'

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('release asset policy check')

console.log('\n1. both published archives are known')
check('the PyTorch bundle is current', CURRENT_ASSETS.includes('sample-full-v2ProPlus.zip'))
check('the ONNX bundle is current', CURRENT_ASSETS.includes('sample-onnx-v2ProPlus.zip'))

console.log('\n2. uploading one archive leaves the other alone')
// The bug this pins: `sample-full-v2ProPlus.zip` matched an archive-shaped pattern,
// so the loop that replaced the uploaded asset also deleted it.
const onRelease = ['sample-full-v2ProPlus.zip', 'sample-onnx-v2ProPlus.zip']
check('uploading ONNX does not touch the full bundle',
  !assetsToReplace(onRelease, 'sample-onnx-v2ProPlus.zip').includes('sample-full-v2ProPlus.zip'),
  assetsToReplace(onRelease, 'sample-onnx-v2ProPlus.zip').join(', ') || '(nothing)')
check('uploading the full bundle does not touch ONNX',
  !assetsToReplace(onRelease, 'sample-full-v2ProPlus.zip').includes('sample-onnx-v2ProPlus.zip'),
  assetsToReplace(onRelease, 'sample-full-v2ProPlus.zip').join(', ') || '(nothing)')

console.log('\n3. re-uploading an archive replaces it rather than adding a second copy')
check('the same name is replaced',
  assetsToReplace(onRelease, 'sample-onnx-v2ProPlus.zip').includes('sample-onnx-v2ProPlus.zip'))

console.log('\n4. a retired name is still removed')
// The de-identification reason: leaving a differently-named old archive behind
// keeps the character-named file downloadable after nothing references it.
check('the character-named archive is retired',
  assetsToReplace([...onRelease, 'silver-wolf-full-v2ProPlus.zip'], 'sample-onnx-v2ProPlus.zip')
    .includes('silver-wolf-full-v2ProPlus.zip'))
check('a retired weights-only archive is retired too',
  assetsToReplace(['silver-wolf-weights-v2ProPlus.zip'], 'sample-onnx-v2ProPlus.zip')
    .includes('silver-wolf-weights-v2ProPlus.zip'))

console.log('\n5. an unrelated asset is never deleted')
check('a non-archive asset is left alone',
  !assetsToReplace(['notes.txt', 'source.tar.gz'], 'sample-onnx-v2ProPlus.zip').includes('notes.txt'))
check('a checksum file is left alone',
  assetsToReplace(['sample-onnx-v2ProPlus.sha256.txt'], 'sample-onnx-v2ProPlus.zip').length === 0)

console.log('\n6. the pattern matches what it claims to')
check('a sample-prefixed archive matches', ARCHIVE_LIKE.test('sample-anything.zip'))
check('a silver-wolf archive matches', ARCHIVE_LIKE.test('silver-wolf-full-v2ProPlus.zip'))
check('an unrelated archive does not match', !ARCHIVE_LIKE.test('some-other-project.zip'))
check('a directory-shaped name does not match', !ARCHIVE_LIKE.test('sample/'))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
