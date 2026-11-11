# DealScout Accuracy Eval

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via `node eval/run-eval.mjs <base-url> --label <label> [--api v2]`.
Raw rows, profiles included: `eval/results/<label>.json`.

| label | agent | date | fields correct | failed runs | median time | runs over 300 s | median cost | total cost | median model requests | median searches | saved by caching | claims supported | retried branches |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| v1 | v1: `claude-sonnet-4-6`, effort `medium` | 2026-11-06 | 15/15 (100%) | 0/5 | 212 s | 1/5 | $0.242 | $1.198 | 2 | 3 | — | — | — |
| v2-haiku | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-haiku-5-5` (medium) | 2026-11-08 | 14/15 (93%) | 0/5 | 27 s | 0/5 | $0.127 | $0.603 | 6 | 10 | — | 241/242 (100%) | — |
| v2-haiku-sonnet-writer | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), writer `claude-sonnet-5-5` (medium) | 2026-11-08 | 13/15 (87%) | 0/5 | 39 s | 0/5 | $0.162 | $0.812 | 6 | 10 | — | 239/241 (99%) | — |
| v2-sonnet | v2: planner `claude-haiku-5-5` (low), researcher `claude-sonnet-5-5` (medium), writer `claude-sonnet-5-5` (medium) | 2026-11-08 | 9/15 (60%) | 0/5 | 48 s | 0/5 | $0.531 | $2.703 | 7 | 11 | — | 64/64 (100%) | — |
| v2-day4 | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-10 | 14/15 (93%) | 0/5 | 46 s | 0/5 | $0.132 | $0.697 | 10 | 11 | 5.3% | 151/210 (72%) | 3 |
| v2-day4-1-search | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-10 | 12/15 (80%) | 0/5 | 49 s | 0/5 | $0.069 | $0.364 | 12 | 5 | 16.7% | 150/214 (70%) | 5 |
| v2-day4-memory | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-10 | 13/15 (87%) | 0/5 | 53 s | 0/5 | $0.098 | $0.550 | 9 | 8 | 5.3% | 95/153 (62%) | 6 |
| v1-48 | v1: `claude-sonnet-4-6`, effort `medium` | 2026-11-11 | 142/144 (99%) | 0/48 | 226.5 s | 11/48 | $0.248 | $13.197 | 2 | 3 | — | — | — |
| v1-48-haiku | v1: `claude-haiku-5-5`, effort `medium` | 2026-11-11 | 137/144 (95%) | 0/48 | 22 s | 0/48 | $0.030 | $1.866 | 2 | 2 | — | — | — |
| v2-48 | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-11 | 132/144 (92%) | 0/48 | 47.5 s | 0/48 | $0.134 | $6.549 | 12 | 11 | 5.9% | 1397/1996 (70%) | 28 |
| v2-48-verifier-fix | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-11 | 138/144 (96%) | 0/48 | 36 s | 0/48 | $0.125 | $6.457 | 10 | 10 | 5.3% | 1406/2018 (70%) | 27 |
| v2-day6-originals | v2: planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium) | 2026-11-11 | 15/15 (100%) | 0/5 | 37 s | 0/5 | $0.122 | $0.628 | 11 | 10 | 8.0% | 144/198 (73%) | 2 |

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

## v1-48

Agent: v1, `claude-sonnet-4-6`, effort `medium`. Base: `http://localhost:3100`. Spend cap: $2.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 264s | $0.205 | 2 | 3 | 0 | — |
| Vercel | ✅ | ✅ | ✅ | 345s | $0.190 | 2 | 3 | 1 | — |
| Airbnb | ✅ | ✅ | ✅ | 259s | $0.238 | 2 | 4 | 0 | — |
| Shopify | ✅ | ✅ | ✅ | 243s | $0.180 | 2 | 3 | 0 | — |
| Datadog | ✅ | ✅ | ✅ | 456s | $0.304 | 2 | 3 | 3 | — |
| Cloudflare | ✅ | ✅ | ✅ | 210s | $0.606 | 2 | 4 | 3 | — |
| Twilio | ✅ | ✅ | ✅ | 91s | $0.366 | 2 | 4 | 3 | — |
| HubSpot | ✅ | ✅ | ✅ | 380s | $0.378 | 2 | 3 | 3 | — |
| Duolingo | ✅ | ✅ | ✅ | 152s | $0.186 | 2 | 3 | 0 | — |
| Toast | ✅ | ✅ | ✅ | 258s | $0.233 | 2 | 4 | 0 | — |
| Etsy | ✅ | ✅ | ✅ | 403s | $0.534 | 2 | 4 | 1 | — |
| Robinhood | ✅ | ✅ | ✅ | 374s | $0.319 | 2 | 3 | 3 | — |
| DoorDash | ✅ | ✅ | ✅ | 274s | $0.478 | 2 | 4 | 1 | — |
| Rivian | ✅ | ✅ | ✅ | 174s | $0.230 | 2 | 4 | 0 | — |
| Samsara | ✅ | ✅ | ✅ | 521s | $0.263 | 2 | 2 | 3 | — |
| MongoDB | ✅ | ✅ | ✅ | 490s | $0.413 | 2 | 4 | 3 | — |
| Okta | ✅ | ✅ | ✅ | 255s | $0.237 | 2 | 4 | 0 | — |
| Spotify | ✅ | ✅ | ✅ | 367s | $0.295 | 2 | 3 | 3 | — |
| Adyen | ✅ | ✅ | ✅ | 249s | $0.187 | 2 | 3 | 0 | — |
| Wise | ✅ | ✅ | ✅ | 264s | $0.262 | 2 | 4 | 1 | — |
| Klarna | ✅ | ✅ | ✅ | 176s | $0.284 | 2 | 4 | 1 | — |
| Canva | ✅ | ✅ | ✅ | 170s | $0.207 | 2 | 3 | 0 | — |
| Revolut | ✅ | ✅ | ✅ | 154s | $0.181 | 2 | 3 | 0 | — |
| Monzo | ✅ | ✅ | ✅ | 250s | $0.190 | 2 | 3 | 0 | — |
| N26 | ✅ | ✅ | ✅ | 185s | $0.412 | 2 | 3 | 3 | — |
| Celonis | ✅ | ✅ | ✅ | 152s | $0.181 | 2 | 3 | 0 | — |
| Mistral AI | ✅ | ✅ | ✅ | 179s | $0.330 | 2 | 3 | 3 | — |
| Cohere | ✅ | ✅ | ✅ | 165s | $0.254 | 2 | 4 | 0 | — |
| Nubank | ✅ | ✅ | ✅ | 177s | $0.247 | 2 | 4 | 0 | — |
| Grab | ✅ | ✅ | ✅ | 96s | $0.336 | 2 | 3 | 3 | — |
| Brex | ✅ | ✅ | ✅ | 346s | $0.250 | 2 | 2 | 2 | — |
| Ramp | ✅ | ✅ | ✅ | 161s | $0.187 | 2 | 3 | 0 | — |
| Plaid | ✅ | ✅ | ✅ | 365s | $0.264 | 2 | 2 | 3 | — |
| Rippling | ✅ | ✅ | ✅ | 171s | $0.317 | 2 | 3 | 3 | — |
| Vanta | ✅ | ✅ | ✅ | 251s | $0.229 | 2 | 4 | 0 | — |
| Retool | ✅ | ✅ | ✅ | 157s | $0.231 | 2 | 3 | 2 | — |
| Figma | ✅ | ✅ | ✅ | 156s | $0.188 | 2 | 3 | 0 | — |
| Notion | ✅ | ✅ | ✅ | 179s | $0.351 | 2 | 3 | 3 | — |
| Databricks | ✅ | ✅ | ✅ | 179s | $0.363 | 2 | 3 | 3 | — |
| Scale AI | ✅ | ✅ | ✅ | 352s | $0.221 | 2 | 2 | 2 | — |
| Anduril | ✅ | ✅ | ✅ | 163s | $0.199 | 2 | 3 | 0 | — |
| Perplexity | ✅ | ✅ | ✅ | 204s | $0.374 | 2 | 3 | 3 | — |
| Gusto | ✅ | ❌ | ✅ | 156s | $0.181 | 2 | 3 | 0 | — |
| Modal | ✅ | ✅ | ✅ | 253s | $0.192 | 2 | 3 | 0 | — |
| Replit | ✅ | ✅ | ❌ | 254s | $0.188 | 2 | 3 | 0 | — |
| Harvey | ✅ | ✅ | ✅ | 90s | $0.298 | 2 | 3 | 3 | — |
| Hex | ✅ | ✅ | ✅ | 175s | $0.255 | 2 | 3 | 2 | — |
| Glean | ✅ | ✅ | ✅ | 245s | $0.187 | 2 | 3 | 0 | — |

