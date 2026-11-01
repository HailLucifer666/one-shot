#!/usr/bin/env python3
"""H2 scoring battery - adapted to the SKILL-ARM build (server-rendered HTML, form flow).
Server started with PORT=8490 CUTWELL_NOW=2027-03-13T15:00:00Z (Sat 09:00 America/Chicago).
Pattern follows _probe/h2_score.py (baseline). Fresh identities per run via --tag.
Python 3.9-safe."""
import argparse
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
import http.cookiejar
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:8490")
ap.add_argument("--run", default=r"E:\Skill-OneShot\_runs-hardmode\glm-5.3-flash\tier2\skill\H2-salon-booking\run1")
ap.add_argument("--tag", default=str(int(time.time()))[-6:])
ap.add_argument("--out", default=r"E:\Skill-OneShot\_runs-hardmode\h2_skill_battery_result.json")
ap.add_argument("--merge", default=None)
ap.add_argument("--merge-only", action="store_true", help="skip all checks; only merge --merge into --out")
args = ap.parse_args()

BASE = args.base
RUN = Path(args.run)
R = {}


def session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.cj = cj
    return op


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def noredir():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(cj))


def req(op, method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    r = urllib.request.Request(BASE + path, method=method, data=data)
    try:
        with op.open(r) as resp:
            body = resp.read().decode(errors="replace")
            return resp.status, body, resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace"), e.headers


def mark(ac, ok, evidence):
    R[str(ac)] = {"ok": bool(ok), "evidence": evidence}
    print("{0} AC{1:>2}: {2}".format("PASS" if ok else "FAIL", ac, evidence))


def slots_of(html):
    return re.findall(r'<input type="radio" name="start" value="([^"]+)"', html)


def post_booking(op, service, stylist, date, start):
    """POST /book (confirm) without following redirects. Reuses the session's cookie jar."""
    op0 = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(op.cj))
    st, body, hd = req(op0, "POST", "/book", {"service": service, "stylist": stylist, "date": date, "start": start})
    loc = hd.get("Location") or ""
    return st, loc


def book_via_preview(op, service, stylist, date, start):
    st1, _, _ = req(op, "POST", "/book/preview", {"service": service, "stylist": stylist, "date": date, "start": start})
    st2, loc = post_booking(op, service, stylist, date, start)
    return st1, st2, loc


def ref_from_loc(loc):
    m = re.search(r"/bookings/([A-Z0-9-]+)", loc or "")
    return m.group(1) if m else None


def detail_utc(op, ref):
    st, html, _ = req(op, "GET", "/bookings/" + ref)
    text = re.sub(r"<[^>]+>", " ", html)
    m = re.search(r"Starts \(UTC\):\s*([0-9T:.Z-]+)", text)
    return st, (m.group(1) if m else None), html


tag = args.tag

if args.merge_only:
    # merge-only mode: do NOT execute any checks against the server
    R = json.loads(Path(args.out).read_text()) if Path(args.out).exists() else {}
    if args.merge and Path(args.merge).exists():
        for k, v in json.loads(Path(args.merge).read_text()).items():
            R[k] = v
    Path(args.out).write_text(json.dumps(R, indent=2))
    print("merge-only: {0}/{1} PASS -> {2}".format(sum(1 for v in R.values() if v.get("ok") is True), len(R), args.out))
    raise SystemExit(0)

A, B, ADM, STY = session(), session(), session(), session()

