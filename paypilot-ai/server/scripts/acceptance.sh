#!/usr/bin/env bash
# Acceptance test: walks the 15-step shopping workflow, then the negative cases.
# PayPal is a LOCAL MOCK (scripts/mock-paypal.mjs), so steps 10-13 prove OUR logic, not PayPal's sandbox.
# Usage (from server/): npm run test:acceptance   (needs MongoDB + seeded DB)
set -u
cd "$(dirname "$0")/.."
curl() { command curl -m 20 "$@"; }
API_PORT="${TEST_API_PORT:-4002}"; MOCK_PORT="${MOCK_PAYPAL_PORT:-4011}"
A="http://localhost:$API_PORT/api"; M="http://127.0.0.1:$MOCK_PORT"; H='Content-Type: application/json'
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@paypilot.dev}"; ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe-Admin-123}"
PASS=0; FAIL=0
js() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))
except Exception: print('')" "$1"; }
check() { if [ "$2" = "0" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi; }
ok() { [ "$1" = "True" ] && echo 0 || echo 1; }
eq() { [ "$1" = "$2" ] && echo 0 || echo 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
mode() { curl -s -H "$H" -d "{\"mode\":\"$1\",\"signature\":\"${2:-SUCCESS}\"}" $M/__mode >/dev/null; }
cleanup() { kill $MOCK_PID $API_PID 2>/dev/null; }; trap cleanup EXIT

MOCK_PAYPAL_PORT=$MOCK_PORT node scripts/mock-paypal.mjs > /tmp/acc-mock.log 2>&1 & MOCK_PID=$!
PORT=$API_PORT NODE_ENV=development PAYPAL_API_BASE=$M PAYPAL_CLIENT_ID=mock PAYPAL_CLIENT_SECRET=mock PAYPAL_WEBHOOK_ID=MOCKWH PAYPAL_CURRENCY=USD INR_PER_UNIT=88 \
  node --import tsx src/index.ts > /tmp/acc-api.log 2>&1 & API_PID=$!
for i in $(seq 1 30); do curl -s $A/health >/dev/null 2>&1 && break; sleep 0.5; done
curl -s $A/health | grep -q ok || { echo "API did not start"; cat /tmp/acc-api.log; exit 1; }
mode ok

U=/tmp/acc_user.jar; rm -f $U; EMAIL="acc_$RANDOM$RANDOM@example.com"; PW='Passw0rd!123'
hook() { curl -s -o /tmp/acc-hook.out -w '%{http_code}' -H "$H" -H 'paypal-transmission-id: t' -H 'paypal-transmission-sig: s' -H 'paypal-auth-algo: a' -H 'paypal-cert-url: c' -H 'paypal-transmission-time: now' \
  -d "{\"id\":\"$1\",\"event_type\":\"$2\",\"summary\":\"t\",\"resource\":{\"id\":\"$4\",\"status\":\"${7:-COMPLETED}\",\"custom_id\":\"$3\",\"amount\":{\"value\":\"$5\",\"currency_code\":\"$6\"}}}" $A/webhooks/paypal; }

echo "== 1. Register and log in"
check "register (201 Created)" $(eq "$(code -c $U -H "$H" -d "{\"name\":\"Acceptance User\",\"email\":\"$EMAIL\",\"password\":\"$PW\"}" $A/auth/register)" 201)
rm -f $U
check "login with the same credentials" $(eq "$(code -c $U -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" $A/auth/login)" 200)
check "session cookie is HttpOnly" $(grep -q "#HttpOnly_" $U && echo 0 || echo 1)
check "me returns the user" $(eq "$(curl -s -b $U $A/auth/me | js "d['user']['email']")" "$EMAIL")

echo "== 2-6. Natural language request -> structured intent -> real products -> compare/rank -> explanation"
R=$(curl -s -b $U -H "$H" -d '{"message":"I need a laptop under 60000 for programming"}' $A/assistant/message)
echo "$R" > /tmp/acc-ai.json
check "2. assistant answers a natural-language request" $([ -n "$(echo "$R" | js "d.get('message')")" ] && echo 0 || echo 1)
check "3. intent structured: action=search, category=laptops" $(eq "$(echo "$R" | js "d['intent']['action']+'/'+str(d['intent']['category'])")" "search/laptops")
check "3. intent structured: maxBudget=60000" $(eq "$(echo "$R" | js "d['intent']['maxBudget']")" 60000)
check "3. intent captured use case 'programming'" $(ok "$(echo "$R" | js "any('program' in x.lower() or 'cod' in x.lower() for x in d['intent']['useCases'])")")
check "4. returned >=2 product cards" $(ok "$(echo "$R" | js "len(d['cards'])>=2")")
IDS=$(echo "$R" | js "' '.join(c['product']['id'] for c in d['cards'])")
ALLREAL=0; for id in $IDS; do [ "$(code $A/products/$id)" = "200" ] || ALLREAL=1; done
check "4. every recommended product exists in the application database" $ALLREAL
check "4. every product is a laptop within the 60000 budget" $(ok "$(echo "$R" | js "all(c['product']['category']=='laptops' and c['product']['price']<=60000 for c in d['cards'])")")
check "5. ranks are 1..n in order" $(ok "$(echo "$R" | js "[c['explain']['rank'] for c in d['cards']]==list(range(1,len(d['cards'])+1))")")
check "5. exactly one top pick, and it is rank 1" $(ok "$(echo "$R" | js "[c['explain']['rank'] for c in d['cards'] if c['explain']['isTopPick']]==[1]")")
check "5. comparison and budget agents ran (trace)" $(ok "$(echo "$R" | js "any('Comparison' in t['agent'] for t in d['trace']) and any('Budget' in t['agent'] for t in d['trace'])")")
check "6. each recommendation has a non-empty explanation" $(ok "$(echo "$R" | js "all(len(c['explain']['why'])>10 for c in d['cards'])")")
check "6. each recommendation states budget fit" $(ok "$(echo "$R" | js "all(c['explain'].get('budgetFit') for c in d['cards'])")")
check "AI mode is disclosed in the reply" $([ -n "$(echo "$R" | js "d.get('mode')")" ] && echo 0 || echo 1)
P=$(echo "$IDS" | cut -d' ' -f1); PRICE=$(curl -s $A/products/$P | js "d['product']['price']"); STOCK0=$(curl -s $A/products/$P | js "d['product']['stock']")

echo "== 7-8. Cart and budget analysis"
check "7. add recommended product to cart" $(eq "$(code -b $U -H "$H" -d "{\"productId\":\"$P\",\"quantity\":1}" $A/cart/items)" 200)
check "8. set a budget" $(eq "$(code -b $U -X PUT -H "$H" -d '{"budget":60000}' $A/cart/budget)" 200)
C=$(curl -s -b $U $A/cart)
check "8. cart total matches product price" $(eq "$(echo "$C" | js "d['total']-d['shipping'] if 'shipping' in d else d['total']")" "$PRICE")
check "8. budget remaining = budget - total" $(eq "$(echo "$C" | js "d['budgetRemaining']")" "$((60000-$(echo "$C" | js "d['total']")))")
AB=$(curl -s -b $U -H "$H" -d '{"message":"show my cart"}' $A/assistant/message)
check "8. assistant can discuss the cart" $([ -n "$(echo "$AB" | js "d.get('message')")" ] && echo 0 || echo 1)

echo "== 9-10. Checkout summary and PayPal initiation"
PR=$(curl -s -b $U -H "$H" -d '{}' $A/checkout/prepare)
O=$(echo "$PR" | js "d['order']['_id']")
check "9. checkout summary: items, totals, charge amount" $(ok "$(echo "$PR" | js "len(d['order']['items'])==1 and d['order']['total']>0 and d['order']['chargeAmount']>0")")
check "9. order awaits user approval (nothing charged yet)" $(eq "$(echo "$PR" | js "d['order']['status']")" awaiting_approval)
check "10. cannot start PayPal without explicit confirmation" $(eq "$(code -b $U -H "$H" -d '{}' $A/orders/$O/approve)" 400)
AP=$(curl -s -b $U -H "$H" -d '{"confirm":true}' $A/orders/$O/approve); PP=$(echo "$AP" | js "d['order']['paypalOrderId']")
check "10. PayPal order created after approval" $([ -n "$PP" ] && echo 0 || echo 1)

echo "== 11-12. Approve, capture and verify"
check "11. order is awaiting payment" $(eq "$(echo "$AP" | js "d['order']['status']")" awaiting_payment)
CAP=$(curl -s -b $U -H "$H" -d "{\"paypalOrderId\":\"$PP\"}" $A/orders/$O/capture)
check "12. backend capture succeeded and verified" $(eq "$(echo "$CAP" | js "d['order']['status']")" paid)

echo "== 13. Webhook verification and processing"
AMT=$(echo "$CAP" | js "d['order']['chargeAmount']")
check "13. valid signed webhook processed (200)" $(eq "$(hook WH-ACC-$RANDOM PAYMENT.CAPTURE.COMPLETED $O CAP$PP $AMT USD)" 200)

echo "== 14. Order updated correctly"
OD=$(curl -s -b $U $A/orders/$O)
check "14. status paid with paidAt" $(ok "$(echo "$OD" | js "d['order']['status']=='paid' and bool(d['order'].get('paidAt'))")")
check "14. stock decreased by 1" $(eq "$(curl -s $A/products/$P | js "d['product']['stock']")" "$((STOCK0-1))")
check "14. cart emptied" $(eq "$(curl -s -b $U $A/cart | js "d['itemCount']")" 0)
check "14. user notified" $([ "$(curl -s -b $U $A/notifications | js "len([n for n in d['items'] if n['type']=='payment'])")" -ge 1 ] && echo 0 || echo 1)

echo "== 15. Transaction in history"
TX=$(curl -s -b $U $A/transactions)
check "15. transaction listed for this order, completed, correct amount" $(ok "$(echo "$TX" | js "any((t['orderId']['_id'] if isinstance(t['orderId'],dict) else t['orderId'])=='$O' and t['kind']=='capture' and t['status']=='completed' and abs(t['amount']-$AMT)<0.001 for t in d['items'])")")
check "15. order detail lists the same transaction" $(ok "$(echo "$OD" | js "len([t for t in d['transactions'] if t['kind']=='capture'])==1")")

echo; echo "=== NEGATIVE CASES ==="
newuser() { rm -f $1; curl -s -c $1 -H "$H" -d "{\"name\":\"Neg Tester\",\"email\":\"neg_$RANDOM$RANDOM@example.com\",\"password\":\"$PW\"}" $A/auth/register >/dev/null; }
prep() { curl -s -b $1 -H "$H" -d "{\"productId\":\"$P\",\"quantity\":${2:-1}}" $A/cart/items >/dev/null; curl -s -b $1 -H "$H" -d '{}' $A/checkout/prepare | js "d['order']['_id']"; }
appr() { curl -s -b $1 -H "$H" -d '{"confirm":true}' $A/orders/$2/approve | js "d['order']['paypalOrderId']"; }
st() { curl -s -b $1 $A/orders/$2 | js "d['order']['status']"; }
ntx() { curl -s -b $1 $A/orders/$2 | js "len([t for t in d['transactions'] if t['kind']=='$3'])"; }

echo "-- Failed payments"
newuser /tmp/n1.jar; O1=$(prep /tmp/n1.jar); PP1=$(appr /tmp/n1.jar $O1)
mode declined
check "declined card -> HTTP 402" $(eq "$(code -b /tmp/n1.jar -H "$H" -d "{\"paypalOrderId\":\"$PP1\"}" $A/orders/$O1/capture)" 402)
check "order not paid, failure transaction recorded" $(eq "$(st /tmp/n1.jar $O1)/$(ntx /tmp/n1.jar $O1 failure)" "awaiting_payment/1")
mode ok
check "client-reported error is logged but never marks paid" $(eq "$(code -b /tmp/n1.jar -H "$H" -d '{"event":"error","message":"boom"}' $A/orders/$O1/payment-event)/$(st /tmp/n1.jar $O1)" "200/awaiting_payment")
check "retry after a failure can still succeed" $(eq "$(curl -s -b /tmp/n1.jar -H "$H" -d "{\"paypalOrderId\":\"$PP1\"}" $A/orders/$O1/capture | js "d['order']['status']")" paid)

echo "-- Cancelled payments"
newuser /tmp/n2.jar; O2=$(prep /tmp/n2.jar); PP2=$(appr /tmp/n2.jar $O2)
check "client reports cancel at PayPal" $(eq "$(code -b /tmp/n2.jar -H "$H" -d '{"event":"cancelled"}' $A/orders/$O2/payment-event)" 200)
check "cancel logged as transaction, order NOT paid" $(eq "$(ntx /tmp/n2.jar $O2 cancel)/$(st /tmp/n2.jar $O2)" "1/awaiting_payment")
check "user cancels the order" $(eq "$(code -b /tmp/n2.jar -X POST $A/orders/$O2/cancel)" 200)
check "order status is cancelled" $(eq "$(st /tmp/n2.jar $O2)" cancelled)
check "capture on a cancelled order is refused" $([ "$(code -b /tmp/n2.jar -H "$H" -d "{\"paypalOrderId\":\"$PP2\"}" $A/orders/$O2/capture)" -ge 400 ] && echo 0 || echo 1)
check "cancelling again is refused" $(eq "$(code -b /tmp/n2.jar -X POST $A/orders/$O2/cancel)" 409)
check "paid order cannot be cancelled" $(eq "$(code -b $U -X POST $A/orders/$O/cancel)" 409)
check "paid order unaffected by a later client 'cancelled' event" $(eq "$(code -b $U -H "$H" -d '{"event":"cancelled"}' $A/orders/$O/payment-event)/$(st $U $O)" "200/paid")

echo "-- Duplicate requests"
newuser /tmp/n3.jar; O3=$(prep /tmp/n3.jar); PP3=$(appr /tmp/n3.jar $O3)
check "duplicate approve returns the same PayPal order" $(eq "$(appr /tmp/n3.jar $O3)" "$PP3")
curl -s -b /tmp/n3.jar -H "$H" -d "{\"paypalOrderId\":\"$PP3\"}" $A/orders/$O3/capture >/dev/null
check "duplicate capture is idempotent" $(eq "$(curl -s -b /tmp/n3.jar -H "$H" -d "{\"paypalOrderId\":\"$PP3\"}" $A/orders/$O3/capture | js "d.get('already')")" True)
check "only one capture transaction" $(eq "$(ntx /tmp/n3.jar $O3 capture)" 1)
A3=$(curl -s -b /tmp/n3.jar $A/orders/$O3 | js "d['order']['chargeAmount']"); EV=WH-DUP-$RANDOM
hook $EV PAYMENT.CAPTURE.COMPLETED $O3 CAP$PP3 $A3 USD >/dev/null
check "duplicate webhook event id ignored" $(eq "$(hook $EV PAYMENT.CAPTURE.COMPLETED $O3 CAP$PP3 $A3 USD)/$(js "d.get('duplicate')" < /tmp/acc-hook.out)" "200/True")
newuser /tmp/n4.jar; O4=$(prep /tmp/n4.jar); PP4=$(appr /tmp/n4.jar $O4); S4=$(curl -s $A/products/$P | js "d['product']['stock']")
printf '%s\n' 1 2 3 4 5 | xargs -P5 -I{} curl -s -o /dev/null -b /tmp/n4.jar -H "$H" -d "{\"paypalOrderId\":\"$PP4\"}" $A/orders/$O4/capture
check "5 concurrent captures -> paid once, one transaction, stock -1" $(eq "$(st /tmp/n4.jar $O4)/$(ntx /tmp/n4.jar $O4 capture)/$(curl -s $A/products/$P | js "d['product']['stock']")" "paid/1/$((S4-1))")
check "duplicate registration rejected" $([ "$(code -H "$H" -d "{\"name\":\"X Y\",\"email\":\"$EMAIL\",\"password\":\"$PW\"}" $A/auth/register)" -ge 400 ] && echo 0 || echo 1)

echo "-- Unauthorized access"
for ep in "GET cart" "GET orders" "GET transactions" "GET wishlist" "GET notifications" "GET dashboard" "GET watches" "POST checkout/prepare" "POST assistant/message"; do
  set -- $ep; check "no session: $ep -> 401" $(eq "$(code -X $1 -H "$H" -d '{}' $A/$2)" 401)
done
check "no session: capture -> 401" $(eq "$(code -X POST -H "$H" -d '{"paypalOrderId":"X"}' $A/orders/$O/capture)" 401)
check "tampered cookie -> not authenticated" $(eq "$(code -H 'Cookie: token=abc.def.ghi' $A/cart)" 401)
check "user B cannot read user A's order" $(eq "$(code -b /tmp/n3.jar $A/orders/$O)" 404)
check "user B cannot capture user A's order" $(eq "$(code -b /tmp/n3.jar -H "$H" -d "{\"paypalOrderId\":\"$PP1\"}" $A/orders/$O/capture)" 404)
newuser /tmp/n8.jar; O8=$(prep /tmp/n8.jar); check "user B cannot cancel user A's open order" $(eq "$(code -b /tmp/n3.jar -X POST $A/orders/$O8/cancel)/$(st /tmp/n8.jar $O8)" "409/awaiting_approval")
check "user B cannot see user A's transactions" $(eq "$(curl -s -b /tmp/n3.jar $A/transactions | js "len([t for t in d['items'] if (t['orderId']['_id'] if isinstance(t['orderId'],dict) else t['orderId'])=='$O'])")" 0)
for ep in admin/stats admin/users admin/orders admin/ai-activity admin/products; do check "plain user: $ep -> 403" $(eq "$(code -b $U $A/$ep)" 403); done
check "plain user cannot change a role" $(eq "$(code -b $U -X PATCH -H "$H" -d '{"role":"admin"}' $A/admin/users/000000000000000000000000)" 403)
check "plain user cannot create products" $(eq "$(code -b $U -H "$H" -d '{"name":"x"}' $A/admin/products)" 403)
check "registration cannot self-assign admin" $(eq "$(curl -s -H "$H" -d "{\"name\":\"Sneaky\",\"email\":\"sn$RANDOM@example.com\",\"password\":\"$PW\",\"role\":\"admin\"}" $A/auth/register | js "d['user']['role']")" user)
check "NoSQL injection in login rejected" $([ "$(code -H "$H" -d '{"email":{"$gt":""},"password":{"$gt":""}}' $A/auth/login)" -ge 400 ] && echo 0 || echo 1)

echo "-- Invalid order amounts"
newuser /tmp/n5.jar
for q in 0 -1 1.5 999999 '"abc"'; do check "cart quantity $q rejected" $(eq "$(code -b /tmp/n5.jar -H "$H" -d "{\"productId\":\"$P\",\"quantity\":$q}" $A/cart/items)" 400); done
check "unknown product id rejected" $([ "$(code -b /tmp/n5.jar -H "$H" -d '{"productId":"000000000000000000000000","quantity":1}' $A/cart/items)" -ge 400 ] && echo 0 || echo 1)
check "malformed product id rejected" $(eq "$(code -b /tmp/n5.jar -H "$H" -d '{"productId":"zzz","quantity":1}' $A/cart/items)" 400)
check "negative budget rejected" $(eq "$(code -b /tmp/n5.jar -X PUT -H "$H" -d '{"budget":-5}' $A/cart/budget)" 400)
check "checkout with empty cart rejected" $([ "$(code -b /tmp/n5.jar -H "$H" -d '{}' $A/checkout/prepare)" -ge 400 ] && echo 0 || echo 1)
check "client cannot dictate the price at checkout" $(ok "$(curl -s -b /tmp/n5.jar -H "$H" -d "{\"productId\":\"$P\",\"quantity\":1,\"price\":1}" $A/cart/items >/dev/null; curl -s -b /tmp/n5.jar -H "$H" -d '{"total":1,"chargeAmount":0.01}' $A/checkout/prepare | js "d['order']['total']==$PRICE and d['order']['chargeAmount']>0.5")")
newuser /tmp/n6.jar; O6=$(prep /tmp/n6.jar); PP6=$(appr /tmp/n6.jar $O6); A6=$(curl -s -b /tmp/n6.jar $A/orders/$O6 | js "d['order']['chargeAmount']")
mode wrong_amount
check "PayPal reports a different amount -> 409, not paid" $(eq "$(code -b /tmp/n6.jar -H "$H" -d "{\"paypalOrderId\":\"$PP6\"}" $A/orders/$O6/capture)/$(st /tmp/n6.jar $O6)" "409/awaiting_payment")
mode ok
newuser /tmp/n7.jar; O7=$(prep /tmp/n7.jar); appr /tmp/n7.jar $O7 >/dev/null; A7=$(curl -s -b /tmp/n7.jar $A/orders/$O7 | js "d['order']['chargeAmount']")
check "webhook with lower amount rejected" $(eq "$(hook WH-LOW-$RANDOM PAYMENT.CAPTURE.COMPLETED $O7 CAPLOW 0.01 USD)" 409)
check "webhook with wrong currency rejected" $(eq "$(hook WH-CUR-$RANDOM PAYMENT.CAPTURE.COMPLETED $O7 CAPCUR $A7 EUR)" 409)
check "webhook for unknown order id is acknowledged but ignored (no payment recorded)" $(eq "$(hook WH-UNK-$RANDOM PAYMENT.CAPTURE.COMPLETED 000000000000000000000000 CAPUNK 10 USD)/$(js "d['outcome']" < /tmp/acc-hook.out)" "200/ignored")
check "webhook with malformed order id does not crash (4xx)" $([ "$(hook WH-BAD-$RANDOM PAYMENT.CAPTURE.COMPLETED not-an-id CAPBAD 10 USD)" -lt 500 ] && echo 0 || echo 1)
check "order still unpaid after all tampering" $(eq "$(st /tmp/n7.jar $O7)" awaiting_payment)

echo "-- Invalid webhook signatures"
mode ok FAILURE
check "failed signature verification -> 400, order untouched" $(eq "$(hook WH-SIG-$RANDOM PAYMENT.CAPTURE.COMPLETED $O7 CAPSIG $A7 USD)/$(st /tmp/n7.jar $O7)" "400/awaiting_payment")
mode ok SUCCESS
check "missing PayPal headers -> 400" $(eq "$(code -H "$H" -d '{"id":"WH-NOHDR","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{}}' $A/webhooks/paypal)" 400)
check "non-JSON body -> 4xx" $([ "$(code -H "$H" -d 'not json' $A/webhooks/paypal)" -lt 500 ] && echo 0 || echo 1)
check "unsigned request to spec alias /paypal/webhook -> 400" $(eq "$(code -H "$H" -d '{"id":"x"}' $A/paypal/webhook)" 400)
check "after a verified webhook the order is paid (webhook-only path)" $(eq "$(hook WH-OK-$RANDOM PAYMENT.CAPTURE.COMPLETED $O7 CAPOK$RANDOM $A7 USD)/$(st /tmp/n7.jar $O7)" "200/paid")

echo; echo "RESULT: $PASS passed, $FAIL failed  (PayPal = local mock; real Sandbox run still required)"
[ "$FAIL" = "0" ]
