# DealScout Accuracy Eval

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via `node eval/run-eval.mjs <base-url> --label <label> [--api v2]`.
Raw rows, profiles included: `eval/results/<label>.json`.

| label | agent | date | fields correct | failed runs | median time | median cost | total cost | saved by caching | claims supported | retried branches |
|---|---|---|---|---|---|---|---|---|---|---|
| v1 | v1: `claude-sonnet-4-6`, effort `medium` | 2026-11-06 | 15/15 (100%) | 0/5 | 212 s | $0.242 | $1.198 | — | — | — |
| v2-haiku | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-haiku-5-5` (medium) | 2026-11-08 | 14/15 (93%) | 0/5 | 27 s | $0.127 | $0.603 | — | 241/242 (100%) | — |
| v2-haiku-sonnet-writer | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-sonnet-5-5` (medium) | 2026-11-08 | 13/15 (87%) | 0/5 | 39 s | $0.162 | $0.812 | — | 239/241 (99%) | — |
| v2-sonnet | v2: planner `claude-haiku-5-5` (low), researcher `claude-sonnet-5-5` (medium), writer `claude-sonnet-5-5` (medium) | 2026-11-08 | 9/15 (60%) | 0/5 | 48 s | $0.531 | $2.703 | — | 64/64 (100%) | — |
| v2-day4 | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-10 | 14/15 (93%) | 0/5 | 46 s | $0.132 | $0.697 | 5.3% | 151/210 (72%) | 3 |
| v2-day4-1-search | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-10 | 12/15 (80%) | 0/5 | 49 s | $0.069 | $0.364 | 16.7% | 150/214 (70%) | 5 |
| v2-day4-memory | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-10 | 13/15 (87%) | 0/5 | 53 s | $0.098 | $0.550 | 5.3% | 95/153 (62%) | 6 |

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

## v2-day4

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $1.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 58s | $0.184 | 14 | 15 | 0 | 35/54 (0 source, 19 quote) |
| Vercel | ✅ | ✅ | ✅ | 46s | $0.113 | 10 | 9 | 2 | 31/37 (0 source, 6 quote) |
| Airbnb | ✅ | ✅ | ❌ | 30s | $0.110 | 10 | 9 | 0 | 28/36 (0 source, 8 quote) |
| Shopify | ✅ | ✅ | ✅ | 66s | $0.159 | 12 | 13 | 1 | 30/45 (0 source, 15 quote) |
| Datadog | ✅ | ✅ | ✅ | 33s | $0.132 | 10 | 11 | 0 | 27/38 (0 source, 11 quote) |

14/15 fields correct. website_domain: 5/5, founded_year: 5/5, hq_city: 4/5.

## v2-day4-1-search

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $0.500.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 47s | $0.072 | 12 | 5 | 2 | 38/46 (0 source, 8 quote) |
| Vercel | ❌ | ✅ | ❌ | 49s | $0.069 | 12 | 5 | 1 | 26/43 (0 source, 17 quote) |
| Airbnb | ✅ | ✅ | ✅ | 59s | $0.088 | 12 | 5 | 1 | 31/44 (0 source, 13 quote) |
| Shopify | ❌ | ✅ | ✅ | 42s | $0.066 | 12 | 5 | 0 | 28/40 (1 source, 11 quote) |
| Datadog | ✅ | ✅ | ✅ | 49s | $0.068 | 12 | 5 | 1 | 27/41 (0 source, 14 quote) |

12/15 fields correct. website_domain: 3/5, founded_year: 5/5, hq_city: 4/5.

## v2-day4-memory

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $1.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 60s | $0.145 | 10 | 12 | 0 | 25/40 (0 source, 15 quote) |
| Vercel | ✅ | ✅ | ❌ | 41s | $0.064 | 9 | 5 | 0 | 12/19 (0 source, 7 quote) |
| Airbnb | ✅ | ❌ | ✅ | 53s | $0.098 | 9 | 8 | 0 | 15/29 (0 source, 14 quote) |
| Shopify | ✅ | ✅ | ✅ | 59s | $0.181 | 12 | 15 | 0 | 30/46 (0 source, 16 quote) |
| Datadog | ✅ | ✅ | ✅ | 33s | $0.062 | 6 | 5 | 0 | 13/19 (0 source, 6 quote) |

13/15 fields correct. website_domain: 5/5, founded_year: 4/5, hq_city: 4/5.

Memory: these runs started from a saved profile.

| company | from version | areas researched | carried over | changed fields |
|---|---|---|---|---|
| Anthropic | 1 | business, funding, news | funding_status, leadership | industry, business_model, products_services, recent_news, deal_signals |
| Vercel | 1 | business, news, funding | website, industry, founded_year, employee_count, business_model, leadership | funding_status, recent_news, deal_signals |
| Airbnb | 1 | news, funding | website, industry, hq_location, business_model, products_services, leadership | funding_status, recent_news, deal_signals |
| Shopify | 1 | business, funding, leadership, news | business_model | employee_count, products_services, funding_status, leadership, recent_news, deal_signals |
| Datadog | 1 | business, news | industry, funding_status, leadership | website, hq_location, employee_count, business_model, products_services, recent_news, deal_signals |

Notes:
- Fields were chosen for *stability* (a website or founding year doesn't move);
  volatile fields (employee counts, funding) need dated ground truth to grade fairly.
- Cost is computed from the token and web-search counts the API reports on each
  response (lib/pricing.ts for v1, agent/app/pricing.py for v2, same table); run
  time is wall clock as seen by the eval script.
- v2 "claims supported": claims that passed the verifier, over all claims the
  researchers reported. Day 3 runs count each branch's final pass and had
  only the source check (the cited URL must be one the run's web tools
  returned). From Day 4 a model also checks that each quote supports its
  value, and every pass counts, retries included, since the writer uses them
  all. The per-company cells say how many failed each check. v1 has no
  claims, so no number.
- "saved by caching": 1 - cost / the same tokens priced with nothing cached.
  Caching doesn't change what the model does, so this is exact for those
  runs, not a comparison between two noisy runs.
- "retried branches": research passes after the first, over all runs.
- Failures worth reading: when the agent misses, the profile usually shows *why*
  (e.g. remote-first companies genuinely have ambiguous HQs).