142/144 fields correct. website_domain: 48/48, founded_year: 47/48, hq_city: 47/48.

## v1-48-haiku

Agent: v1, `claude-haiku-5-5`, effort `medium`. Base: `http://localhost:3100`. Spend cap: $6.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 42s | $0.043 | 2 | 3 | 1 | — |
| Vercel | ✅ | ✅ | ✅ | 35s | $0.042 | 2 | 3 | 0 | — |
| Airbnb | ✅ | ✅ | ✅ | 43s | $0.045 | 2 | 3 | 1 | — |
| Shopify | ✅ | ✅ | ✅ | 27s | $0.108 | 2 | 3 | 1 | — |
| Datadog | ✅ | ✅ | ✅ | 25s | $0.028 | 2 | 2 | 0 | — |
| Cloudflare | ✅ | ✅ | ✅ | 19s | $0.039 | 2 | 3 | 0 | — |
| Twilio | ✅ | ✅ | ✅ | 22s | $0.027 | 2 | 2 | 0 | — |
| HubSpot | ✅ | ✅ | ✅ | 33s | $0.029 | 2 | 2 | 0 | — |
| Duolingo | ✅ | ✅ | ✅ | 22s | $0.041 | 2 | 3 | 0 | — |
| Toast | ✅ | ✅ | ✅ | 19s | $0.041 | 2 | 3 | 0 | — |
| Etsy | ✅ | ✅ | ✅ | 36s | $0.301 | 2 | 3 | 1 | — |
| Robinhood | ✅ | ✅ | ✅ | 20s | $0.006 | 2 | 0 | 0 | — |
| DoorDash | ✅ | ✅ | ✅ | 16s | $0.027 | 2 | 2 | 0 | — |
| Rivian | ✅ | ✅ | ✅ | 19s | $0.039 | 2 | 3 | 0 | — |
| Samsara | ✅ | ✅ | ✅ | 20s | $0.017 | 2 | 1 | 0 | — |
| MongoDB | ✅ | ✅ | ✅ | 16s | $0.027 | 2 | 2 | 0 | — |
| Okta | ✅ | ✅ | ✅ | 17s | $0.027 | 2 | 2 | 0 | — |
| Spotify | ✅ | ✅ | ✅ | 23s | $0.029 | 2 | 2 | 0 | — |
| Adyen | ✅ | ✅ | ✅ | 19s | $0.031 | 2 | 2 | 1 | — |
| Wise | ✅ | ✅ | ✅ | 37s | $0.031 | 2 | 2 | 0 | — |
| Klarna | ❌ | ❌ | ❌ | 14s | $0.005 | 2 | 0 | 0 | — |
| Canva | ✅ | ✅ | ✅ | 20s | $0.042 | 2 | 3 | 0 | — |
| Revolut | ✅ | ✅ | ✅ | 23s | $0.042 | 2 | 3 | 0 | — |
| Monzo | ✅ | ✅ | ✅ | 16s | $0.014 | 2 | 1 | 0 | — |
| N26 | ✅ | ✅ | ✅ | 25s | $0.042 | 2 | 3 | 0 | — |
| Celonis | ✅ | ✅ | ✅ | 17s | $0.027 | 2 | 2 | 0 | — |
| Mistral AI | ✅ | ✅ | ✅ | 19s | $0.028 | 2 | 2 | 0 | — |
| Cohere | ✅ | ✅ | ✅ | 30s | $0.030 | 2 | 2 | 1 | — |
| Nubank | ✅ | ✅ | ✅ | 24s | $0.030 | 2 | 2 | 0 | — |
| Grab | ✅ | ✅ | ✅ | 20s | $0.041 | 2 | 3 | 0 | — |
| Brex | ✅ | ✅ | ✅ | 30s | $0.043 | 2 | 3 | 0 | — |
| Ramp | ❌ | ❌ | ❌ | 16s | $0.005 | 2 | 0 | 0 | — |
| Plaid | ✅ | ✅ | ✅ | 20s | $0.030 | 2 | 2 | 1 | — |
| Rippling | ✅ | ✅ | ✅ | 23s | $0.039 | 2 | 3 | 0 | — |
| Vanta | ✅ | ✅ | ✅ | 19s | $0.041 | 2 | 3 | 0 | — |
| Retool | ✅ | ✅ | ✅ | 22s | $0.082 | 2 | 2 | 2 | — |
| Figma | ✅ | ✅ | ✅ | 26s | $0.030 | 2 | 2 | 1 | — |
| Notion | ✅ | ✅ | ✅ | 33s | $0.029 | 2 | 2 | 0 | — |
| Databricks | ✅ | ✅ | ✅ | 29s | $0.029 | 2 | 2 | 0 | — |
| Scale AI | ✅ | ✅ | ✅ | 18s | $0.015 | 2 | 1 | 0 | — |
| Anduril | ✅ | ✅ | ✅ | 21s | $0.041 | 2 | 3 | 0 | — |
| Perplexity | ✅ | ✅ | ✅ | 35s | $0.033 | 2 | 2 | 1 | — |
| Gusto | ✅ | ✅ | ✅ | 21s | $0.028 | 2 | 2 | 0 | — |
| Modal | ✅ | ✅ | ❌ | 28s | $0.027 | 2 | 2 | 2 | — |
| Replit | ✅ | ✅ | ✅ | 21s | $0.031 | 2 | 2 | 0 | — |
| Harvey | ✅ | ✅ | ✅ | 26s | $0.028 | 2 | 2 | 0 | — |
| Hex | ✅ | ✅ | ✅ | 23s | $0.029 | 2 | 2 | 0 | — |
| Glean | ✅ | ✅ | ✅ | 19s | $0.028 | 2 | 2 | 0 | — |

