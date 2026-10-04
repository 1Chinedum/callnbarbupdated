# CallNBarb app: developer guide

Delta State (Nigeria) on-demand barber booking. Android app = this `www/` web app wrapped by Capacitor.
Backend (Express + node:sqlite, TypeScript) lives in `../backend` and also serves `www/` at `/`.

## Layout
- `www/index.html`   customer + barber app (hash router, `#/path`)
- `www/admin.html`   admin dashboard (desktop-first web page, separate entry)
- `www/js/`          shared modules: `api.js ui.js router.js state.js maps.js qr.js config.js auth.js app.js`
- `www/js/customer/` customer pages, entry `index.js` exporting `register(router)`
- `www/js/barber/`   barber pages, entry `index.js` exporting `register(router)`
- `www/js/admin/`    admin pages
- `www/css/app.css`  design system (tokens + components). Area CSS: `customer.css`, `barber.css`, `admin.css`.

## Shared modules (read them before writing pages)
- `ui.js`: `h(tag, attrs, ...children)` DOM builder, `icon(name)`, `naira(kobo)`, `fmtDate/fmtTime/fmtDateTime`, `avatar`, `stars`,
  `statusChip`, `empty`, `errorBox`, `skeletonList`, `spinnerBlock`, `asyncButton(label, async fn, {cls, icon})`, `field/input/select/switchRow`,
  `toast`, `sheet`, `confirmDialog`, `promptDialog`, `banner`, `kv`, `mount(el, ...children)`.
- `api.js`: `api(path, {method, body, query, auth})` (prefixes `/api`, bearer token, throws `ApiError` with a user-safe `.message`), `session`, `uploadFile(file, kind)`, `privateFileUrl(url)`.
- `router.js`: `router.add('/path/:id', handler, opts)`; handler `(ctx) => Node | Promise<Node>`;
  `ctx = { params, query, user, onLeave(fn), setTitle(t), reload() }`. Use `ctx.onLeave` to stop timers/cameras/maps.
  opts: `{ roles:['customer'], back:true|'/path', title:'Booking', tabs:false, tab:'/bookings' }`. `back` swaps the brand header for a back button + title.
  Pages return ONLY the page content (the shell, top bar and bottom tabs are added by `app.js`).
- `maps.js`: Leaflet+OSM locked to Delta State: `createMap, mapBox, addMarker, fitMarkers, pickLocation, currentPosition, directionsButton/directionsUrl, inDelta`.
  A map needs its container attached to the DOM before it measures: create it in `requestAnimationFrame`/`setTimeout` after the page node is returned, and call `ctx.onLeave(() => map.remove())`.
- `qr.js`: `qrImage(text)` (customer ticket), `startScanner(elId, onScan)` (barber camera).
- `state.js`: `state.meta` (towns, banks, rules, paymentMode), `getTown()`, `townInfo(name)`.

## Hard rules
1. NEVER use `innerHTML`/`insertAdjacentHTML` with data. Build DOM with `h()`; text children are escaped automatically.
2. Money is integer **kobo** everywhere. Show with `naira(kobo)`. Convert user input with `toKobo()`. Never compute fees/commission/earnings on the client; show what the server returns.
3. The client never decides payment success, booking status, wallet balance or earnings. Always re-read from the API.
4. Delta State only: town pickers list `state.meta.towns`; maps are locked to Delta; explain the limit in plain words when relevant.
5. Copy: sentence case, plain words, active voice. Buttons say what happens ("Pay ₦3,500", "Verify and complete job"). Errors say what went wrong and how to fix it. Empty states invite an action. No ALL-CAPS labels, no "WORD — fragment" labels, no `→` on buttons.
6. Mobile first (390px wide), touch targets ≥ 44px, visible focus, labelled inputs, `aria-live` for async results. Every list has loading (skeleton), empty and error states.
7. Reuse existing CSS classes (`card, btn, chip, row, stack, list-item, kv, option, steps, slot-grid, ticket, scanner, map…`). Put page-specific CSS in your area css file, prefixed by your area (e.g. `.cust-…`). Do not restyle shared classes.
8. Do not edit shared modules unless essential. If you must, make a small additive edit (re-read the file immediately before editing, other people are editing too) and mention it in your final report.
9. Brand: "Call a Barber. Get Fresh." Palette: pole navy/red/white, money green. Icons via `icon('name')` (see ICONS in ui.js; you may add icons there additively).

## Running and testing (use YOUR OWN server + database so parallel work does not collide)
```
cd /home/claude/callnbarb/backend
PORT=<yourport> DB_PATH=/tmp/cnb-<area>.db UPLOAD_DIR=/tmp/cnb-<area>-up npx tsx src/seed.ts     # demo data
PORT=<yourport> DB_PATH=/tmp/cnb-<area>.db UPLOAD_DIR=/tmp/cnb-<area>-up APP_URL=http://localhost:<yourport> nohup npx tsx src/server.ts > /tmp/<area>.log 2>&1 &
```
Demo logins (password `Demo#1234`): customer@callnbarb.test, tunde@/emeka@/samuel@/victor@callnbarb.test (barbers, verified, Mon–Sat 9–19),
admin@callnbarb.test. Payments run in demo mode (`/api/payments/demo/pay`).
Screenshot/check pages with Playwright: `BASE=http://localhost:<port> node /home/claude/callnbarb/tools/shot.mjs "/path" /tmp/out.png email password [--desktop]`
(prints console errors; read the PNG to review the design). Drive full flows with scripted Playwright or curl against the API.
Backend routes: `../backend/src/routes/*.ts`; services in `../backend/src/services/*.ts`. Read them for exact request/response shapes; do NOT change backend behaviour (report bugs you find instead; tiny obvious fixes are OK if you say so).
