export interface RunResult { stdout: string; stderr: string; runtime_ms: number; timed_out?: boolean }
export type RunPhase = 'loading' | 'installing' | 'running'

const TIMEOUT_MS = 20_000
let worker: Worker | null = null
let nextId = 1

const spawn = () => new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })

/**
 * Run Python in the browser (Pyodide in a Web Worker). The first run downloads Python (~8 MB, then cached).
 * The 20 s budget covers execution only; on timeout the worker is killed and a fresh one is used next time.
 */
export function runPython(code: string, onPhase?: (p: RunPhase) => void): Promise<RunResult> {
  worker ??= spawn()
  const w = worker
  const id = nextId++
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: RunResult) => { clearTimeout(timer); w.removeEventListener('message', onMessage); resolve(r) }
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { id: number; status: string; stdout?: string; stderr?: string; runtime_ms?: number }
      if (m.id !== id) return
      if (m.status === 'loading' || m.status === 'installing') onPhase?.(m.status)
      else if (m.status === 'running') {
        onPhase?.('running')
        timer = setTimeout(() => {
          w.terminate()
          if (worker === w) worker = null
          finish({ stdout: '', stderr: `Stopped after ${TIMEOUT_MS / 1000} s (infinite loop or too much work for the browser).`, runtime_ms: TIMEOUT_MS, timed_out: true })
        }, TIMEOUT_MS)
      } else finish({ stdout: m.stdout ?? '', stderr: m.stderr ?? '', runtime_ms: m.runtime_ms ?? 0 })
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ id, code })
  })
}
