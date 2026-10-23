#!/usr/bin/env bash
# Quick health check of a deployed instance.
#   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_KEY=<publishable key> ADMIN_PIN=<pin> scripts/smoke_test.sh
# It reads data and verifies that anonymous access is locked down. It does NOT create check-ins.
set -u
: "${SUPABASE_URL:?set SUPABASE_URL}" "${SUPABASE_KEY:?set SUPABASE_KEY}" "${ADMIN_PIN:?set ADMIN_PIN}"
rpc() { curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/$1" -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" -d "$2"; }
ok=0; fail=0
check() { if [ "$2" = "1" ]; then echo "  PASS  $1"; ok=$((ok+1)); else echo "  FAIL  $1"; fail=$((fail+1)); fi; }

echo "Event config is public:";           r=$(rpc get_event_config '{}');                        check "get_event_config returns an event name" "$(echo "$r" | grep -q event_name && echo 1 || echo 0)"
echo "Admin PIN gate:";                    r=$(rpc admin_login "{\"p_pin\":\"definitely-wrong\"}"); check "wrong PIN rejected" "$([ "$r" = "false" ] && echo 1 || echo 0)"
                                           r=$(rpc admin_login "{\"p_pin\":\"$ADMIN_PIN\"}");       check "correct PIN accepted" "$([ "$r" = "true" ] && echo 1 || echo 0)"
echo "Dashboard:";                         r=$(rpc admin_dashboard "{\"p_pin\":\"$ADMIN_PIN\",\"p_day\":null}"); check "admin_dashboard returns data" "$(echo "$r" | grep -q checkins && echo 1 || echo 0)"
                                           r=$(rpc admin_dashboard '{"p_pin":"nope","p_day":null}');            check "dashboard refuses a bad PIN" "$(echo "$r" | grep -q unauthorized && echo 1 || echo 0)"
echo "Tables are not readable anonymously:"
for t in checkins rsvp leads phone_aliases; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/rest/v1/$t?select=*&limit=1" -H "apikey: $SUPABASE_KEY")
  body=$(curl -s "$SUPABASE_URL/rest/v1/$t?select=*&limit=1" -H "apikey: $SUPABASE_KEY")
  check "$t exposes no rows" "$([ "$body" = "[]" ] || echo "$body" | grep -q 'permission denied' && echo 1 || echo 0)"
done
echo; echo "$ok passed, $fail failed"; [ "$fail" = 0 ]