137/144 fields correct. website_domain: 46/48, founded_year: 46/48, hq_city: 45/48.

## v2-48

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $9.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 53s | $0.161 | 12 | 13 | 2 | 31/46 (0 source, 15 quote) |
| Vercel | ✅ | ✅ | ✅ | 58s | $0.182 | 14 | 15 | 1 | 29/47 (0 source, 18 quote) |
| Airbnb | ✅ | ✅ | ✅ | 29s | $0.113 | 10 | 9 | 0 | 26/36 (0 source, 10 quote) |
| Shopify | ✅ | ✅ | ✅ | 33s | $0.132 | 10 | 11 | 0 | 23/35 (0 source, 12 quote) |
| Datadog | ✅ | ✅ | ✅ | 50s | $0.145 | 12 | 12 | 0 | 30/45 (0 source, 15 quote) |
| Cloudflare | ✅ | ✅ | ✅ | 60s | $0.158 | 12 | 13 | 1 | 31/45 (0 source, 14 quote) |
| Twilio | ✅ | ✅ | ✅ | 29s | $0.120 | 10 | 10 | 0 | 24/35 (0 source, 11 quote) |
| HubSpot | ✅ | ✅ | ✅ | 27s | $0.121 | 10 | 10 | 0 | 23/34 (0 source, 11 quote) |
| Duolingo | ✅ | ✅ | ✅ | 30s | $0.109 | 10 | 9 | 0 | 22/32 (2 source, 8 quote) |
| Toast | ✅ | ✅ | ❌ | 26s | $0.097 | 10 | 8 | 0 | 25/36 (0 source, 11 quote) |
| Etsy | ❌ | ✅ | ✅ | 54s | $0.155 | 12 | 13 | 0 | 26/40 (0 source, 14 quote) |
| Robinhood | ✅ | ✅ | ✅ | 73s | $0.161 | 13 | 13 | 0 | 35/48 (0 source, 13 quote) |
| DoorDash | ✅ | ✅ | ❌ | 27s | $0.119 | 10 | 10 | 0 | 25/33 (0 source, 8 quote) |
| Rivian | ✅ | ✅ | ✅ | 52s | $0.157 | 12 | 13 | 1 | 33/46 (2 source, 11 quote) |
| Samsara | ✅ | ✅ | ❌ | 83s | $0.163 | 13 | 13 | 0 | 35/48 (0 source, 13 quote) |
| MongoDB | ✅ | ✅ | ✅ | 41s | $0.109 | 10 | 9 | 0 | 26/36 (1 source, 9 quote) |
| Okta | ✅ | ✅ | ❌ | 54s | $0.156 | 12 | 13 | 0 | 32/45 (0 source, 13 quote) |
| Spotify | ✅ | ✅ | ✅ | 53s | $0.158 | 12 | 13 | 1 | 31/45 (0 source, 14 quote) |
| Adyen | ✅ | ✅ | ✅ | 58s | $0.137 | 12 | 11 | 1 | 33/48 (0 source, 15 quote) |
| Wise | ✅ | ✅ | ✅ | 29s | $0.110 | 10 | 9 | 0 | 27/36 (0 source, 9 quote) |
| Klarna | ✅ | ✅ | ✅ | 33s | $0.111 | 10 | 9 | 1 | 27/37 (0 source, 10 quote) |
| Canva | ✅ | ✅ | ❌ | 27s | $0.123 | 10 | 10 | 2 | 25/36 (0 source, 11 quote) |
| Revolut | ✅ | ✅ | ✅ | 55s | $0.136 | 12 | 11 | 1 | 37/51 (0 source, 14 quote) |
| Monzo | ✅ | ✅ | ✅ | 30s | $0.110 | 10 | 9 | 0 | 21/37 (3 source, 13 quote) |
| N26 | ✅ | ✅ | ✅ | 77s | $0.176 | 15 | 14 | 2 | 33/53 (0 source, 20 quote) |
| Celonis | ✅ | ✅ | ❌ | 25s | $0.109 | 10 | 9 | 0 | 26/38 (0 source, 12 quote) |
| Mistral AI | ✅ | ✅ | ✅ | 73s | $0.139 | 13 | 11 | 0 | 38/47 (0 source, 9 quote) |
| Cohere | ✅ | ✅ | ✅ | 51s | $0.146 | 12 | 12 | 0 | 28/46 (0 source, 18 quote) |
| Nubank | ✅ | ✅ | ❌ | 33s | $0.121 | 10 | 10 | 0 | 25/35 (1 source, 9 quote) |
| Grab | ❌ | ✅ | ✅ | 68s | $0.237 | 14 | 17 | 2 | 23/52 (1 source, 28 quote) |
| Brex | ✅ | ✅ | ✅ | 27s | $0.120 | 10 | 10 | 0 | 24/35 (0 source, 11 quote) |
| Ramp | ✅ | ✅ | ✅ | 47s | $0.156 | 12 | 13 | 0 | 30/46 (0 source, 16 quote) |
| Plaid | ✅ | ✅ | ✅ | 70s | $0.148 | 13 | 12 | 0 | 36/46 (0 source, 10 quote) |
| Rippling | ✅ | ✅ | ✅ | 34s | $0.120 | 10 | 10 | 0 | 25/36 (0 source, 11 quote) |
| Vanta | ✅ | ✅ | ✅ | 27s | $0.109 | 10 | 9 | 0 | 25/35 (0 source, 10 quote) |
| Retool | ✅ | ✅ | ✅ | 32s | $0.123 | 10 | 10 | 2 | 37/40 (0 source, 3 quote) |
| Figma | ✅ | ✅ | ✅ | 59s | $0.147 | 12 | 12 | 1 | 32/50 (0 source, 18 quote) |
| Notion | ✅ | ✅ | ✅ | 33s | $0.121 | 10 | 10 | 1 | 33/41 (1 source, 7 quote) |
| Databricks | ✅ | ✅ | ✅ | 48s | $0.135 | 12 | 11 | 0 | 36/49 (0 source, 13 quote) |
| Scale AI | ✅ | ❌ | ✅ | 34s | $0.134 | 10 | 11 | 1 | 23/36 (0 source, 13 quote) |
| Anduril | ✅ | ✅ | ✅ | 53s | $0.158 | 12 | 13 | 0 | 35/47 (0 source, 12 quote) |
| Perplexity | ✅ | ✅ | ✅ | 52s | $0.161 | 12 | 13 | 2 | 35/45 (0 source, 10 quote) |
| Gusto | ✅ | ✅ | ✅ | 68s | $0.151 | 12 | 12 | 2 | 29/45 (0 source, 16 quote) |
| Modal | ✅ | ✅ | ✅ | 31s | $0.109 | 10 | 9 | 0 | 27/36 (0 source, 9 quote) |
| Replit | ❌ | ✅ | ✅ | 31s | $0.109 | 10 | 9 | 0 | 26/38 (0 source, 12 quote) |
| Harvey | ✅ | ✅ | ✅ | 55s | $0.137 | 12 | 11 | 2 | 37/49 (0 source, 12 quote) |
| Hex | ✅ | ✅ | ✅ | 30s | $0.109 | 10 | 9 | 3 | 24/31 (0 source, 7 quote) |
| Glean | ✅ | ✅ | ❌ | 53s | $0.134 | 12 | 11 | 0 | 33/43 (0 source, 10 quote) |

