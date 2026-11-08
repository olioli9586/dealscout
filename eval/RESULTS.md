# DealScout Accuracy Eval

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via `node eval/run-eval.mjs <base-url> --label <label> [--api v2]`.
Raw rows, profiles included: `eval/results/<label>.json`.

| label | agent | date | fields correct | failed runs | median time | median cost | total cost | claims supported |
|---|---|---|---|---|---|---|---|---|
| v1 | v1: `claude-sonnet-4-6`, effort `medium` | 2026-11-06 | 15/15 (100%) | 0/5 | 212 s | $0.242 | $1.198 | — |
| v2-haiku | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-haiku-5-5` (medium) | 2026-11-08 | 14/15 (93%) | 0/5 | 27 s | $0.127 | $0.603 | 241/242 (100%) |
| v2-haiku-sonnet-writer | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-sonnet-5-5` (medium) | 2026-11-08 | 13/15 (87%) | 0/5 | 39 s | $0.162 | $0.812 | 239/241 (99%) |
| v2-sonnet | v2: planner `claude-haiku-5-5` (low), researcher `claude-sonnet-5-5` (medium), writer `claude-sonnet-5-5` (medium) | 2026-11-08 | 9/15 (60%) | 0/5 | 48 s | $0.531 | $2.703 | 64/64 (100%) |

## v1

Agent: v1, `claude-sonnet-4-6`, effort `medium`. Base: `http://localhost:3100`. Spend cap: $5.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 212s | $0.190 | 2 | 3 | 0 | — |
| Vercel | ✅ | ✅ | ✅ | 82s | $0.301 | 2 | 3 | 3 | — |
| Airbnb | ✅ | ✅ | ✅ | 259s | $0.242 | 2 | 4 | 0 | — |
| Shopify | ✅ | ✅ | ✅ | 192s | $0.268 | 2 | 4 | 0 | — |
| Datadog | ✅ | ✅ | ✅ | 376s | $0.197 | 2 | 3 | 1 | — |

15/15 fields correct. website_domain: 5/5, founded_year: 5/5, hq_city: 5/5.

## v2-haiku

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-haiku-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $1.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 34s | $0.127 | 6 | 10 | 1 | 58/58 |
| Vercel | ✅ | ✅ | ✅ | 38s | $0.131 | 6 | 10 | 3 | 49/49 |
| Airbnb | ❌ | ✅ | ✅ | 27s | $0.100 | 6 | 8 | 1 | 57/57 |
| Shopify | ✅ | ✅ | ✅ | 26s | $0.139 | 6 | 11 | 1 | 39/40 |
| Datadog | ✅ | ✅ | ✅ | 25s | $0.106 | 6 | 8 | 3 | 38/38 |

14/15 fields correct. website_domain: 4/5, founded_year: 5/5, hq_city: 5/5.

## v2-haiku-sonnet-writer

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-sonnet-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $1.500.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 37s | $0.162 | 6 | 10 | 2 | 56/56 |
| Vercel | ✅ | ✅ | ✅ | 51s | $0.159 | 7 | 9 | 5 | 55/55 |
| Airbnb | ❌ | ✅ | ✅ | 58s | $0.151 | 7 | 9 | 1 | 40/42 |
| Shopify | ❌ | ✅ | ✅ | 39s | $0.175 | 6 | 11 | 2 | 43/43 |
| Datadog | ✅ | ✅ | ✅ | 32s | $0.166 | 6 | 11 | 2 | 45/45 |

13/15 fields correct. website_domain: 3/5, founded_year: 5/5, hq_city: 5/5.

## v2-sonnet

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-sonnet-5-5` (medium), writer `claude-sonnet-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $3.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ❌ | ✅ | ✅ | 38s | $0.531 | 7 | 11 | 2 | 14/14 |
| Vercel | ❌ | ✅ | ❌ | 48s | $0.514 | 7 | 11 | 3 | 14/14 |
| Airbnb | ❌ | ✅ | ✅ | 48s | $0.586 | 7 | 14 | 1 | 14/14 |
| Shopify | ❌ | ✅ | ✅ | 48s | $0.570 | 7 | 11 | 2 | 10/10 |
| Datadog | ❌ | ✅ | ✅ | 41s | $0.503 | 7 | 11 | 2 | 12/12 |

9/15 fields correct. website_domain: 0/5, founded_year: 5/5, hq_city: 4/5.

Notes:
- Fields were chosen for *stability* (a website or founding year doesn't move);
  volatile fields (employee counts, funding) need dated ground truth to grade fairly.
- Cost is computed from the token and web-search counts the API reports on each
  response (lib/pricing.ts for v1, agent/app/pricing.py for v2, same table); run
  time is wall clock as seen by the eval script.
- v2 "claims supported": claims whose source URL is one the run's web tools
  actually returned, over all claims the researchers reported (the final pass
  of each branch). v1 has no claims, so no number.
- Failures worth reading: when the agent misses, the profile usually shows *why*
  (e.g. remote-first companies genuinely have ambiguous HQs).