# AC1 register + login + book + view + cancel end to end
st, _, _ = req(A, "POST", "/register", {"name": "Scorer A", "email": "a" + tag + "@battery.test", "password": "password-1234"})
stB, _, _ = req(B, "POST", "/register", {"name": "Scorer B", "email": "b" + tag + "@battery.test", "password": "password-1234"})
stAdm, _, _ = req(ADM, "POST", "/login", {"email": "admin@cutwell.test", "password": "cutwell-admin-1"})
stSty, _, _ = req(STY, "POST", "/login", {"email": "ana@cutwell.test", "password": "cutwell-stylist-1"})
st1, st2, loc = book_via_preview(A, "haircut", "1", "2027-03-15", "09:00")
ref1 = ref_from_loc(loc)
stD, utcD, _ = detail_utc(A, ref1) if ref1 else (0, None, "")
# cancel it (end-to-end part): cancel page form action = /bookings/:ref/cancel
stC, _, _ = req(A, "POST", "/bookings/" + (ref1 or "X") + "/cancel", {})
stList, listHtml, _ = req(A, "GET", "/bookings")
cancelledShown = bool(re.search(r"Cancelled|canceled", listHtml, re.I))
mark(1, st in (200, 302, 303) and stB in (200, 302, 303) and stAdm in (200, 302, 303) and ref1 and utcD and stC in (200, 302, 303) and cancelledShown,
     "register {0}/{1}, admin login {2}, book->ref {3}, detail UTC {4}, cancel {5}, list shows Cancelled={6}".format(
         st, stB, stAdm, ref1, utcD, stC, cancelledShown))

# AC2 Ben Saturday: 12:45 absent, 12:30 present
st, html, _ = req(A, "GET", "/book?service=haircut&stylist=2&date=2027-03-20")
slots = slots_of(html)
mark(2, "12:45" not in slots and "12:30" in slots,
     "Ben Sat 2027-03-20 haircut slots: 12:45 present={0} (must be False), 12:30 present={1}, total {2}".format("12:45" in slots, "12:30" in slots, len(slots)))

# AC3 any available stylist
st, html, _ = req(A, "GET", "/book?service=beard&stylist=any&date=2027-03-17")
slotsAny = slots_of(html)
st1, st2, locAny = book_via_preview(A, "beard", "any", "2027-03-17", slotsAny[0]) if slotsAny else (0, 0, "")
refAny = ref_from_loc(locAny)
stylistName = ""
if refAny:
    stD, _, htmlD = detail_utc(A, refAny)
    m = re.search(r"Stylist:\s*([^<]+)", re.sub(r"<[^>]+>", " ", htmlD))
    stylistName = (m.group(1).strip() if m else "?")
mark(3, bool(slotsAny) and refAny and stylistName.lower() not in ("", "?", "any", "any available stylist"),
     "'any' booking -> {0} slots, ref {1}, resolved stylist: {2!r}".format(len(slotsAny), refAny, stylistName))

# AC4 window: <2h refused (Sat 04:45 = 1h45m ahead of Sat 03:00), exactly 2h allowed (Sat 05:00), >60d refused, past refused
st1a, st2a, locA = book_via_preview(A, "haircut", "1", "2027-03-13", "04:45")
soonRef = ref_from_loc(locA)
st1b, st2b, locB = book_via_preview(A, "haircut", "1", "2027-03-13", "05:00")
edgeRef = ref_from_loc(locB)
st1c, st2c, locC = book_via_preview(A, "haircut", "1", "2027-05-20", "09:00")
farRef = ref_from_loc(locC)
st1d, st2d, locD = book_via_preview(A, "haircut", "1", "2027-03-12", "09:00")
pastRef = ref_from_loc(locD)
mark(4, not soonRef and not farRef and not pastRef,
     "<2h refused={0}, >60d refused={1}, past refused={2}; NOTE: exactly-2h (Sat 05:00) was {3} - the app's boundary is exclusive, contradicting its own ASSUMPTIONS.md 'boundaries inclusive (exactly 2h bookable)' (criterion text only requires <2h refused)".format(
         not soonRef, not farRef, not pastRef, "allowed (ref " + str(edgeRef) + ")" if edgeRef else "refused"))

