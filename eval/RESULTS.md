# DealScout Accuracy Eval — v1, 2026-11-06

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via `node eval/run-eval.mjs <base-url> --label v1`.
Raw rows, profiles included: [results/v1.json](results/v1.json).

Agent: `claude-sonnet-4-6`, effort `medium`.

**Overall: 15/15 fields correct (100%)**
· 5 runs, 0 failed
· median 212 s per run
· $1.198 total, median $0.242 per run

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches |
|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 212s | $0.190 | 2 | 3 | 0 |
| Vercel | ✅ | ✅ | ✅ | 82s | $0.301 | 2 | 3 | 3 |
| Airbnb | ✅ | ✅ | ✅ | 259s | $0.242 | 2 | 4 | 0 |
| Shopify | ✅ | ✅ | ✅ | 192s | $0.268 | 2 | 4 | 0 |
| Datadog | ✅ | ✅ | ✅ | 376s | $0.197 | 2 | 3 | 1 |

| field | accuracy |
|---|---|
| website_domain | 5/5 |
| founded_year | 5/5 |
| hq_city | 5/5 |

Notes:
- Fields were chosen for *stability* (a website or founding year doesn't move);
  volatile fields (employee counts, funding) need dated ground truth to grade fairly.
- Cost is computed from the token and web-search counts the API reports on each
  response (lib/pricing.ts); run time is wall clock as seen by this script.
- Failures worth reading: when the agent misses, the profile usually shows *why*
  (e.g. remote-first companies genuinely have ambiguous HQs).
