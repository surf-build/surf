import { statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'

export function asyncMap<T, TRet>(
  array: T[],
  selector: (x: T) => Promise<TRet>,
  maxConcurrency = 4
): Promise<Map<T, TRet>> {
  return new Promise<Map<T, TRet>>((resolve, reject) => {
    const results = new Map<T, TRet>()
    let index = 0
    let activeCount = 0

    const runNext = () => {
      if (index >= array.length && activeCount === 0) {
        resolve(results)
        return
      }

      while (activeCount < maxConcurrency && index < array.length) {
        const item = array[index++]
        activeCount++

        selector(item)
          .then((value) => {
            results.set(item, value)
            activeCount--
            runNext()
          })
          .catch(reject)
      }
    }

    runNext()
  })
}

export async function asyncReduce<T, TAcc>(array: T[], selector: (acc: TAcc, x: T) => Promise<TAcc>, seed: TAcc) {
  let acc = seed
  for (const x of array) {
    acc = await selector(acc, x)
  }

  return acc
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function retryPromise(func: () => Promise<any>, count = 3) {
  return retryPromiseInternal(func, count)
}

export async function statNoException(file: string) {
  try {
    return await stat(file)
  } catch (_e) {
    return null
  }
}

export function statSyncNoException(file: string) {
  try {
    return statSync(file)
  } catch (_e) {
    return null
  }
}

export async function readdirRecursive(dir: string): Promise<string[]> {
  const acc: string[] = []

  for (const entry of await readdir(dir)) {
    const target = path.resolve(dir, entry)
    const stat = await statNoException(target)

    if (stat?.isDirectory()) {
      const entries = await readdirRecursive(target)
      entries.forEach((x) => {
        acc.push(x)
      })
    } else {
      acc.push(target)
    }
  }

  return acc
}

export function uniq(list: string[]): string[] {
  return Object.keys(
    list.reduce((acc, x) => {
      acc[x] = true
      return acc
    }, {})
  )
}

async function retryPromiseInternal<T>(func: () => Promise<T>, count: number): Promise<T> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= count; attempt++) {
    try {
      return await func()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}