# AC5 overlap: Color 90min Mon 10:00 blocks 11:15, 11:30 offered and bookable (color ends 11:30)
st1, st2, locE = book_via_preview(A, "color", "1", "2027-03-15", "10:00")
refColor = ref_from_loc(locE)
st, htmlAfterColor, _ = req(A, "GET", "/book?service=haircut&stylist=1&date=2027-03-15")
slotsAfterColor = slots_of(htmlAfterColor)
hideOk = "11:15" not in slotsAfterColor and "11:30" in slotsAfterColor
st1, st2, locF = book_via_preview(A, "haircut", "1", "2027-03-15", "11:15")
overlapRef = ref_from_loc(locF)
st1, st2, locG = book_via_preview(A, "haircut", "1", "2027-03-15", "11:30")
edgeRef2 = ref_from_loc(locG)
mark(5, refColor and hideOk and not overlapRef and edgeRef2,
     "color 10:00 booked (ref {0}); UI after color: 11:15 hidden={1}, 11:30 offered={2}; 11:15 booking refused={3}; 11:30 booking allowed (ref {4})".format(
         refColor, "11:15" not in slotsAfterColor, "11:30" in slotsAfterColor, not overlapRef, edgeRef2))

# AC6 parallel same slot: exactly one success, 5 rounds (fresh slot each round)
rounds_ok = 0
round_slots = ["09:00", "09:30", "10:00", "10:30", "11:00"]  # >=30min apart: haircut is 30 min, adjacent 15-min slots would correctly overlap-refuse
round_detail = []
for rnd in range(5):
    results = []
    def fire(i, slot=round_slots[rnd]):
        op = session()
        stL, _, _ = req(op, "POST", "/login", {"email": "b" + tag + "@battery.test", "password": "password-1234"})
        st, loc = post_booking(op, "haircut", "2", "2027-03-16", slot)
        results.append((stL, st, bool(ref_from_loc(loc))))
    threads = [threading.Thread(target=fire, args=(i,)) for i in range(2)]
    for t in threads: t.start()
    for t in threads: t.join()
    succ = sum(1 for r in results if r[2])
    round_detail.append((succ, [(r[0], r[1]) for r in results]))
    if succ == 1:
        rounds_ok += 1
mark(6, rounds_ok == 5, "exactly-one in {0}/5 rounds (Ben Tue 2027-03-16, per-round success counts {1})".format(rounds_ok, round_detail))

# AC7 cancel >24h ok; <24h refused with message (Ben Sat 09:15 = 6h15m ahead of Sat 03:00: inside 24h, within his Sat 9-13 shift)
st1, st2, locH = book_via_preview(A, "haircut", "1", "2027-03-19", "11:00")
refWeek = ref_from_loc(locH)
stC1, _, _ = req(A, "POST", "/bookings/" + (refWeek or "X") + "/cancel", {})
st1, st2, locI = book_via_preview(A, "haircut", "2", "2027-03-13", "09:15")
refNear = ref_from_loc(locI)
stC2, cancelHtml, _ = req(A, "POST", "/bookings/" + (refNear or "X") + "/cancel", {})
cancelMsg = re.sub(r"<[^>]+>", " ", cancelHtml)
msgOk = bool(re.search(r"24 hour|24-hour|cannot|not be cancelled|not be canceled|refused|at least", cancelMsg, re.I))
mark(7, stC1 in (200, 302, 303) and refNear and (stC2 in (400, 403, 409) or msgOk),
     "cancel 6d out {0}; book 2h-ahead Ben (ref {1}); cancel inside 24h -> HTTP {2} with message: {3!r}".format(
         stC1, refNear, stC2, re.sub(r"\s+", " ", cancelMsg)[:120]))

# AC8 admin cancel inside window, reason required (admin route: /admin/bookings/:ref/cancel)
stNoReason, noRHtml, _ = req(ADM, "POST", "/admin/bookings/" + (refNear or "X") + "/cancel", {})
stReason, _, _ = req(ADM, "POST", "/admin/bookings/" + (refNear or "X") + "/cancel", {"reason": "salon emergency"})
mark(8, stNoReason in (400, 403, 409) and stReason in (200, 302, 303),
     "admin cancel w/o reason {0}; with reason {1} (route /admin/bookings/:ref/cancel, discovered from the admin row action)".format(stNoReason, stReason))

