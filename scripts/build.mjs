import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const sourceDir = path.join(projectRoot, 'src')
const outputDir = path.join(projectRoot, 'lib')
const externalPackages = ['runas']

const entrypoints = await collectFiles(sourceDir, (file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
const cliEntrypoints = entrypoints.filter((file) => file.endsWith('-cli.ts'))
const assetFiles = await collectFiles(sourceDir, (file) => file.endsWith('.in'))

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

const result = await Bun.build({
  entrypoints,
  external: externalPackages,
  format: 'esm',
  outdir: outputDir,
  root: sourceDir,
  sourcemap: 'external',
  target: 'node',
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log.message)
  }

  process.exit(1)
}

for (const sourceFile of cliEntrypoints) {
  const relativePath = path.relative(sourceDir, sourceFile).replace(/\.ts$/, '.js')
  const outputFile = path.join(outputDir, relativePath)
  const outputCode = await readFile(outputFile, 'utf8')

  if (!outputCode.startsWith('#!/usr/bin/env node')) {
    await writeFile(outputFile, `#!/usr/bin/env node\n${outputCode}`, 'utf8')
  }

  await chmod(outputFile, 0o755)
}

for (const sourceFile of assetFiles) {
  const relativePath = path.relative(sourceDir, sourceFile)
  const outputFile = path.join(outputDir, relativePath)

  await mkdir(path.dirname(outputFile), { recursive: true })
  await cp(sourceFile, outputFile)
}

async function collectFiles(dir, includeFile) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const target = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(target, includeFile)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const info = await stat(target)
    if (info.isFile() && includeFile(target)) {
      files.push(target)
    }
  }

  return files
}
