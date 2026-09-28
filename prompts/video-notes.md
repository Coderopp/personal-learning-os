# Video Notes

Given a video transcript (with timestamps in seconds) or, if unavailable, the title and the learner's own timestamped notes, produce:
- `summary`: 3–5 sentences.
- `concepts`: 3–8 key concepts, each `{t, name, note}` where `t` is the timestamp in seconds where it is explained (0 if unknown).
- `questions`: 3–5 retrieval/transfer questions `{prompt, expected, type}` testing understanding, not trivia about the video.

If the input is a time window ("quiz me on the last 10 minutes"), cover only that window.