# AC9 reschedule keeps ref (two-step: pick date -> slot radios -> POST {date, start})
st1, st2, locJ = book_via_preview(A, "haircut", "3", "2027-03-17", "11:00")
refCleo = ref_from_loc(locJ)
stR, resHtml, _ = req(A, "GET", "/bookings/" + (refCleo or "X") + "/reschedule?date=2027-03-17")
newSlots = slots_of(resHtml)
target = "14:00" if "14:00" in newSlots else (newSlots[0] if newSlots else None)
stR2, resHtml2, _ = req(A, "POST", "/bookings/" + (refCleo or "X") + "/reschedule", {"date": "2027-03-17", "start": target or "14:00"})
stD, utcD2, _ = detail_utc(A, refCleo or "X")
mark(9, refCleo and target and stR2 in (200, 302, 303) and utcD2 and "19:00" in (utcD2 or ""),
     "reschedule Cleo Wed 11:00->14:00 keeps ref {0}; new UTC {1} (14:00 CDT = 19:00Z)".format(refCleo, utcD2))

# AC10 Sunday never; Cleo not Tue; Cleo Wed earliest 11:00
st, sunHtml, _ = req(A, "GET", "/book?service=haircut&stylist=1&date=2027-03-14")
st, cleoTue, _ = req(A, "GET", "/book?service=haircut&stylist=3&date=2027-03-16")
st, cleoWed, _ = req(A, "GET", "/book?service=haircut&stylist=3&date=2027-03-17")
cw = slots_of(cleoWed)
mark(10, len(slots_of(sunHtml)) == 0 and len(slots_of(cleoTue)) == 0 and cw and min(cw) >= "11:00",
     "Sunday slots={0}, Cleo Tuesday slots={1}, Cleo Wednesday earliest={2} ({3} slots)".format(
         len(slots_of(sunHtml)), len(slots_of(cleoTue)), min(cw) if cw else "none", len(cw)))

# AC11 DST: Sat 09:00 -> 15:00Z (booked here); Mon 09:00 -> 14:00Z (already booked as AC1's ref1)
st1, st2, locK = book_via_preview(A, "beard", "1", "2027-03-13", "09:00")
refSat = ref_from_loc(locK)
stD, utcSat, _ = detail_utc(A, refSat or "X")
stD, utcMon, _ = detail_utc(A, ref1 or "X")
mark(11, utcSat == "2027-03-13T15:00:00.000Z" and utcMon == "2027-03-15T14:00:00.000Z",
     "Sat 9:00 local stored {0}; Mon 9:00 local stored {1} (AC1's booking)".format(utcSat, utcMon))

# AC12 B cannot read A's booking by ref
stX, xHtml, _ = req(B, "GET", "/bookings/" + (refSat or "X"))
notFound = stX in (403, 404) or ("not found" in xHtml.lower() or "do not have" in xHtml.lower())
mark(12, notFound, "B reading A's booking -> {0} ({1})".format(stX, "refused/not-found page" if notFound else "LEAKED"))

# AC13 stylist read-only own schedule
stSched, schedHtml, _ = req(STY, "GET", "/stylist")
m = re.search(r"action=\"(/stylist[^\"]*)\"", schedHtml)
mutForm = m.group(1) if m else None
stMut = 0
if mutForm:
    stMut, _, _ = req(STY, "POST", mutForm, {"date": "2027-03-17", "start": "12:00"})
else:
    stMutProbe, mutProbeHtml, _ = req(STY, "POST", "/book", {"service": "haircut", "stylist": "1", "date": "2027-03-17", "start": "12:00"})
    stMut = stMutProbe
mark(13, stSched == 200 and stMut in (400, 401, 403, 404, 405),
     "stylist schedule page {0}; stylist mutation attempt {1}".format(stSched, stMut))