132/144 fields correct. website_domain: 45/48, founded_year: 47/48, hq_city: 40/48.

## v2-48-verifier-fix

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $9.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 60s | $0.162 | 12 | 13 | 0 | 33/49 (0 source, 16 quote) |
| Vercel | ✅ | ✅ | ✅ | 52s | $0.185 | 14 | 15 | 0 | 37/53 (0 source, 16 quote) |
| Airbnb | ✅ | ✅ | ✅ | 26s | $0.134 | 10 | 11 | 0 | 26/38 (0 source, 12 quote) |
| Shopify | ✅ | ✅ | ✅ | 57s | $0.145 | 12 | 12 | 1 | 30/46 (1 source, 15 quote) |
| Datadog | ✅ | ✅ | ✅ | 30s | $0.109 | 10 | 9 | 0 | 28/37 (0 source, 9 quote) |
| Cloudflare | ✅ | ✅ | ✅ | 28s | $0.120 | 10 | 10 | 0 | 26/39 (0 source, 13 quote) |
| Twilio | ✅ | ✅ | ✅ | 58s | $0.157 | 12 | 13 | 1 | 29/40 (0 source, 11 quote) |
| HubSpot | ✅ | ✅ | ✅ | 59s | $0.159 | 12 | 13 | 0 | 30/47 (0 source, 17 quote) |
| Duolingo | ✅ | ✅ | ✅ | 57s | $0.160 | 12 | 13 | 2 | 30/48 (1 source, 17 quote) |
| Toast | ✅ | ✅ | ✅ | 58s | $0.158 | 12 | 13 | 0 | 36/47 (0 source, 11 quote) |
| Etsy | ✅ | ✅ | ✅ | 27s | $0.108 | 10 | 9 | 0 | 25/36 (0 source, 11 quote) |
| Robinhood | ✅ | ✅ | ✅ | 30s | $0.107 | 10 | 9 | 0 | 24/33 (0 source, 9 quote) |
| DoorDash | ✅ | ✅ | ✅ | 54s | $0.137 | 12 | 11 | 2 | 32/49 (0 source, 17 quote) |
| Rivian | ✅ | ✅ | ✅ | 34s | $0.110 | 10 | 9 | 0 | 26/36 (0 source, 10 quote) |
| Samsara | ✅ | ✅ | ✅ | 160s | $0.192 | 14 | 16 | 0 | 36/49 (0 source, 13 quote) |
| MongoDB | ✅ | ✅ | ✅ | 51s | $0.144 | 12 | 12 | 0 | 29/41 (0 source, 12 quote) |
| Okta | ✅ | ✅ | ✅ | 29s | $0.108 | 10 | 9 | 1 | 23/33 (0 source, 10 quote) |
| Spotify | ✅ | ✅ | ✅ | 65s | $0.171 | 12 | 14 | 0 | 31/48 (2 source, 15 quote) |
| Adyen | ✅ | ✅ | ✅ | 28s | $0.098 | 10 | 8 | 0 | 25/37 (0 source, 12 quote) |
| Wise | ✅ | ✅ | ✅ | 33s | $0.110 | 10 | 9 | 0 | 32/37 (0 source, 5 quote) |
| Klarna | ✅ | ✅ | ✅ | 32s | $0.112 | 10 | 9 | 1 | 28/37 (0 source, 9 quote) |
| Canva | ✅ | ✅ | ❌ | 37s | $0.113 | 10 | 9 | 1 | 28/37 (3 source, 6 quote) |
| Revolut | ✅ | ✅ | ✅ | 52s | $0.147 | 12 | 12 | 1 | 32/47 (0 source, 15 quote) |
| Monzo | ✅ | ✅ | ✅ | 77s | $0.210 | 15 | 17 | 1 | 36/59 (2 source, 21 quote) |
| N26 | ✅ | ✅ | ✅ | 29s | $0.099 | 10 | 8 | 2 | 25/36 (0 source, 11 quote) |
| Celonis | ✅ | ✅ | ✅ | 34s | $0.110 | 10 | 9 | 0 | 30/37 (0 source, 7 quote) |
| Mistral AI | ✅ | ✅ | ✅ | 28s | $0.112 | 10 | 9 | 3 | 25/37 (0 source, 12 quote) |
| Cohere | ✅ | ✅ | ✅ | 28s | $0.102 | 10 | 8 | 3 | 26/39 (0 source, 13 quote) |
| Nubank | ✅ | ✅ | ❌ | 75s | $0.149 | 13 | 12 | 1 | 29/44 (0 source, 15 quote) |
| Grab | ✅ | ✅ | ✅ | 53s | $0.145 | 12 | 12 | 0 | 32/46 (1 source, 13 quote) |
| Brex | ✅ | ✅ | ✅ | 32s | $0.121 | 10 | 10 | 1 | 27/38 (0 source, 11 quote) |
| Ramp | ✅ | ✅ | ✅ | 27s | $0.120 | 10 | 10 | 0 | 29/37 (0 source, 8 quote) |
| Plaid | ✅ | ✅ | ✅ | 52s | $0.147 | 12 | 12 | 1 | 33/49 (0 source, 16 quote) |
| Rippling | ✅ | ✅ | ✅ | 52s | $0.156 | 12 | 13 | 0 | 30/47 (0 source, 17 quote) |
| Vanta | ✅ | ✅ | ✅ | 31s | $0.100 | 10 | 8 | 4 | 29/36 (0 source, 7 quote) |
| Retool | ✅ | ✅ | ✅ | 67s | $0.172 | 13 | 14 | 1 | 26/43 (0 source, 17 quote) |
| Figma | ✅ | ✅ | ❌ | 35s | $0.123 | 10 | 10 | 0 | 33/41 (0 source, 8 quote) |
| Notion | ✅ | ✅ | ✅ | 54s | $0.126 | 12 | 10 | 5 | 30/47 (0 source, 17 quote) |
| Databricks | ✅ | ✅ | ✅ | 63s | $0.217 | 14 | 18 | 0 | 26/58 (0 source, 32 quote) |
| Scale AI | ✅ | ✅ | ✅ | 31s | $0.124 | 10 | 10 | 3 | 26/36 (0 source, 10 quote) |
| Anduril | ✅ | ✅ | ✅ | 49s | $0.156 | 12 | 13 | 0 | 35/49 (0 source, 14 quote) |
| Perplexity | ✅ | ✅ | ✅ | 26s | $0.122 | 10 | 10 | 1 | 29/39 (0 source, 10 quote) |
| Gusto | ✅ | ❌ | ✅ | 30s | $0.098 | 10 | 8 | 0 | 30/38 (0 source, 8 quote) |
| Modal | ✅ | ✅ | ❌ | 59s | $0.134 | 12 | 11 | 0 | 33/43 (0 source, 10 quote) |
| Replit | ✅ | ✅ | ✅ | 52s | $0.134 | 12 | 11 | 1 | 35/47 (0 source, 12 quote) |
| Harvey | ❌ | ✅ | ✅ | 32s | $0.110 | 10 | 9 | 0 | 26/38 (0 source, 12 quote) |
| Hex | ✅ | ✅ | ✅ | 28s | $0.109 | 10 | 9 | 1 | 24/34 (0 source, 10 quote) |
| Glean | ✅ | ✅ | ✅ | 27s | $0.113 | 10 | 9 | 4 | 26/36 (0 source, 10 quote) |

