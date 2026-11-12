#!/usr/bin/env bash
# Exercises PayPilot's payment verification, idempotency and webhook handling against a LOCAL MOCK of PayPal.
# This validates our server logic only. It is not a substitute for one real PayPal Sandbox payment.
#
# Usage (from server/):  npm run test:payments
# Needs: MongoDB reachable at MONGODB_URI, seeded DB (npm run seed), curl, python3.
set -u
curl() { command curl -m 20 "$@"; } # never let a stuck request hang the suite
cd "$(dirname "$0")/.."
API_PORT="${TEST_API_PORT:-4001}"; MOCK_PORT="${MOCK_PAYPAL_PORT:-4010}"
A="http://localhost:$API_PORT/api"; M="http://127.0.0.1:$MOCK_PORT"
H='Content-Type: application/json'
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@paypilot.dev}"; ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe-Admin-123}"
PASS=0; FAIL=0
js() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))
except Exception: print('')" "$1"; }
check() { if [ "$2" = "0" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi; }
eq() { [ "$1" = "$2" ] && echo 0 || echo 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
mode() { curl -s -H "$H" -d "{\"mode\":\"$1\",\"signature\":\"${2:-SUCCESS}\"}" $M/__mode >/dev/null; }

cleanup() { kill $MOCK_PID $API_PID 2>/dev/null; }
trap cleanup EXIT

MOCK_PAYPAL_PORT=$MOCK_PORT node scripts/mock-paypal.mjs > /tmp/mock-paypal.log 2>&1 & MOCK_PID=$!
PORT=$API_PORT NODE_ENV=development PAYPAL_API_BASE=$M PAYPAL_CLIENT_ID=mock PAYPAL_CLIENT_SECRET=mock PAYPAL_WEBHOOK_ID=MOCKWH \
  PAYPAL_CURRENCY=USD INR_PER_UNIT=88 node --import tsx src/index.ts > /tmp/pp-api.log 2>&1 & API_PID=$!
for i in $(seq 1 30); do curl -s $A/health >/dev/null 2>&1 && break; sleep 0.5; done
curl -s $A/health | grep -q ok || { echo "API did not start:"; cat /tmp/pp-api.log; exit 1; }
mode ok

# --- helpers ---
newuser() { J=$1; rm -f $J; curl -s -c $J -H "$H" -d "{\"name\":\"Pay Tester\",\"email\":\"pay_$RANDOM$RANDOM@example.com\",\"password\":\"Passw0rd!123\"}" $A/auth/register >/dev/null; }
pid_cheap() { curl -s "$A/products?sort=price_asc&limit=20" | js "[p['id'] for p in d['items'] if p['stock']>=5][0]"; }
stock() { curl -s $A/products/$1 | js "d['product']['stock']"; }
prepare() { # jar pid qty -> prints order id
  curl -s -b $1 -H "$H" -d "{\"productId\":\"$2\",\"quantity\":${3:-1}}" $A/cart/items >/dev/null
  curl -s -b $1 -H "$H" -d '{}' $A/checkout/prepare | js "d['order']['_id'] if '_id' in d['order'] else d['order']['id']"; }
approve() { curl -s -b $1 -H "$H" -d '{"confirm":true}' $A/orders/$2/approve; }
ostat() { curl -s -b $1 $A/orders/$2 | js "d['order']['status']"; }
ntx() { curl -s -b $1 $A/orders/$2 | js "len([t for t in d['transactions'] if t['kind']=='$3'])"; }
chargeamt() { curl -s -b $1 $A/orders/$2 | js "d['order']['chargeAmount']"; }
hook() { # eventId type orderId captureId amount currency status -> http code
  curl -s -o /tmp/hook.out -w '%{http_code}' -H "$H" -H 'paypal-transmission-id: t' -H 'paypal-transmission-sig: s' -H 'paypal-auth-algo: a' -H 'paypal-cert-url: c' -H 'paypal-transmission-time: now' \
    -d "{\"id\":\"$1\",\"event_type\":\"$2\",\"summary\":\"test\",\"resource\":{\"id\":\"$4\",\"status\":\"${7:-COMPLETED}\",\"custom_id\":\"$3\",\"amount\":{\"value\":\"$5\",\"currency_code\":\"$6\"}}}" $A/webhooks/paypal; }

echo "== 1. Approval gate and PayPal order creation"
newuser /tmp/pu1.jar; P=$(pid_cheap)
O=$(prepare /tmp/pu1.jar $P 1)
check "order prepared" $([ -n "$O" ] && echo 0 || echo 1)
check "capture refused before approval" $(eq "$(code -b /tmp/pu1.jar -H "$H" -d '{"paypalOrderId":"MOCKXXXXO1"}' $A/orders/$O/capture)" 409)
R=$(approve /tmp/pu1.jar $O); PPID1=$(echo "$R" | js "d['order']['paypalOrderId']")
check "approve creates PayPal order id" $([ -n "$PPID1" ] && echo 0 || echo 1)
check "status awaiting_payment" $(eq "$(ostat /tmp/pu1.jar $O)" awaiting_payment)
check "approve twice reuses same PayPal order" $(eq "$(approve /tmp/pu1.jar $O | js "d['order']['paypalOrderId']")" "$PPID1")
check "capture with foreign PayPal order id rejected" $(eq "$(code -b /tmp/pu1.jar -H "$H" -d '{"paypalOrderId":"SOMEONEELSES1"}' $A/orders/$O/capture)" 400)
newuser /tmp/pu2.jar
check "other user cannot capture my order" $(eq "$(code -b /tmp/pu2.jar -H "$H" -d "{\"paypalOrderId\":\"$PPID1\"}" $A/orders/$O/capture)" 404)

echo "== 2. Amount mismatch is rejected (no fake success)"
mode wrong_amount
S0=$(stock $P)
check "wrong amount -> 409 VERIFICATION_FAILED" $(eq "$(code -b /tmp/pu1.jar -H "$H" -d "{\"paypalOrderId\":\"$PPID1\"}" $A/orders/$O/capture)" 409)
check "order NOT paid after mismatch" $([ "$(ostat /tmp/pu1.jar $O)" != "paid" ] && echo 0 || echo 1)
check "stock untouched after mismatch" $(eq "$(stock $P)" "$S0")
check "rejected transaction logged" $(eq "$(ntx /tmp/pu1.jar $O failure)" 1)
mode ok

echo "== 3. Successful capture, then idempotency"
newuser /tmp/pu3.jar; O3=$(prepare /tmp/pu3.jar $P 2); PP3=$(approve /tmp/pu3.jar $O3 | js "d['order']['paypalOrderId']")
S1=$(stock $P)
R=$(curl -s -b /tmp/pu3.jar -H "$H" -d "{\"paypalOrderId\":\"$PP3\"}" $A/orders/$O3/capture)
check "capture marks order paid" $(eq "$(ostat /tmp/pu3.jar $O3)" paid)
check "exactly one completed capture transaction" $(eq "$(ntx /tmp/pu3.jar $O3 capture)" 1)
check "stock decremented by quantity (2)" $(eq "$(stock $P)" "$((S1-2))")
check "cart emptied after payment" $(eq "$(curl -s -b /tmp/pu3.jar $A/cart | js "d['itemCount']")" 0)
check "payment notification created" $([ "$(curl -s -b /tmp/pu3.jar $A/notifications | js "len([n for n in d['items'] if n['type']=='payment'])")" -ge 1 ] && echo 0 || echo 1)
R2=$(curl -s -b /tmp/pu3.jar -H "$H" -d "{\"paypalOrderId\":\"$PP3\"}" $A/orders/$O3/capture)
check "second capture is idempotent (already:true)" $(eq "$(echo "$R2" | js "d.get('already')")" True)
check "still one transaction, stock unchanged" $([ "$(ntx /tmp/pu3.jar $O3 capture)" = "1" ] && [ "$(stock $P)" = "$((S1-2))" ] && echo 0 || echo 1)
check "dashboard counts the successful transaction" $([ "$(curl -s -b /tmp/pu3.jar $A/dashboard | js "d['stats']['successfulTransactions']")" = "1" ] && echo 0 || echo 1)
check "dashboard totalPurchases = 2 items" $(eq "$(curl -s -b /tmp/pu3.jar $A/dashboard | js "d['stats']['totalPurchases']")" 2)

echo "== 4. Webhook handling"
CAP3="CAP$PP3"; AMT3=$(chargeamt /tmp/pu3.jar $O3)
mode ok FAILURE
check "bad signature rejected (400)" $(eq "$(hook WH-BAD-$RANDOM PAYMENT.CAPTURE.COMPLETED $O3 $CAP3 $AMT3 USD)" 400)
mode ok SUCCESS
EV=WH-DUP-$RANDOM
check "valid webhook for already-paid order -> already_paid" $(eq "$(hook $EV PAYMENT.CAPTURE.COMPLETED $O3 $CAP3 $AMT3 USD)/$(js "d['outcome']" < /tmp/hook.out)" "200/already_paid")
check "same event id again -> duplicate ignored" $(eq "$(hook $EV PAYMENT.CAPTURE.COMPLETED $O3 $CAP3 $AMT3 USD)/$(js "d.get('duplicate')" < /tmp/hook.out)" "200/True")
check "still exactly one transaction after webhooks" $(eq "$(ntx /tmp/pu3.jar $O3 capture)" 1)

echo "== 5. Webhook-only completion (customer closed the tab)"
newuser /tmp/pu4.jar; O4=$(prepare /tmp/pu4.jar $P 1); PP4=$(approve /tmp/pu4.jar $O4 | js "d['order']['paypalOrderId']"); A4=$(chargeamt /tmp/pu4.jar $O4)
check "tampered amount via webhook rejected" $(eq "$(hook WH-T-$RANDOM PAYMENT.CAPTURE.COMPLETED $O4 CAPX1 1.00 USD)" 409)
check "order not paid after tampered webhook" $([ "$(ostat /tmp/pu4.jar $O4)" != "paid" ] && echo 0 || echo 1)
check "wrong currency via webhook rejected" $(eq "$(hook WH-C-$RANDOM PAYMENT.CAPTURE.COMPLETED $O4 CAPX2 $A4 EUR)" 409)
check "non-COMPLETED status via webhook rejected" $(eq "$(hook WH-S-$RANDOM PAYMENT.CAPTURE.COMPLETED $O4 CAPX3 $A4 USD PENDING)" 409)
check "genuine webhook marks order paid" $(eq "$(hook WH-OK-$RANDOM PAYMENT.CAPTURE.COMPLETED $O4 CAP-WEB-$RANDOM $A4 USD)/$(js "d['outcome']" < /tmp/hook.out)" "200/marked_paid")
check "order paid via webhook" $(eq "$(ostat /tmp/pu4.jar $O4)" paid)
check "webhook transaction recorded with source=webhook" $(eq "$(curl -s -b /tmp/pu4.jar $A/orders/$O4 | js "[t['source'] for t in d['transactions'] if t['kind']=='capture'][0]")" webhook)

echo "== 6. Declined and pending payments"
newuser /tmp/pu5.jar; O5=$(prepare /tmp/pu5.jar $P 1); PP5=$(approve /tmp/pu5.jar $O5 | js "d['order']['paypalOrderId']")
mode declined
check "declined -> HTTP 402" $(eq "$(code -b /tmp/pu5.jar -H "$H" -d "{\"paypalOrderId\":\"$PP5\"}" $A/orders/$O5/capture)" 402)
check "declined order stays retryable (awaiting_payment)" $(eq "$(ostat /tmp/pu5.jar $O5)" awaiting_payment)
check "failure transaction logged" $(eq "$(ntx /tmp/pu5.jar $O5 failure)" 1)
mode pending
check "pending -> HTTP 202, not paid" $(eq "$(code -b /tmp/pu5.jar -H "$H" -d "{\"paypalOrderId\":\"$PP5\"}" $A/orders/$O5/capture)/$(ostat /tmp/pu5.jar $O5)" "202/awaiting_payment")
check "pending transaction logged" $(eq "$(ntx /tmp/pu5.jar $O5 pending)" 1)
mode ok
A5=$(chargeamt /tmp/pu5.jar $O5)
check "webhook later completes the pending payment" $(eq "$(hook WH-P-$RANDOM PAYMENT.CAPTURE.COMPLETED $O5 CAP$PP5 $A5 USD)/$(ostat /tmp/pu5.jar $O5)" "200/paid")

echo "== 7. Concurrent capture attempts"
newuser /tmp/pu6.jar; O6=$(prepare /tmp/pu6.jar $P 1); PP6=$(approve /tmp/pu6.jar $O6 | js "d['order']['paypalOrderId']"); S6=$(stock $P)
printf '%s\n' 1 2 3 4 | xargs -P4 -I{} curl -s -o /dev/null -b /tmp/pu6.jar -H "$H" -d "{\"paypalOrderId\":\"$PP6\"}" $A/orders/$O6/capture
check "order paid exactly once" $(eq "$(ostat /tmp/pu6.jar $O6)" paid)
check "one capture transaction under concurrency" $(eq "$(ntx /tmp/pu6.jar $O6 capture)" 1)
check "stock decremented once" $(eq "$(stock $P)" "$((S6-1))")

echo "== 8. Price changes between review and approval"
newuser /tmp/pu7.jar; P7=$(curl -s "$A/products?sort=price_asc&limit=20" | js "[p['id'] for p in d['items'] if p['stock']>=5][1]")
O7=$(prepare /tmp/pu7.jar $P7 1)
curl -s -b /tmp/pu7.jar -X PUT -H "$H" -d '{"targetPrice":1}' $A/watches/$P7 >/dev/null
curl -s -c /tmp/padm.jar -H "$H" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" $A/auth/login >/dev/null
OLD=$(curl -s $A/products/$P7 | js "d['product']['price']"); NEW=$((OLD+100))
curl -s -b /tmp/padm.jar -X PUT -H "$H" -d "{\"price\":$NEW}" $A/admin/products/$P7 >/dev/null
RSP=$(curl -s -b /tmp/pu7.jar -H "$H" -d '{"confirm":true}' -w '\n%{http_code}' $A/orders/$O7/approve)
check "approve after price change -> 409 PRICE_CHANGED" $(eq "$(echo "$RSP" | tail -1)/$(echo "$RSP" | head -1 | js "d['code']")" "409/PRICE_CHANGED")
check "order total re-priced and back to awaiting_approval" $(eq "$(ostat /tmp/pu7.jar $O7)" awaiting_approval)
check "price watcher notified about the real change" $([ "$(curl -s -b /tmp/pu7.jar $A/notifications | js "len([n for n in d['items'] if n['type'] in ('price_change','price_target')])")" -ge 1 ] && echo 0 || echo 1)
curl -s -b /tmp/padm.jar -X PUT -H "$H" -d "{\"price\":$OLD}" $A/admin/products/$P7 >/dev/null

echo "== 8b. Re-approving after a price change creates a NEW PayPal order (request id not reused)"
newuser /tmp/pu8.jar; P8=$(curl -s "$A/products?sort=price_asc&limit=20" | js "[p['id'] for p in d['items'] if p['stock']>=5][2]")
O8=$(prepare /tmp/pu8.jar $P8 1)
PPA=$(approve /tmp/pu8.jar $O8 | js "d['order']['paypalOrderId']")
OLD8=$(curl -s $A/products/$P8 | js "d['product']['price']"); NEW8=$((OLD8+100))
curl -s -b /tmp/padm.jar -X PUT -H "$H" -d "{\"price\":$NEW8}" $A/admin/products/$P8 >/dev/null
approve /tmp/pu8.jar $O8 >/dev/null
PPB=$(approve /tmp/pu8.jar $O8 | js "d['order']['paypalOrderId']")
check "re-approval after price change yields a different PayPal order id" $([ -n "$PPB" ] && [ "$PPB" != "$PPA" ] && echo 0 || echo 1)
check "order is awaiting_payment again with the new PayPal order" $(eq "$(ostat /tmp/pu8.jar $O8)" awaiting_payment)
curl -s -b /tmp/padm.jar -X PUT -H "$H" -d "{\"price\":$OLD8}" $A/admin/products/$P8 >/dev/null

echo "== 9. Admin sees the activity"
ST=$(curl -s -b /tmp/padm.jar $A/admin/analytics)
check "admin paid orders >= 3" $([ "$(echo "$ST" | js "d['paidOrders']")" -ge 3 ] && echo 0 || echo 1)
check "admin payment overview lists completed + failures" $(eq "$(echo "$ST" | js "any(x['status']=='completed' for x in d['paymentOverview']['byOutcome']) and any(x['kind']=='failure' for x in d['paymentOverview']['byOutcome'])")" True)
check "admin revenue summary > 0" $([ "$(echo "$ST" | js "int(d['revenue']['allTime']>0)")" = "1" ] && echo 0 || echo 1)
check "admin webhook log has events" $([ "$(curl -s -b /tmp/padm.jar $A/admin/webhooks | js "len(d['items'])")" -ge 3 ] && echo 0 || echo 1)

echo; echo "RESULT: $PASS passed, $FAIL failed  (against a LOCAL MOCK of PayPal; run a real Sandbox payment before submitting)"
[ "$FAIL" = "0" ]