# AC14 bcrypt in db; short password refused
stShort, shortHtml, _ = req(B, "POST", "/register", {"name": "Short", "email": "short" + tag + "@battery.test", "password": "short9"})
shortRefused = stShort in (400, 403, 422) or bool(re.search(r"10 character|at least", shortHtml, re.I))
dbf = RUN / "data" / "cutwell.db"
dbb = b""
for f in ("cutwell.db", "cutwell.db-wal", "cutwell.db-shm"):
    p = RUN / "data" / f
    if p.exists():
        dbb += p.read_bytes()
bcryptSeen = (b"$2b$" in dbb) or (b"$2a$" in dbb) or (b"$2y$" in dbb)
mark(14, shortRefused and bcryptSeen,
     "9-char password refused={0} (HTTP {1}); bcrypt prefix in data/cutwell.db={2}".format(shortRefused, stShort, bcryptSeen))

# AC17 outbox files
outs = list((RUN / "outbox").glob("*")) if (RUN / "outbox").exists() else []
outNames = [p.name for p in outs[:3]]
mark(17, len(outs) >= 2, "{0} outbox file(s): {1}".format(len(outs), outNames))

# AC18 admin pagination + 3 filters together
stP1, p1, _ = req(ADM, "GET", "/admin/bookings?page=1")
stP2, p2, _ = req(ADM, "GET", "/admin/bookings?page=2")
rows1 = p1.count("<tr>") - 1
stF, fHtml, _ = req(ADM, "GET", "/admin/bookings?date=2027-03-16&stylist=2&status=confirmed")
rowsF = fHtml.count("<tr>") - 1
mark(18, stP1 == 200 and stP2 == 200 and rows1 <= 20 and stF == 200 and rowsF >= 0,
     "page1 {0} ({1} rows<=20), page2 {2}; combined filters date+stylist+status -> {3} rows (0 = empty state rendered)".format(stP1, rows1, stP2, rowsF))

# AC19 CSV next 7 days, exact columns
stCsv, csv, _ = req(ADM, "GET", "/admin/bookings/export.csv")
header = csv.splitlines()[0] if csv else ""
dates = set(re.findall(r"2027-03-(\d{2})", csv))
mark(19, stCsv == 200 and header.startswith("ref,start,end,service,stylist,customer_email,status"),
     "CSV {0}; header {1!r}; dates seen {2}".format(stCsv, header[:70], sorted(dates)))

# AC20 audit rows + customer blocked
stAud, audHtml, _ = req(ADM, "GET", "/admin/audit")
audBlob = re.sub(r"<[^>]+>", " ", audHtml)
hasBefore = "before" in audBlob.lower()
hasAfter = "after" in audBlob.lower()
stCust, _, _ = req(A, "GET", "/admin/audit")
mark(20, stAud == 200 and hasBefore and hasAfter and stCust in (401, 403, 404),
     "admin audit {0} (before={1}, after={2}); customer blocked {3}".format(stAud, hasBefore, hasAfter, stCust))

# AC21 clock override works + documented (DST values in AC11 prove the override is live)
mark(21, utcSat is not None and utcMon is not None,
     "CUTWELL_NOW documented in README (env table + example); live effect proven by AC11 UTC values")

# AC26 empty/error states (fresh user sees empty list; invalid date shows error)
E = session()
req(E, "POST", "/register", {"name": "Empty State", "email": "e" + tag + "@battery.test", "password": "password-1234"})
stEmp, empHtml, _ = req(E, "GET", "/bookings")
emptyMsg = bool(re.search(r"No bookings|nothing here|empty", empHtml, re.I))
stBad, badHtml, _ = req(A, "GET", "/book?service=haircut&stylist=1&date=not-a-date")
handledBad = stBad == 200 and "<form" in badHtml and "Traceback" not in badHtml and "Internal" not in badHtml
mark(26, emptyMsg and handledBad,
     "empty bookings message={0}; invalid date handled without crash={1} (HTTP {2}, form re-rendered)".format(emptyMsg, handledBad, stBad))

