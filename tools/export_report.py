#!/usr/bin/env python3
"""Export an event report (Excel) from a running event-checkin instance.

Usage:
    SUPABASE_URL=https://xxxx.supabase.co SUPABASE_KEY=sb_publishable_... \
    ADMIN_PIN=your-pin python3 tools/export_report.py [--day 2026-10-10] [--out report.xlsx]

It calls the same admin_dashboard() function the live dashboard uses, so it needs
only the admin PIN and the public (publishable) key. Requires: pandas, openpyxl.
"""
import argparse, json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument('--day', help='limit to one event day, YYYY-MM-DD (default: all days)')
ap.add_argument('--out', default='event-report.xlsx')
ap.add_argument('--tz-offset-hours', type=float, default=float(os.environ.get('TZ_OFFSET_HOURS', '5.5')),
                help='venue offset from UTC in hours (default 5.5 = IST)')
args = ap.parse_args()
for k in ('SUPABASE_URL', 'SUPABASE_KEY', 'ADMIN_PIN'):
    if not os.environ.get(k):
        sys.exit(f'Set the {k} environment variable.')

req = urllib.request.Request(
    os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/rpc/admin_dashboard',
    data=json.dumps({'p_pin': os.environ['ADMIN_PIN'], 'p_day': args.day}).encode(),
    headers={'apikey': os.environ['SUPABASE_KEY'], 'Content-Type': 'application/json'})
d = json.load(urllib.request.urlopen(req, timeout=30))
if isinstance(d, dict) and d.get('error'):
    sys.exit('Server said: ' + d['error'])

TZ = timezone(timedelta(hours=args.tz_offset_hours))
ci = pd.DataFrame(d['checkins'])
na = pd.DataFrame(d['not_arrived'])
if ci.empty:
    sys.exit('No check-ins yet.')
for c in ('at', 'ack_at', 'done_at'):
    ci[c] = pd.to_datetime(ci[c], utc=True, format='ISO8601').dt.tz_convert(TZ).dt.tz_localize(None)
ci['hour'] = ci['at'].dt.hour
ci['kind'] = ci['status'].map({'invited': 'Invited', 'walkin': 'Walk-in'})
ci['party'] = 1 + ci['additional'].fillna(0).astype(int)
ci['minutes_to_ack'] = (ci['ack_at'] - ci['at']).dt.total_seconds() / 60
ci['owner'] = ci['assigned_to'].fillna(ci['invited_by'].where(ci['status'] == 'invited', ci['referred_by'])).fillna('(none)').str.upper()
ACTIVE = ['Hot', 'Warm', 'Followup', 'Converted']
STAGES = ['Converted', 'Hot', 'Warm', 'Followup', 'Yet To Talk', 'New', 'Cold', 'Lost']
ci['active'] = ci['stage'].isin(ACTIVE)

# --- pivots -----------------------------------------------------------------
stage_by_owner = pd.crosstab(ci['owner'], ci['stage']).reindex(columns=STAGES, fill_value=0)
stage_by_owner['Total'] = stage_by_owner.sum(axis=1)
stage_by_owner['Active %'] = (stage_by_owner[ACTIVE].sum(axis=1) / stage_by_owner['Total']).round(3)
stage_by_kind = pd.crosstab(ci['kind'], ci['stage']).reindex(columns=STAGES, fill_value=0)
hourly = pd.crosstab(ci['hour'], ci['day'])
team = pd.DataFrame(d['by_team'])
if not team.empty:
    team['turnout'] = (team['arrived'] / team['invited']).round(3)
    team = team.sort_values('turnout', ascending=False)
rows = [(b.strip(), r.active, r.kind, r.party) for r in ci.itertuples() for b in (r.builder or '').split(',') if b.strip()]
builders = (pd.DataFrame(rows, columns=['builder', 'active', 'kind', 'party'])
            .groupby('builder').agg(guests=('builder', 'size'), active_rate=('active', 'mean'),
                                    walkin_share=('kind', lambda s: (s == 'Walk-in').mean()), avg_party=('party', 'mean'))
            .sort_values('guests', ascending=False).round(3)) if rows else pd.DataFrame()
summary = pd.DataFrame([
    ('Invited on list', d['invited']), ('Invited who arrived', d['arrived_invited']),
    ('Walk-ins', d['walkins']), ('Total check-ins', len(ci)),
    ('Headcount incl. companions', d['headcount']), ('Active leads (Hot/Warm/Followup/Converted)', int(ci['active'].sum())),
    ('Median minutes to acknowledge', round(ci['minutes_to_ack'].median(), 1)),
], columns=['Metric', 'Value'])

with pd.ExcelWriter(args.out, engine='openpyxl') as xl:
    summary.to_excel(xl, sheet_name='Summary', index=False)
    ci.drop(columns=['prefs', 'dup_rsvp', 'dup_checkin'], errors='ignore').to_excel(xl, sheet_name='Check-ins', index=False)
    na.to_excel(xl, sheet_name='Not arrived', index=False)
    team.to_excel(xl, sheet_name='Team scorecard', index=False)
    stage_by_owner.to_excel(xl, sheet_name='Stages by owner')
    stage_by_kind.to_excel(xl, sheet_name='Stages by type')
    hourly.to_excel(xl, sheet_name='Arrivals by hour')
    if not builders.empty:
        builders.to_excel(xl, sheet_name='Builder tables')
print(f'Wrote {args.out}: {len(ci)} check-ins, {len(na)} not arrived.')