138/144 fields correct. website_domain: 47/48, founded_year: 47/48, hq_city: 44/48.

## v2-day6-originals

Agent: v2, planner `claude-haiku-5-5` (low), researcher `claude-haiku-5-5` (medium), verifier `claude-haiku-5-5` (low), writer `claude-haiku-5-5` (medium). Base: `http://localhost:3100`. Spend cap: $1.000.

| company | website | founded | HQ city | run time | cost | API requests | searches | fetches | claims supported |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 32s | $0.122 | 11 | 10 | 0 | 28/37 (0 source, 9 quote) |
| Vercel | ✅ | ✅ | ✅ | 57s | $0.161 | 14 | 13 | 2 | 32/46 (0 source, 14 quote) |
| Airbnb | ✅ | ✅ | ✅ | 37s | $0.110 | 11 | 9 | 0 | 27/37 (0 source, 10 quote) |
| Shopify | ✅ | ✅ | ✅ | 66s | $0.126 | 14 | 10 | 0 | 30/41 (0 source, 11 quote) |
| Datadog | ✅ | ✅ | ✅ | 31s | $0.109 | 11 | 9 | 1 | 27/37 (0 source, 10 quote) |

15/15 fields correct. website_domain: 5/5, founded_year: 5/5, hq_city: 5/5.

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
