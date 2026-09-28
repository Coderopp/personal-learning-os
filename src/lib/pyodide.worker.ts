// Runs learner Python in a Web Worker so a runaway loop can be killed without freezing the page.
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs'
const MAX_OUTPUT = 20_000

interface Pyodide {
  loadPackagesFromImports(code: string, opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<void>
  runPythonAsync(code: string, opts?: { globals?: unknown }): Promise<unknown>
  setStdout(o: { batched: (s: string) => void }): void
  setStderr(o: { batched: (s: string) => void }): void
  globals: { get(name: string): () => unknown }
}

const ctx = self as unknown as { onmessage: (e: MessageEvent) => void; postMessage: (m: unknown) => void }
let py: Promise<Pyodide> | null = null

ctx.onmessage = async (e: MessageEvent<{ id: number; code: string }>) => {
  const { id, code } = e.data
  let stdout = ''
  let stderr = ''
  const cap = (s: string, add: string) => (s.length > MAX_OUTPUT ? s : (s + add).slice(0, MAX_OUTPUT))
  try {
    if (!py) {
      ctx.postMessage({ id, status: 'loading' })
      py = import(/* @vite-ignore */ PYODIDE_URL).then((m: { loadPyodide: () => Promise<Pyodide> }) => m.loadPyodide())
    }
    const pyodide = await py
    ctx.postMessage({ id, status: 'installing' })
    // Package-loader chatter ("Loading numpy") is not the learner's output.
    await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: m => { stderr = cap(stderr, `${m}\n`) } })
    pyodide.setStdout({ batched: s => { stdout = cap(stdout, `${s}\n`) } })
    pyodide.setStderr({ batched: s => { stderr = cap(stderr, `${s}\n`) } })
    ctx.postMessage({ id, status: 'running' })
    const started = performance.now()
    // A fresh namespace per run: no state leaks between attempts.
    const ns = pyodide.globals.get('dict')()
    try {
      await pyodide.runPythonAsync(code, { globals: ns })
    } catch (err) {
      // Drop Pyodide's own frames: the traceback should start at the learner's code.
      const msg = String((err as Error).message ?? err)
      const at = msg.indexOf('  File "<exec>"')
      stderr = cap(stderr, at >= 0 ? `Traceback (most recent call last):\n${msg.slice(at)}` : msg)
    }
    ctx.postMessage({ id, status: 'done', stdout, stderr, runtime_ms: Math.round(performance.now() - started) })
  } catch (err) {
    py = null
    ctx.postMessage({ id, status: 'error', stdout, stderr: `Python failed to load: ${(err as Error).message}` })
  }
}
