# DealScout Accuracy Eval — 2026-07-09

Methodology (borrowed from [EvalBoard](https://github.com/olioli9586/evalboard)):
hand-checked ground truth, mechanical field grading with accepted-value lists,
every result reproducible via `node eval/run-eval.mjs`.

**Overall: 15/15 fields correct (100%)**

| company | website | founded | HQ city | run time |
|---|---|---|---|---|
| Anthropic | ✅ | ✅ | ✅ | 155s |
| Vercel | ✅ | ✅ | ✅ | 147s |
| Airbnb | ✅ | ✅ | ✅ | 166s |
| Shopify | ✅ | ✅ | ✅ | 166s |
| Datadog | ✅ | ✅ | ✅ | 243s |

| field | accuracy |
|---|---|
| website_domain | 5/5 |
| founded_year | 5/5 |
| hq_city | 5/5 |

Notes:
- Fields were chosen for *stability* (a website or founding year doesn't move);
  volatile fields (employee counts, funding) need dated ground truth to grade fairly.
- Failures worth reading: when the agent misses, the profile usually shows *why*
  (e.g. remote-first companies genuinely have ambiguous HQs).
