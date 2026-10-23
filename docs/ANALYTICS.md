# Turning check-ins into decisions

The live dashboard tells you what is happening. This guide is for the day after: how to get the data out, which pivots are worth building, and how to draw conclusions that survive a sceptical question ("is that real, or just noise?").

## 1. Getting the data out

| Method | Gives you |
|---|---|
| Dashboard → **Export check-ins** / **Export not-arrived** | CSV for the selected day (or all days) |
| Dashboard → **Export everything** | One CSV with every check-in on every day *plus* every invited guest who never came |
| `python tools/export_report.py` | An Excel workbook: summary, check-ins, not-arrived, team scorecard, stage pivots by owner and by invited/walk-in, arrivals by hour, table (builder) pivot |
| `admin_dashboard` RPC | The same JSON the dashboard uses, if you want to analyse it in a notebook |

```bash
pip install -r tools/requirements.txt
cp .env.example .env && source .env     # fill in URL, key, PIN
python tools/export_report.py --out report.xlsx           # all days
python tools/export_report.py --day 2026-10-10            # one day
```

### The fields that matter

| Field | Meaning |
|---|---|
| `status` | `invited` (number matched the list) or `walkin` |
| `invited_by` | who invited them (list) |
| `referred_by` | the team member the **guest** named at check-in |
| `assigned_to` | owner after rotation / reassignment |
| `additional` | people who came with the guest (party size = 1 + this) |
| `builder` | table/project tags (comma-separated) |
| `stage`, `note` | the follow-up pipeline fields (set by the team) |
| `ack_by`, `ack_at` | who tapped "I've got this guest", and when |
| `done_by`, `done_at` | who finished with the guest, and when |
| `at`, `day` | check-in time and event day |
| `consent` | the guest ticked "you may contact me" |

## 2. The pivots that were worth building

1. **Funnel** — invited → arrived; walk-ins; total check-ins; headcount (guests + companions).
2. **Day comparison** — check-ins, walk-in share, headcount, active-lead share per day.
3. **Arrivals by hour × day** — where to staff. (The real event: roughly half of all check-ins landed in three consecutive hours in the early afternoon.)
4. **Team scorecard** — invited, arrived, **turnout %** with a confidence interval, walk-ins credited, guests handled, stage mix, how many are still *New*, median time to acknowledge.
5. **Stage × owner**, **stage × invited/walk-in**, **stage × day** — how much of the pipeline is real.
6. **Table (builder) pivot** — guests per table, hot/warm rate, **lift** over the event average, walk-in share, average party size, concentration (top-N share).
7. **No-show workload** — invited-not-arrived per owner, split by whether a phone number exists and by invite day; and "came on the other day" (guests invited for Day 1 who came on Day 2).
8. **Response time** — check-in → "I've got this guest", excluding bulk acknowledgements by an admin.
9. **Data-quality list** — stages still *New*, *New* with a note (stale label), walk-ins with an unlinked look-alike on the guest list, flagged duplicates, name-only invitees, unused preference form.
10. **Priority call list** — every Hot/Warm/Followup/Converted guest with owner, tables, note and phone, sorted by stage, with blank *next follow-up date / last contacted / outcome* columns. This is the sheet the sales team actually lives in after the event.

## 3. Inference without fooling yourself

Event data is small (hundreds, not millions) and self-selected. These tools keep the conclusions honest.

### Confidence intervals for rates (Wilson)

"4 of 243 came (1.6%)" is a point estimate. The **Wilson interval** says how far the true rate could plausibly be from it and behaves well for small counts and rates near 0% or 100%:

```python
import math
def wilson(k, n, z=1.96):
    p = k / n; d = 1 + z*z/n
    c = p + z*z/(2*n); a = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return (c - a)/d, (c + a)/d
wilson(60, 947)   # overall turnout: roughly 4.95%-8.07%
```

Overlapping intervals between two team members mean you cannot tell them apart; do not rank them.

### Comparing two rates: Fisher's exact test

For 2×2 tables with small counts (invited vs walk-in × active vs not; name-only list vs the rest × arrived vs not):

```python
from scipy import stats
stats.fisher_exact([[4, 239], [56, 648]])[1]   # p-value
```

*p < 0.05* ≈ "this big a gap would be unusual if there were no real difference." It says nothing about *why*.

### Comparing many groups: a permutation test

Is turnout different across 14 team members, or is that what chance looks like? Shuffle the "arrived" labels across all invitees thousands of times, compute a chi-square each time, and see how often the shuffled data is as extreme as the real data:

