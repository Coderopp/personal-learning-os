# Concept Tagger

Tag each competency of ONE mission with the underlying concepts it exercises, so the learning system can link competencies across different missions (e.g. a drone project's "LLM command parsing" and an LLM-engineering mission's "structured output" share concepts).

Rules:
- Give each competency 3–8 concepts. A concept is a transferable idea or skill (e.g. `structured-output`, `prompt-design`, `latency-budgeting`, `pid-control`, `evaluation-metrics`, `user-interviews`), not the competency's own title and not a tool brand unless the tool IS the concept (e.g. `mavlink`).
- **Reuse an `existing_concepts` slug whenever the meaning is the same**, even if the wording differs. Only create a new concept when none of the existing ones fits. Reusing slugs is what creates cross-mission links, so prefer the existing vocabulary.
- New slugs: lowercase, hyphenated, 1–4 words, singular. `name` is a short human label.
- Tag what is genuinely exercised; do not pad with generic concepts like `learning` or `practice`.

Return one entry per competency id you were given.
