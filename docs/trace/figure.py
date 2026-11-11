"""Draws one run's Langfuse trace as a waterfall (HTML) for the README,
from its observations as Langfuse's API returns them (ids, timings, costs;
no prompts or outputs), saved as databricks.json with:

    lf.api.observations.get_many(trace_id=..., limit=100, fields="core,basic,usage,model,metrics")

Usage: python3 docs/trace/figure.py docs/trace/databricks.json figure.html
(then a 2x screenshot of #fig gives v2-trace.png)."""
import json, sys
from datetime import datetime
from html import escape

rows = json.load(open(sys.argv[1]))
t = lambda s: datetime.fromisoformat(s)
t0 = min(t(r["start"]) for r in rows)
sec = lambda s: (t(s) - t0).total_seconds()
main = sorted((r for r in rows if r["type"] not in ("GENERATION", "TOOL") and r["name"] not in ("decision", "save")), key=lambda r: (sec(r["start"]), r["name"]))
tools = [r for r in rows if r["type"] == "TOOL"]
# Each EDGAR call right under the researcher that made it.
spans = []
for r in main:
    spans.append(r)
    spans += sorted((tl for tl in tools if tl["parent"] == r["id"]), key=lambda tl: tl["start"])
after = sorted((r for r in rows if r["name"] in ("decision", "save")), key=lambda r: r["type"] != "AGENT")
gens = [r for r in rows if r["type"] == "GENERATION"]
by_id = {r["id"]: r for r in rows}
cost_under = {}
for g in gens:
    cost_under[g["parent"]] = cost_under.get(g["parent"], 0) + (g["cost"] or 0)
calls_under = {}
for g in gens:
    calls_under.setdefault(g["parent"], []).append(g)
total_cost = sum(g["cost"] or 0 for g in gens)
end = max(sec(r["end"]) for r in spans)
SCALE = 64.0
W = 560  # timeline width in px
x = lambda s: s / SCALE * W

def label(r):
    n = r["name"]
    if r["type"] == "AGENT":
        return "run: start (to the draft)" if n == "start" else "run: approval"
    if r["type"] == "TOOL":
        return "  EDGAR (MCP): " + n.removeprefix("secedgar_").replace("_", " ")
    return n

def row(r, kind):
    s, e = sec(r["start"]), sec(r["end"])
    dur = e - s
    cost = cost_under.get(r["id"])
    ticks = "".join(
        f'<span class="tick" style="left:{x(sec(g["start"])) :.1f}px"></span>' for g in calls_under.get(r["id"], [])
    )
    usd = lambda c: f"${c:.4f}" if c < 0.001 else f"${c:.3f}"
    right = f'{dur:.1f} s' + (f' · {usd(cost)}' if cost else "")
    if r["type"] == "AGENT" and r["name"] == "start":
        right = f"{dur:.1f} s · {usd(total_cost)}"
    return (f'<div class="row {kind}"><div class="name">{escape(label(r))}</div>'
            f'<div class="lane"><span class="bar" style="left:{x(s):.1f}px;width:{max(x(dur), 2):.1f}px"></span>{ticks}</div>'
            f'<div class="right">{right}</div></div>')

kind = lambda r: {"AGENT": "agent", "TOOL": "tool"}.get(r["type"], "span")
axis = "".join(f'<span class="ax" style="left:{x(v):.1f}px">{v} s</span>' for v in range(0, 61, 10))
grid = "".join(f'<span class="gl" style="left:{x(v):.1f}px"></span>' for v in range(0, 61, 10))
html = f"""<!doctype html><meta charset="utf-8"><style>
body {{ margin:0; background:#fff; font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color:#1f2328; }}
#fig {{ width: 980px; padding: 22px 24px 18px; box-sizing: border-box; }}
h1 {{ font-size: 16px; margin: 0 0 4px; }}
.sub {{ color:#59636e; margin-bottom: 14px; }}
.row {{ display:flex; align-items:center; height: 24px; }}
.name {{ width: 230px; white-space: pre; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }}
.lane {{ position: relative; width: {W}px; height: 24px; }}
.right {{ width: 150px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color:#59636e; }}
.bar {{ position:absolute; top:6px; height:12px; border-radius:3px; background:#0f766e; }}
.agent .bar {{ background:#1f2328; }}
.tool .bar {{ background:#d97706; }}
.tick {{ position:absolute; top:3px; width:2px; height:18px; background:#99f6e4; border-radius:1px; }}
.gl {{ position:absolute; top:0; bottom:0; width:1px; background:#eaeef2; }}
.grid {{ position:absolute; left:230px; top:0; bottom:0; width:{W}px; }}
.body {{ position:relative; }}
.axis {{ position:relative; margin-left:230px; height:18px; width:{W}px; color:#59636e; font-size:11px; }}
.ax {{ position:absolute; transform: translateX(-50%); }}
.sep {{ border-top: 1px dashed #d1d9e0; margin: 6px 0 4px; }}
.legend {{ color:#59636e; margin-top: 10px; font-size: 12px; }}
.key {{ display:inline-block; width:12px; height:10px; border-radius:2px; vertical-align:-1px; margin: 0 4px 0 12px; }}
</style><div id="fig">
<h1>One DealScout v2 run, traced: Databricks</h1>
<div class="sub">{len(rows)} observations in Langfuse: {len(gens)} model calls (${total_cost:.3f}, this app's own cost), {sum(r['type']=='TOOL' for r in rows)} EDGAR MCP calls, a draft in {end:.0f} s.</div>
<div class="body"><div class="grid">{grid}</div>
{"".join(row(r, kind(r)) for r in spans)}
<div class="sep"></div>
{"".join(row(r, kind(r)) for r in after)}
</div>
<div class="axis">{axis}</div>
<div class="legend"><span class="key" style="background:#1f2328;margin-left:0"></span>run (one trace across requests)<span class="key" style="background:#0f766e"></span>graph node<span class="key" style="background:#99f6e4"></span>model call<span class="key" style="background:#d97706"></span>tool call over MCP
· The approval ran as a second request, joined to the same trace.</div>
</div>"""
open(sys.argv[2], "w").write(html)
print("wrote", sys.argv[2])
