#!/usr/bin/env bash
# End-to-end smoke test against a RUNNING API (default http://localhost:4000).
# Usage: API=http://localhost:4000/api bash scripts/e2e.sh
# Requires: curl, python3. The DB should be seeded (npm run seed) with ADMIN_EMAIL/ADMIN_PASSWORD from .env.
set -u
A="${API:-http://localhost:4000/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@paypilot.dev}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe-Admin-123}"
H='Content-Type: application/json'
U=/tmp/e2e_user.jar; AD=/tmp/e2e_admin.jar; rm -f $U $AD
PASS=0; FAIL=0
js() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  print(eval(sys.argv[1], {'d': d}))
except Exception as e:
  print('')" "$1"; }
check() { # name, condition(0=ok)
  if [ "$2" = "0" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

EMAIL="e2e_$(date +%s)@example.com"
echo "== Auth"
R=$(curl -s -c $U -b $U -H "$H" -d "{\"name\":\"E2E User\",\"email\":\"$EMAIL\",\"password\":\"Passw0rd!123\"}" $A/auth/register)
check "register returns user" $([ "$(echo "$R" | js "d['user']['email']")" = "$EMAIL" ] && echo 0 || echo 1)
check "register hides passwordHash" $(echo "$R" | grep -q passwordHash && echo 1 || echo 0)
check "duplicate register rejected" $([ "$(code -H "$H" -d "{\"name\":\"X\",\"email\":\"$EMAIL\",\"password\":\"Passw0rd!123\"}" $A/auth/register)" -ge 400 ] && echo 0 || echo 1)
check "weak password rejected" $([ "$(code -H "$H" -d '{"name":"X","email":"weak@example.com","password":"1"}' $A/auth/register)" = "400" ] && echo 0 || echo 1)
check "me works with cookie" $([ "$(code -b $U $A/auth/me)" = "200" ] && echo 0 || echo 1)
check "me returns null user without cookie" $([ "$(curl -s $A/auth/me | js "d['user']")" = "None" ] && echo 0 || echo 1)
check "wrong password rejected" $([ "$(code -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"nope-nope-1\"}" $A/auth/login)" = "401" ] && echo 0 || echo 1)

echo "== Products"
R=$(curl -s -b $U "$A/products?limit=48")
PID=$(echo "$R" | js "d['items'][0]['id']")
PID2=$(echo "$R" | js "d['items'][1]['id']")
check "product list non-empty" $([ -n "$PID" ] && echo 0 || echo 1)
check "product detail" $([ "$(code -b $U $A/products/$PID)" = "200" ] && echo 0 || echo 1)
check "invalid product id -> 4xx" $([ "$(code -b $U $A/products/not-an-id)" -lt 500 ] && echo 0 || echo 1)
check "compare" $([ "$(code -b $U "$A/compare?ids=$PID,$PID2")" = "200" ] && echo 0 || echo 1)

echo "== Cart"
check "add to cart" $([ "$(code -b $U -H "$H" -d "{\"productId\":\"$PID\",\"quantity\":2}" $A/cart/items)" = "200" ] && echo 0 || echo 1)
check "quantity above max rejected" $([ "$(code -b $U -X PATCH -H "$H" -d '{"quantity":999}' $A/cart/items/$PID)" = "400" ] && echo 0 || echo 1)
check "update quantity" $([ "$(code -b $U -X PATCH -H "$H" -d '{"quantity":1}' $A/cart/items/$PID)" = "200" ] && echo 0 || echo 1)
check "set budget" $([ "$(code -b $U -X PUT -H "$H" -d '{"budget":90000}' $A/cart/budget)" = "200" ] && echo 0 || echo 1)
CART=$(curl -s -b $U $A/cart)
check "cart has 1 line" $([ "$(echo "$CART" | js "len(d.get('items', d.get('cart',{}).get('items',[])))")" = "1" ] && echo 0 || echo 1)

echo "== Checkout (server-side totals, no fake success)"
R=$(curl -s -b $U -H "$H" -d '{"source":"cart"}' $A/checkout/prepare)
OID=$(echo "$R" | js "(d.get('order') or d).get('id') or (d.get('order') or d).get('_id')")
check "prepare creates order" $([ -n "$OID" ] && echo 0 || echo 1)
check "order starts awaiting_approval" $([ "$(echo "$R" | js "(d.get('order') or d).get('status')")" = "awaiting_approval" ] && echo 0 || echo 1)
check "capture before approval refused" $([ "$(code -b $U -X POST $A/orders/$OID/capture)" -ge 400 ] && echo 0 || echo 1)
check "approve without confirm refused" $([ "$(code -b $U -H "$H" -d '{}' $A/orders/$OID/approve)" -ge 400 ] && echo 0 || echo 1)
APPROVE=$(code -b $U -H "$H" -d '{"confirm":true}' $A/orders/$OID/approve)
echo "  info  approve with confirm -> HTTP $APPROVE (503/5xx expected when PayPal keys are absent; must never be a fake success)"
STATUS=$(curl -s -b $U $A/orders/$OID | js "(d.get('order') or d).get('status')")
check "order NOT marked paid without PayPal" $([ "$STATUS" != "paid" ] && echo 0 || echo 1)
check "webhook rejects unsigned request" $([ "$(code -H "$H" -d '{"id":"WH-FAKE","event_type":"PAYMENT.CAPTURE.COMPLETED"}' $A/webhooks/paypal)" = "400" ] && echo 0 || echo 1)
check "other user cannot read order" $([ "$(code -b $AD $A/orders/$OID)" != "200" ] && echo 0 || echo 1)

echo "== Wishlist / Price watch / Notifications / Preferences"
check "wishlist add" $([ "$(code -b $U -X POST $A/wishlist/$PID)" -lt 300 ] && echo 0 || echo 1)
check "wishlist list" $([ "$(curl -s -b $U $A/wishlist | js "len(d['items'])")" = "1" ] && echo 0 || echo 1)
check "price watch set" $([ "$(code -b $U -X PUT -H "$H" -d '{"targetPrice":1000}' $A/watches/$PID)" -lt 300 ] && echo 0 || echo 1)
check "price watch list" $([ "$(curl -s -b $U $A/watches | js "len(d['items'])")" = "1" ] && echo 0 || echo 1)
check "notifications list" $([ "$(code -b $U $A/notifications)" = "200" ] && echo 0 || echo 1)
check "preferences update" $([ "$(code -b $U -X PUT -H "$H" -d '{"brands":["Orbit"],"categories":["phones"],"maxBudget":60000,"specs":["camera"]}' $A/me/preferences)" -lt 300 ] && echo 0 || echo 1)
check "dashboard" $([ "$(code -b $U $A/dashboard)" = "200" ] && echo 0 || echo 1)
check "transactions" $([ "$(code -b $U $A/transactions)" = "200" ] && echo 0 || echo 1)

echo "== Spec-shaped endpoints"
check "GET /products/search" $([ "$(code "$A/products/search?q=phone")" = "200" ] && echo 0 || echo 1)
check "POST /products/compare" $([ "$(code -H "$H" -d "{\"ids\":[\"$PID\",\"$PID2\"]}" $A/products/compare)" = "200" ] && echo 0 || echo 1)
check "POST /products/compare needs 2+ ids" $([ "$(code -H "$H" -d "{\"ids\":[\"$PID\"]}" $A/products/compare)" = "400" ] && echo 0 || echo 1)
check "GET /preferences" $([ "$(curl -s -b $U $A/preferences | js "d['preferences']['maxBudget']")" = "60000" ] && echo 0 || echo 1)
check "PATCH /preferences (partial)" $([ "$(curl -s -b $U -X PATCH -H "$H" -d '{"maxBudget":70000}' $A/preferences | js "d['user']['preferences']['maxBudget']")" = "70000" ] && echo 0 || echo 1)
check "PATCH /preferences keeps other fields" $([ "$(curl -s -b $U $A/preferences | js "d['preferences']['brands']")" = "['Orbit']" ] && echo 0 || echo 1)
check "POST /wishlist (body)" $([ "$(code -b $U -H "$H" -d "{\"productId\":\"$PID2\"}" $A/wishlist)" = "200" ] && echo 0 || echo 1)
check "POST /price-watch (body)" $([ "$(code -b $U -H "$H" -d "{\"productId\":\"$PID2\",\"targetPrice\":999}" $A/price-watch)" = "200" ] && echo 0 || echo 1)
check "GET /price-watch" $([ "$(curl -s -b $U $A/price-watch | js "len(d['items'])")" = "2" ] && echo 0 || echo 1)
check "DELETE /price-watch/:id" $([ "$(code -b $U -X DELETE $A/price-watch/$PID2)" = "200" ] && echo 0 || echo 1)
check "POST /paypal/create-order w/o PayPal keys -> 503" $([ "$(code -b $U -H "$H" -d "{\"orderId\":\"$OID\",\"confirm\":true}" $A/paypal/create-order)" = "503" ] && echo 0 || echo 1)
check "POST /paypal/capture-order refused when not approved" $([ "$(code -b $U -H "$H" -d "{\"orderId\":\"$OID\",\"paypalOrderId\":\"FAKE12345\"}" $A/paypal/capture-order)" -ge 400 ] && echo 0 || echo 1)
check "POST /paypal/webhook rejects unsigned" $([ "$(code -H "$H" -d '{"id":"WH-X"}' $A/paypal/webhook)" = "400" ] && echo 0 || echo 1)
R=$(curl -s -b $U -H "$H" -d '{"message":"show me a phone under 70000"}' $A/ai/chat)
check "POST /ai/chat" $([ -n "$(echo "$R" | js "d.get('message')")" ] && echo 0 || echo 1)
check "POST /ai/agent/run returns agent trace" $([ "$(curl -s -b $U -H "$H" -d '{"message":"best laptop under 90000 for programming"}' $A/ai/agent/run | js "len(d['trace'])>=3")" = "True" ] && echo 0 || echo 1)
RR=$(curl -s -b $U -H "$H" -X POST $A/ai/recommendations)
check "POST /ai/recommendations has items + reasons" $([ "$(echo "$RR" | js "len(d['items'])>0 and len(d['items'][0]['reasons'])>0")" = "True" ] && echo 0 || echo 1)
check "recommendations respect saved budget" $([ "$(echo "$RR" | js "all(i['price']<=70000 for i in d['items'])")" = "True" ] && echo 0 || echo 1)
check "assistant input over 1000 chars rejected" $([ "$(code -b $U -H "$H" -d "{\"message\":\"$(python3 -c 'print("a"*1001)')\"}" $A/ai/chat)" = "400" ] && echo 0 || echo 1)

echo "== Dashboard (real data)"
D=$(curl -s -b $U $A/dashboard)
check "dashboard stats present" $([ "$(echo "$D" | js "all(k in d['stats'] for k in ['orders','paidOrders','spent','totalPurchases','successfulTransactions'])")" = "True" ] && echo 0 || echo 1)
check "dashboard has budget overview" $([ "$(echo "$D" | js "'cartBudget' in d['budget']")" = "True" ] && echo 0 || echo 1)
check "dashboard recommendations" $([ "$(echo "$D" | js "len(d['recommendations']['items'])>0")" = "True" ] && echo 0 || echo 1)
check "dashboard activity feed" $([ "$(echo "$D" | js "len(d['activity'])>0")" = "True" ] && echo 0 || echo 1)
check "new user has 0 paid orders (no fake data)" $([ "$(echo "$D" | js "d['stats']['paidOrders']")" = "0" ] && echo 0 || echo 1)

echo "== AI assistant (rules mode when no key)"
R=$(curl -s -b $U -H "$H" -d '{"message":"best phone under 60000 for camera"}' $A/assistant/message)
check "assistant replies" $([ -n "$(echo "$R" | js "d.get('reply') or d.get('message') or d.get('text') or ''")" ] && echo 0 || echo 1)
check "assistant exposes tool trace" $(echo "$R" | grep -qiE 'trace|tools|agent' && echo 0 || echo 1)
check "assistant requires auth" $([ "$(code -H "$H" -d '{"message":"hi"}' $A/assistant/message)" = "401" ] && echo 0 || echo 1)

echo "== Admin RBAC"
check "user blocked from admin/stats" $([ "$(code -b $U $A/admin/stats)" = "403" ] && echo 0 || echo 1)
check "user blocked from admin/users" $([ "$(code -b $U $A/admin/users)" = "403" ] && echo 0 || echo 1)
curl -s -c $AD -b $AD -H "$H" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" $A/auth/login >/dev/null
check "admin login role" $([ "$(curl -s -b $AD $A/auth/me | js "d['user']['role']")" = "admin" ] && echo 0 || echo 1)
check "admin stats" $([ "$(code -b $AD $A/admin/stats)" = "200" ] && echo 0 || echo 1)
check "admin orders" $([ "$(code -b $AD $A/admin/orders)" = "200" ] && echo 0 || echo 1)
check "admin users" $([ "$(code -b $AD $A/admin/users)" = "200" ] && echo 0 || echo 1)
check "admin AI activity" $([ "$(code -b $AD $A/admin/ai-activity)" = "200" ] && echo 0 || echo 1)
TUID=$(curl -s -b $U $A/auth/me | js "d['user']['id']")
AU=$(curl -s -b $AD "$A/admin/users?q=e2e_")
check "admin users search + counts" $([ "$(echo "$AU" | js "len(d['items'])>0 and 'aiRuns' in d['items'][0]")" = "True" ] && echo 0 || echo 1)
check "admin users never expose passwordHash" $(echo "$AU" | grep -q passwordHash && echo 1 || echo 0)
ME=$(curl -s -b $AD $A/auth/me | js "d['user']['id']")
check "admin cannot change own role" $([ "$(code -b $AD -X PATCH -H "$H" -d '{"role":"user"}' $A/admin/users/$ME)" = "400" ] && echo 0 || echo 1)
check "admin invalid role rejected" $([ "$(code -b $AD -X PATCH -H "$H" -d '{"role":"superuser"}' $A/admin/users/$TUID)" = "400" ] && echo 0 || echo 1)
check "user cannot change roles" $([ "$(code -b $U -X PATCH -H "$H" -d '{"role":"admin"}' $A/admin/users/$TUID)" = "403" ] && echo 0 || echo 1)
check "admin promotes then demotes user" $([ "$(curl -s -b $AD -X PATCH -H "$H" -d '{"role":"admin"}' $A/admin/users/$TUID | js "d['user']['role']")" = "admin" ] && [ "$(curl -s -b $AD -X PATCH -H "$H" -d '{"role":"user"}' $A/admin/users/$TUID | js "d['user']['role']")" = "user" ] && echo 0 || echo 1)
AI=$(curl -s -b $AD $A/admin/ai-activity)
check "AI activity lists logged runs" $([ "$(echo "$AI" | js "len(d['recent'])>0 and d['recent'][0]['ok'] in (True,False)")" = "True" ] && echo 0 || echo 1)
check "AI activity per-agent stats" $([ "$(echo "$AI" | js "len(d['byAgent'])>0")" = "True" ] && echo 0 || echo 1)
ST=$(curl -s -b $AD $A/admin/analytics)
check "admin analytics: revenue + payment overview + ai" $([ "$(echo "$ST" | js "all(k in d for k in ['revenue','paymentOverview','ai','revenueByCategory'])")" = "True" ] && echo 0 || echo 1)
check "admin products" $([ "$(code -b $AD $A/admin/products)" = "200" ] && echo 0 || echo 1)

echo "== Logout"
check "logout" $([ "$(code -b $U -c $U -X POST $A/auth/logout)" = "200" ] && echo 0 || echo 1)
check "me null after logout" $([ "$(curl -s -b $U $A/auth/me | js "d['user']")" = "None" ] && echo 0 || echo 1)

echo; echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
