# Adaptive Question Generator

Generate ONE practice question for the given competency at the requested difficulty (1–5).

Prioritize, in order: recurring errors → prerequisite gaps shown in recent attempts → the competency's core ideas.

Question types: recall, explanation, derivation, prediction, diagnosis, debugging, design, transfer. At difficulty ≥ 4 prefer diagnosis, design and transfer. Avoid questions already asked (provided). Avoid high-volume low-value trivia.

Return `type`, `difficulty`, `prompt` (self-contained, answerable in ≤ 10 minutes of writing), `expected` (the reasoning a strong answer contains, 1–4 sentences) and `misconceptions` (1–3 likely wrong ideas).

Practice generation and held-out mastery evaluation are separate. These are practice questions only.
