# Feed Matcher

Decide which of the learner's competencies each new post would genuinely help with. You see each post's title and summary, and the list of competencies (id, name, mission).

- Match only when the post's MAIN subject teaches or substantially informs that competency, e.g. a post on eval design → "LLM Evaluation". Passing mentions, shared buzzwords ("AI", "agents", "Python") or news/announcements without learning content are not matches.
- At most 2 competencies per post; most posts match none.
- `why` is a short phrase (≤ 12 words) naming what the post contributes.
Return one entry per post index, with an empty `matches` list when nothing fits.