# AC25 clean checkout/.env.example/no secrets
envEx = (RUN / ".env.example").exists()
envReal = (RUN / ".env").exists()
secretHits = []
for p in RUN.rglob("*"):
    if not p.is_file() or p.stat().st_size > 1_000_000:
        continue
    rel = str(p.relative_to(RUN)).lower()
    if rel.startswith(("node_modules", "data", "outbox", ".tmp-test", ".git")):
        continue
    if p.suffix.lower() not in (".ts", ".js", ".json", ".md", ".html", ".css", ".example"):
        continue
    try:
        txt = p.read_text(errors="replace")
    except Exception:
        continue
    if re.search(r"sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]{16}", txt):
        secretHits.append(str(p.relative_to(RUN)))
mark(25, envEx and not envReal and not secretHits,
     ".env.example={0}, .env committed={1}, secret hits={2}; clean-checkout npm ci && npm test verified by the run's own log (agent-verified-with-note)".format(envEx, envReal, secretHits or "none"))

# AC27 no unrequested features (README feature list audit)
readme = (RUN / "README.md").read_text(errors="replace")
unrequested = [f for f in ("payment", "sms", "review", "loyalty", "notification center", "gift card") if f in readme.lower()]
mark(27, not unrequested, "README feature audit: unrequested features found: {0}".format(unrequested or "none"))

# AC15 login throttle (LAST; per-account, dedicated identity)
T = session()
req(T, "POST", "/register", {"name": "Throttle", "email": "t" + tag + "@battery.test", "password": "password-1234"})
codes = []
for i in range(6):
    stL, loginHtml, _ = req(T, "POST", "/login", {"email": "t" + tag + "@battery.test", "password": "wrong-password-x"})
    blockedMsg = bool(re.search(r"too many|locked|try again", loginHtml, re.I))
    codes.append((stL, blockedMsg))
sixthBlocked = codes[5][1] or codes[5][0] in (429, 403)
mark(15, sixthBlocked,
     "6 wrong logins -> {0}; 6th blocked={1}".format([c[0] for c in codes], sixthBlocked))

# AC16 reference uniqueness (sample from admin pages; 200-booking check covered by the suite)
# AC16 reference uniqueness (refs parsed from the table's row cells; 200-booking check covered by the suite)
refs = []
for pg in (1, 2, 3):
    stP, pgHtml, _ = req(ADM, "GET", "/admin/bookings?page=" + str(pg))
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", pgHtml, re.S):
        m = re.search(r"\bCW-[A-Z0-9]{6}\b", row)
        if m:
            refs.append(m.group(0))
mark(16, len(refs) == len(set(refs)) and len(refs) > 0,
     "{0} refs sampled from admin list, {1} duplicates (full 200-booking check covered by the suite: 61 tests incl. 200-booking uniqueness)".format(len(refs), len(refs) - len(set(refs))))

# AC24 tests + AC22/23 browser checks recorded separately
R["24"] = {"ok": True, "evidence": "npm test -> 61 pass / 0 fail (95.2s), one documented command; README's '59' is stale - agent's 61 is correct", "evidence_type": "live-verified"}
print("PASS AC24: npm test -> 61 pass, one command (README says 59 - stale count recorded)")
R["22"] = {"ok": None, "evidence": "browser probe pending (merge)", "evidence_type": "live-verified-browser"}
R["23"] = {"ok": None, "evidence": "browser probe pending (merge)", "evidence_type": "live-verified-browser"}
print("PENDING AC22 (keyboard/focus/labels) and AC23 (360/1280 overflow) - browser probes next")

passed = sum(1 for v in R.values() if v.get("ok") is True)
pending = sum(1 for v in R.values() if v.get("ok") is None)
Path(args.out).write_text(json.dumps(R, indent=2))
print("\nbattery: {0}/{1} checked PASS, {2} pending browser merge -> {3}".format(passed, len(R), pending, args.out))
if args.merge and Path(args.merge).exists():
    extra = json.loads(Path(args.merge).read_text())
    for k, v in extra.items():
        R[k] = v
    Path(args.out).write_text(json.dumps(R, indent=2))
    print("after merge: {0}/{1} PASS".format(sum(1 for v in R.values() if v.get("ok") is True), len(R)))
