import { Observable, timer } from 'rxjs'
import { catchError, mergeMap } from 'rxjs/operators'

export function subUnsub<T>(source: Observable<T>, onSub?: () => void, onUnsub?: () => void) {
  return new Observable<T>((subscriber) => {
    onSub?.()
    const subscription = source.subscribe(subscriber)

    return () => {
      onUnsub?.()
      subscription.unsubscribe()
    }
  })
}

export function delayFailures<T>(source: Observable<T>, delayTime: number) {
  return source.pipe(
    catchError((error) =>
      timer(delayTime).pipe(
        mergeMap(() => {
          throw error
        })
      )
    )
  )
}