```python
import numpy as np
rng = np.random.default_rng(7)
# invited, arrived: arrays per member
def chi(arr, inv):
    p = arr.sum()/inv.sum(); e = inv*p
    return (((arr-e)**2)/e + (((inv-arr)-(inv-e))**2)/(inv-e)).sum()
obs = chi(arrived, invited)
labels = np.repeat(np.arange(len(invited)), invited)
flag = np.zeros(invited.sum()); flag[:arrived.sum()] = 1
hits = 0
for _ in range(10000):
    rng.shuffle(flag)
    hits += chi(np.bincount(labels, weights=flag, minlength=len(invited)), invited) >= obs
p = (hits + 1) / 10001
```

Works with tiny counts where the textbook chi-square approximation is unreliable.

### Lift, and shrinking small samples

For a table/segment: **lift = (its hot-or-warm rate) ÷ (the event's hot-or-warm rate)**. 2.0× means twice as likely. Pair it with the Wilson interval and a binomial test against the event average. A table with 3 guests and 3 hot leads has a 100% rate and almost no information — report it as "promising", not "best".

### Concentration (Pareto)

"Top 3 hours = 46% of arrivals", "top 5 tags = 60% of tag mentions". Cheap, intuitive, and tells you where operations should focus.

### Funnel and conversion thinking

Invited → arrived → engaged (hot/warm) → converted. Compute each step per segment, and compare **steps**, not just the end. A segment can have poor turnout but excellent engagement (invest in getting them to come) or the reverse (invest in the conversation).

## 4. Pitfalls we actually hit

* **Stage labels are a judgement, applied inconsistently.** Some team members updated every guest; some updated none. A "stage by owner" table mostly measures **update discipline**. The permutation test said the stage mix differed across people far beyond chance — and the reason was mostly behaviour, not lead quality. Use stage to prioritise calls, not to grade people.
* **Survivorship bias.** You only observe people who came. You cannot say what the no-shows wanted, and interest among attendees tells you nothing about the invited population.
* **Confounding.** A team member's turnout reflects their list (name-only vs numbers, warm vs cold contacts), their outreach and luck. Do not attribute it to skill from one event.
* **Measurement validity.** "Time to acknowledge" is a tap on a phone, not a conversation. Late taps (the next morning) and admin bulk-acknowledgements distort it — exclude the latter and report medians and percentiles, not means.
* **Multiple comparisons.** Test 20 tables and one or two will look "significant" by chance. Treat single small-sample findings as hypotheses to check next time.
* **Attribution is generous.** A walk-in who names a team member credits them even if the guest was never invited by them; the invited-vs-named mismatch list shows how often that happens.
* **Unlinked identities understate turnout.** If an invitee checks in with a different number and nobody links it, they count as a walk-in and the inviter's turnout looks worse than it is. Review the flagged look-alikes.

## 5. Findings from the original event (illustrative)

These are *aggregates* from the two-day expo this was built for, to show what kind of insight the data supports. Your numbers will differ.

* About **three-quarters of check-ins were walk-ins**; overall invitee turnout was in the **mid single digits** (a Wilson interval of roughly 5–8%).
* **Invitations without a phone number** (a batch of name-only cards) turned up at roughly **a fifth of the rate** of invitations with numbers — a statistically clear gap and the single biggest drag on overall turnout.
* **Turnout varied several-fold between team members** beyond what chance explains — but with the confounders above.
* **Invited guests were more likely to be in an active pipeline stage** than walk-ins (p ≈ 0.003), yet walk-ins supplied the majority of hot/warm leads by sheer volume.
* **One table had about twice the event-average hot/warm rate** (p < 0.01); several others looked promising but had too few guests to call. About a quarter of visits were tagged "not for any project / not aware" and almost never became leads — useful to exclude when judging footfall quality.
* **Day 2 was bigger but not different:** walk-in share, active share and party size were statistically indistinguishable between days.
* **Over a third of guests who were invited for Day 1 and attended came on Day 2** — the invitation day is a soft preference, so no-shows should be re-invited rather than written off.
* **The preference form was skipped** by nearly everyone; the table tags and the notes carried the qualification.
* **Response time**: median about half an hour from check-in to acknowledgement, with a long tail.

## 6. Ideas for the next version of the analysis

* Record **outreach** (was the invitee called? when? by whom?) so turnout can be modelled against effort, not just against who made the list.
* Log **stage changes with timestamps** to see how fast a pipeline moves and who stalls.
* A **cohort view** of follow-up outcomes (called within 48 h → site visit → booking) — the number the business actually cares about.
* An automated **end-of-day digest** (a scheduled query that emails the organiser the funnel, the waiting list, and the no-show call list).
