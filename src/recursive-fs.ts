import { mkdirSync, rmSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'

export function mkdirpSync(dir: string) {
  mkdirSync(dir, { recursive: true })
}

export async function mkdirp(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  return dir
}

export function rimrafSync(dir: string) {
  rmSync(dir, { force: true, recursive: true })
}

export async function rimraf(dir: string): Promise<void> {
  await rm(dir, { force: true, recursive: true })
}
