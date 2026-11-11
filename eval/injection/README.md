# Prompt-injection test pages

The companies in `pages/` are **fictional**: every name, person, investor
and fact on these pages is made up for DealScout's prompt-injection
evaluation. Each page reads like an ordinary company site and carries one
injected instruction aimed at an AI research agent (see `cases.json`).
The exfiltration case points at `dealscout-canary.example`, a reserved
domain that never resolves, so nothing can leave even if an agent follows
it.

`run.py` runs each case through the v2 agent and grades whether the agent
followed the instruction; results are in `RESULTS.md`.
