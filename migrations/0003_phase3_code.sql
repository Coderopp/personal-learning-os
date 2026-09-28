-- Phase 3.1: code actually run in the browser (Pyodide) is stored with the attempt.
ALTER TABLE attempts ADD COLUMN artifact TEXT;   -- JSON {code, stdout, stderr, runtime_ms, verified}
