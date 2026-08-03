# Changelog

All notable changes to Sonos Control Pro, newest first.

[npm](https://www.npmjs.com/package/homebridge-sonos-control-pro) ·
[Releases](https://github.com/mathiashornbek/homebridge-sonos-control-pro/releases) ·
[Issues](https://github.com/mathiashornbek/homebridge-sonos-control-pro/issues)

---

## 3.4.1

- The icon in the settings page was missing the SONOS text under the mark. It
  is the whole icon now, and a test compares it with `docs/icon.svg` so the two
  cannot drift apart again.

---

## 3.4.0

The last three layers nobody had read. The two earlier reviews covered the
Sonos protocol and the settings interface; this one took the persistence, the
Homebridge integration, the control API and the 2,000-line scene engine, and
turned up forty-five defects. Every one was reproduced against the real code
before anything was changed, and every fix here has a test that was confirmed
to fail without it. The suite goes from 148 to 190.

### Your scenes

- **A file that could not be *opened* was treated exactly like a file that
  could not be *parsed*.** One `sudo` leaving scenes.json owned by root, a full
  descriptor table on a busy box, a NAS mount that had not come back — any of
  them replaced every scene with an empty list. Homebridge was then told to
  remove every switch, which takes each one's room assignment and every
  automation pointing at it, and the next save wrote that empty list over a
  file that was never damaged. An unreadable file now leaves the scenes alone,
  blocks writing, and says so.
- **A save wrote whatever the store happened to hold when the queue reached
  it,** not what it held when the save was asked for. If a reload landed in
  that window the edit was silently dropped — and the settings page said
  "Saved".
- **Every save wrote a backup, and the retention was a flat count.** An
  afternoon of dragging scenes around filled all twenty slots with
  byte-identical copies taken seconds apart, and the week-old state anyone
  would actually want back was gone. Backups are now written only when
  something changed, and the last ten are kept alongside the newest from each
  day.
- **A backup that could not be written was swallowed in silence.** The Backups
  tab kept showing a list; the protection could have stopped months earlier.
- **A broken file was copied to a fresh quarantine file on every failing
  load** — and every handler in the settings backend loads. Clicking around a
  broken installation wrote copy after identical copy, and nothing ever
  deleted them.
- **Restoring a backup left the settings behind,** producing a state that was
  neither the backup nor what you had.
- **An import with a single null entry returned a 500 and imported nothing** —
  while the same file in "replace" mode worked.
- **A scene added after a delete took an order another scene already held,**
  landing in the middle of the list instead of at the end; a duplicate did not
  sit next to its original.
- Names, descriptions and step lists are now bounded, so one imported file
  cannot make scenes.json several megabytes — copied again on every save.

### Apple Home

- **Accessories were registered under the plugin's preferred platform name
  rather than the one the user actually configured.** For anyone still on one
  of the two older names, Homebridge could not match its cached accessories
  back on the next restart: every switch reported orphaned, removed, and
  recreated — losing its room and its automations — once per restart, forever.
- **A stateful switch that was on came back off after a restart** while the
  music was still playing, and the next press ran the "on" branch again instead
  of turning it off. The position now survives in the accessory's context.
- **A stateful scene that failed left its switch showing on.** The runner
  reports a failed scene by resolving, not by rejecting, so the handler written
  for exactly this never fired.
- **A rename never reached Homebridge's accessory cache,** so the old name came
  back at the next restart — in the log, in the Homebridge UI, and for Siri.
- **Two scenes sharing an id were given a new one on every single load,** so
  Apple Home deleted and recreated that switch on every restart. The new id is
  written back once.
- Accessory bookkeeping is committed only after the HAP call succeeds, and
  adopting a speaker validates every level before it changes anything.

### The scene engine

- **A cancelled `restore` carried on regardless.** Forty commands over 1.2
  seconds *after* the cancel — pulling every room out of the group the new
  scene was building, then setting last night's volumes on top. You heard the
  party form and fall apart, and the activity feed said it went well.
- **A leader that could not load the source left the house ungrouped, silent
  and turned down to listening volume.** The source is now resolved before
  anything is touched: failing having changed nothing beats failing halfway.
- **`restore` did not book its grouping changes,** so a scene starting within
  the next second decided from a model that still described the old groups —
  and skipped exactly the joins it needed.
- **A snapshot cancelled halfway stored a full set of blanks over a good one.**
- **Two scenes that both left the snapshot slot blank shared one drawer** and
  restored each other's rooms. Naming a slot still shares it deliberately.
- **The scene's condition was evaluated before discovery had finished.** Right
  after a restart every "is nothing playing?" came back true — so the scenes
  written specifically not to interrupt music were the ones that interrupted
  it. And a speaker that could not be reached counted as a speaker that was
  quiet; it now counts as unknown, and the scene takes its else-branch.
- **A step whose speakers had all gone was recorded as a success** — the usual
  cause being a room renamed in the Sonos app. So was a step that *every*
  speaker refused, which also meant "stop the scene if this fails" did not.
- **A blank wait waited no time at all and reported success.** In a doorbell
  scene that means the restore fires while the announcement is still loading.
- **The one-minute ceiling did not count the scene's own waits.** There is no
  fade action, so a gentle wake-up is written as `wait 90` between two volume
  steps — and it was cut off every time, leaving the bedroom at a whisper. The
  budget now covers what the scene asked to wait for.
- **An unrecognised target type meant "everybody".** `"player"` instead of
  `"players"` in a shared scene sent a volume meant for one room to all
  fourteen. At three in the morning that is the whole house waking up.
- **A one-speaker action left on "all speakers" played in whichever room sorted
  first** — and would move to a different room the day someone added a speaker
  called Attic.
- **Fixed timing was measured on the wall clock.** An NTP correction just after
  boot stretched every phase by the size of the step, or collapsed all three
  into one instant — which is precisely the shock-volume moment fixed timing
  exists to prevent. It now uses a clock that cannot be stepped.
- Mute and play/pause toggles no longer overlap and cancel each other out, and
  two scenes chaining to the same third scene share one run of it rather than
  shooting each other's.

### The control API

- **A missing `scenes` key meant "delete everything".** A client saving only
  its settings, or one that misspelled the key, wiped every scene and
  unregistered every switch — and got a 200 in reply. Both destructive routes
  now require the list.
- **`runtime.json` was only tightened to 0600 when it was created.** A file
  that came back 0644 from a backup or a copy without `-p` stayed 0644 for
  every start after that, with a live token in it. The test that was supposed
  to cover this created the file fresh each time, which is the one case that
  already worked.
- **A failed start left a stale `runtime.json` behind,** so the settings page
  would hand our token to whatever had taken that port.
- A body that is valid JSON but is not a request no longer creates a blank
  scene, a malformed body is a 400 rather than a 500, and a client that opens a
  request and never finishes it is timed out instead of parked for five
  minutes.

190 tests and 114 browser checks, on Node 22, 24 and 26, serially and eight
runs at a time.

---

## 3.3.0

The rest of the review. 3.2.0 fixed the six worst findings; this closes the
remaining eighteen. Every one is now covered by a test, and the suite has grown
from 131 to 148 because the review's real conclusion was not the list of bugs —
it was that the tests only ever exercised the happy path against a mock that
always answers correctly.

### Discovery

- **Anything that answered the search was treated as a speaker.** The comment
  claimed only ZonePlayer answers were accepted; the filter did not exist.
  Routers, NAS boxes and televisions reply to any M-SEARCH, and with the early
  exit a router answering in 20 ms ended discovery before a single real speaker
  had replied: **zero speakers found**, four seconds spent, and a warning that
  blamed addresses which were not involved. Sonos is now identified by its USN,
  its search target or its server header.
- **The search asked for replies over three seconds and hung up after four
  tenths of one.** Spreading replies over that window is what `MX` is *for*, so
  every speaker that obeyed it answered into a closed socket — and the second
  burst, which exists because UDP is lossy, went out at the same moment the
  socket closed. The window asked for now matches the time actually spent
  listening, and the second burst goes out well inside it.
- **An IPv6 address was read as `[fd00`,** and an uppercase `HTTP://` was
  rejected outright. Each cost a full discovery timeout per speaker.

### A household that answers slowly, or wrongly

- **A failed topology read was never recorded as an attempt,** so the freshness
  guard suppressed nothing and every call paid the whole fan-out again. With
  nothing on the network answering, the speaker view took 25 seconds — and then
  took 25 seconds again.
- **Volume and mute were read one after the other** inside an object literal
  that looks parallel and is not, so an unreachable speaker cost two timeouts
  where one would do.
- **A rediscovered speaker kept its old port** while the topology refresh
  updated it, so the two paths disagreed about where the same speaker lived.

### Playback

- **A favourite with no metadata was sent back with the class Sonos files it
  under.** `object.itemobject.item.sonos-favorite` says what an item is *listed
  as*, not what it *is*, and a player refuses it. It is now dropped so the class
  is derived from the URI.
- **A music-service item was handed the token for local content.** Asking a
  speaker to find a Spotify album on itself does not work; the service is named
  in the URI and is now read from it.
- **`playItem` never asked `classify()`,** which exists for exactly the
  question it was guessing at. Pasting a container URI sent the command that
  plays a stream, and the player answered 714 or nothing at all.
- **A volume of `" "` muted every chosen speaker and reported success.**
  `Number(' ')` is 0. This is the case the function's own comment calls the
  worst possible answer.

### The XML parser

- **A wall of unclosed tags took 13.5 seconds of blocked event loop.** The
  closing-tag scan walked the whole stack for every close: fine on well-formed
  XML, quadratic on anything else — and anything else is precisely what a device
  that is not a Sonos speaker returns on port 1400. Now **60 ms**.
- **Searching a deep document overflowed the call stack.** `parseXml` will
  happily build one tens of thousands of elements deep; `find` and `findAll`
  recursed into it. Both are iterative now, in the same document order.

### The settings page

- **The five-second refresh fought whoever was using it.** It replaced the
  whole speaker grid, so a volume slider held mid-drag lost the node under the
  pointer and the drag died. It now waits for the hand to leave.
- **The level for adopting new speakers reset to 12 every five seconds** — and
  the button read the page, so speakers were adopted at 12 rather than at the
  level that had been set.
- **A slow answer overwrote a newer one.** Four things trigger that refresh, so
  two were routinely in flight; the loser won by finishing last.
- **Four handlers changed the page before saving and never changed it back.**
  A failed write left the switch in its new position, the page disagreeing with
  the disk, and an uncaught error in the console.
- **Activity and Backups rendered as blank white space** when the bridge was
  down, which reads as "there is nothing here" rather than "I cannot see". One
  malformed history entry blanked the whole tab, taking the good entries with
  it.
- **The undo offered after deleting was withdrawn on the fourth delete.** Three
  toasts is the cap, and when all three carried an undo the oldest was dropped
  anyway.
- **A step's level control showed a number the scene had not stored** — the
  slider read 10, the saved step held nothing, and the card then said so.
- **An unset amount rendered as `NaN %`.**
- **Trying a new scene created it permanently** while the editor still claimed
  unsaved changes and closed without asking. It says what it did now.
- **Toggling a room off and back on left the editor permanently "unsaved"**,
  because the comparison is on JSON and the list had reordered.
- **Album art was escaped but not checked.** Escaping makes a value safe to sit
  in an attribute and says nothing about what it means; `javascript:` passes
  through it untouched.
- **A double-click on a button that opens a dialog cancelled it instantly** —
  the second press landed on the backdrop that had just appeared.
- **The frame was measured before the panel had loaded,** leaving a long
  activity list clipped until the tab was switched twice.
- **The address panel forced itself open on every refresh,** so it could not be
  closed while no speakers were found.
- **Saving addresses failed silently, and did not save at all** when the
  platform block was missing from `config.json` — the addresses were used and
  then vanished at the next restart. Saving now happens first and works with
  the bridge down, which is the situation the field exists for.

### Also

- The settings header drew a second, older version of the icon's mark: a
  rounder switch, the knob in a different place, two sound waves where the icon
  has three. Beside the icon it read as a different logo. It reuses the icon's
  own geometry now, and a test compares the two.
- A path containing a space or a control character reached `http.request` and
  threw a raw `TypeError` from inside a promise. It is refused with a 400.

### The suite guessed at timing

One test pressed a second scene five milliseconds after the first and assumed
the first would still be running. With the mock answering instantly that is a
guess about how fast the machine is — and on a ten-core Mac running five test
files at once, the guess was wrong: the first scene had already finished, and
the test failed for a reason that had nothing to do with the plugin.

It now waits for the first run to actually register, with latency that makes the
overlap certain rather than likely. Four other tests slept a fixed interval and
then asserted that nothing was still running; they wait for that to be true
instead. Verified on both machines, serially and at ten-way parallelism.

### Node 26

`engines` declares it, CI builds against it, and the whole suite — 148 tests and
114 browser checks — was run on it. 22 and 24 because Homebridge supports them;
26 because it is Current and will be the next LTS, so a change in Node should
break the build here rather than in somebody's house.

148 unit tests and 114 browser checks, on Node 22, 24 and 26, serially and at
ten-way parallelism. Each new test was confirmed to fail against the old code
before its fix went in.

---

## 3.2.0

Two adversarial reviews — one of the Sonos protocol layer, one of the settings
interface — found twenty-four defects. None of them failed a test. These are
the six that mattered most; the rest are written down and will follow.

### Fixed

- **One bad reply could delete the whole household.** The group topology is
  built from a *single* speaker's answer, and any speaker missing from it was
  deleted at once. A speaker that has just rebooted reports a household
  containing only itself, and so does one on the far side of a VLAN — so
  fourteen rooms became one, every scene failed with "room not found", and the
  players that could have given a second opinion had been deleted too, leaving
  nothing to recover from. A speaker now has to be absent from **two
  consecutive** replies before it is forgotten.
- **An imported scene file could run code in the settings page.** Scene and
  step ids, and numeric step parameters, were written into HTML attributes
  unescaped. Import and export are a headline feature, so a shared scene file
  is a realistic route. Ids are now validated on the way in and replaced if
  they are not plain identifiers; numeric parameters are coerced to numbers or
  dropped; and the attributes are escaped as well. Names, descriptions, room
  names and favourite titles were already escaped correctly.
- **A scene whose id contained a quote became permanently inert** — the
  attribute truncated, the lookup missed, and Edit, Run, Delete and the switch
  all silently did nothing, with no way to remove it. Same fix.
- **Dragging a scene while the search box had text destroyed the order.** The
  new order was read off the screen, which after filtering is not the whole
  list, and posted as though it were: the hidden scenes fell out entirely and
  the dragged one jumped to the top of the household. The visible order is now
  merged back into the full list, and everything hidden stays where it was.
- **A failing bridge was presented as a healthy, empty one.** Only a bridge
  that was completely absent counted as offline; one answering 504 because it
  was busy sailed through, and the page then said "No scenes yet" while the
  bridge held every real scene — one tab away from "replace everything".
- **A parse failure took Homebridge down with it.** The SOAP and HTTP response
  handlers ran unguarded inside an EventEmitter callback, so anything thrown
  there was an uncaught exception rather than a failed command. Whatever a
  speaker — or a device that merely answers on port 1400 — sends back, the most
  it can now cost is that one call.
- **A search matching nothing rendered a blank panel.** It now says so.

### Changed

- Per-speaker levels are clamped to 0–100 and rounded when they are read, not
  only when they are typed.
- The queue and play-mode memos are dropped when a speaker is forgotten.

135 unit tests and 110 browser checks. The four new tests were each confirmed
to fail against the old code before the fix went in.

---

## 3.1.8

### Added

- **Manual speaker addresses, from the settings page.** If your network blocks multicast between VLANs, the speakers never answer the ordinary search — and the fix, `playerIps`, could only be set by hand-editing `config.json`, because a custom settings UI replaces Homebridge's own form. There is now a field for it on the Sonos tab. It opens by itself when nothing is found, applies immediately rather than at the next restart, and says so when the addresses still do not answer. One address is enough; the rest of the household is discovered through it.

### Fixed

- **`config.schema.json` was not valid JSON Schema.** The `name` property carried `"required": true`, which is not a thing — `required` is an array at the object level naming the properties that are required. Homebridge rendered the form either way, so nothing looked wrong.
- **`keywords` did not declare a transport.** Added `supports-hap`: this plugin exposes switches through HAP and does nothing over Matter.

Both are now asserted by tests, since neither is visible by looking at the settings page.

131 unit tests and 106 browser checks.

---

## 3.1.7

### Fixed

- The test suite ran a real SSDP sweep, so on a network with Sonos speakers on it they answered and joined the fixture. The sweep is now injectable, and every `SonosSystem` the suite builds hands in one that finds nothing. A test reads the test files and fails if a construction forgets.
- `resolveLanguage(undefined, {})` falls through to `Intl`, so its answer depends on the machine's locale. The test demanded English and failed on a Danish machine, where Danish is the correct answer. It now asserts that no setting behaves like `auto`, and checks fixed answers with an explicit environment.

127 unit tests and 100 browser checks, on Node 22 and Node 24.

---

## 3.1.6

### Fixed

- **Discovery crashed when nothing answered.** The empty-handed branch tested a variable that had never existed, so instead of the message explaining what to do you got `Sonos discovery failed: hosts is not defined`, and the settings page got the same `ReferenceError` as a 500. Two tests cover it now.
- **Addresses in `playerIps` that nobody answered on were silent.** The warning now names them.
- **The control API server had no `'error'` listener once it was up.** An error on it would have taken Homebridge down with it.
- **The shutdown handler called six teardown functions unguarded**, so a throw during shutdown crashed the bridge on its way out.
- **`httpGet` and the settings-page proxy** had no `'error'` or `'aborted'` handling, so a speaker rebooting mid-reply burned the whole timeout instead of failing immediately.
- Three Danish strings were still embedded in `soap.js`. The test that looks for hard-coded Danish missed them because none contained æ, ø or å; its word list is longer now.

### Changed

- **The default language is no longer Danish.** No setting now means the same as *Follow the system*: your language where it exists, English otherwise. Setting `da` or `en` still means exactly that.
- The licence badge said *package not found*; it is a plain badge now.
- One changelog, in English. `CHANGELOG.da.md` is gone.
- CI runs the suite on Node 22 and Node 24.

---

## 3.1.5

### Changed

- The README screenshots are of a real fourteen-speaker household rather than the test fixture, including the scenes as switches in Apple Home.
- The gallery the UI smoke test renders moved to `docs/ui-gallery/` and is no longer committed — it is a visual check on the interface, not documentation.

---

## 3.1.4

### Changed

- **README rewritten.** It led with the mechanics and buried what the plugin is actually for. It now leads with the problem, and gives templates, backups and the live-everything behaviour room of their own.
- Every count and button name in it was checked against the code. Three claims had drifted: levels-before-sound is only true on automatic timing; 2.5 s is the default timeout, not the rule for every call; and the fixed "timeline" is a preview of typed offsets.
- The UI smoke test captures the confirm dialog in both languages, so the Danish README no longer borrows the English one.

---

## 3.1.3

### Fixed

- `node --test` runs test files in parallel, one per core, and five mock households all bound the same fixed ports — so the suite failed with `EADDRINUSE` on any machine with cores to spare. The mock speakers now listen on a port the OS hands them and announce it in their `LOCATION` header, the way a real device does.

---

## 3.1.2

### Fixed

- **Reaching for a volume slider dragged the whole step.** A range input inside a draggable element hands the gesture to its parent, so a nudge from 8 % to 12 % moved the step three places down the list. Steps and scenes are now dragged only by their grip.
- The mock household hangs up its own keep-alive sockets on teardown rather than holding ports into the next test.
- One help text still named two specific rooms; it says "the living room and the garage" now, as the English always did.

### Added

- **A number field beside each speaker's slider.** A slider is good for finding a level by ear and useless for saying "twelve". Out-of-range values clip to 0–100 on blur; clearing the field means *leave this speaker alone*.
- A new icon: the switch-and-soundwaves mark in Sonos sand, with the name set as outlines so it needs no font. The settings header carries the same tile.

---

## 3.1.1

### Fixed

- **The test suite could not run on macOS.** The mock household gave each speaker its own loopback address — 127.0.0.2, 127.0.0.3 and so on — which Linux provides for free and macOS does not configure at all. Speakers now share 127.0.0.1 and differ by port.

### Changed

- The plugin reads the port it is told rather than assuming 1400: SSDP responses and `ZoneGroupState` member locations are both parsed for it, and `playerIps` accepts `192.168.1.40:1400`. A normal household is unaffected; a speaker behind a port map now works.

---

## 3.1.0

### Changed

- **The starter preset works in any household.** It was a copy of one particular house — a list of room names nobody else has. It is now four scenes described by shape: music everywhere, pause everything, turn up, turn down. The one value a preset cannot know in advance, the group leader, is filled in from the speakers found on your network when you press the button.
- **README in English**, written for someone deciding whether to install this, with the Danish text in `README.da.md`.
- **`install.sh` and `sudo sonos-control-update` are gone.** They existed only because the plugin was distributed by hand; from npm the Homebridge UI updates it with a button. That also removes the last thing in the package that wanted root.
- `package.json` carries `repository`, `bugs`, `homepage` and a proper keyword set, and declares Node 18/20/22/24.
- The settings schema exposes only **Name** and **Language**. The six network keys are still read from `config.json` and documented in the README under *Hidden settings*.
- The whole suite runs against a fictional household in `test/fixtures/household.js` rather than a real one — same shape, invented names.

---

## 3.0.1

### Fixed

- **`'}))" />` appeared above every favourite's title.** The image's `onerror` attribute contained an SVG icon, and that icon contains double quotes of its own (`viewBox="0 0 24 24"`), so the parser closed the attribute at the first inner quote and the remainder became visible text. The note mark is now always drawn and the cover laid on top of it; if the cover fails to load it removes itself. Four browser checks watch for it.

### Changed

- Homebridge's own form shows only **Name** and **Language**. The "Advanced" block is gone, and the "no speakers found" message points somewhere that exists.

---

## 3.0.0

### Added

- **Danish and English throughout** — the backend, the action list, the conditions, the results, the error messages and every line in the Homebridge log. One picker, in the header, and the choice is written to the plugin's configuration so the log follows. `Follow the system` is available if the machine's locale should decide.
- No visible text lives in the code any more. Everything is looked up in two dictionaries a test keeps in step: same keys in both, none empty, none accidentally identical, same placeholders on both sides.
- Actions and conditions describe only what they do; what they are *called* comes from the dictionary. A language switch therefore takes effect across the whole editor without a restart, including with a scene open — and the scene's name stays put.
- **Dialogs drawn by the plugin rather than the browser.** Deleting a scene explains the consequence and can be undone from the toast, with the same id, so the switch in Apple Home is the one it was. "Set all to…" is a slider, so `12o` is no longer typeable. Escape closes, Enter confirms.
- **Validation while you build.** A music scene with no group leader, a source never picked, a list with no speakers — the warning sits at the step it belongs to, with a mark on the header that survives folding it away.

### Fixed

- The language switch never reached the bridge, so step descriptions and the log stayed in the old language.
- An open editor was only half translated and lost the scene's name.
- `New scene` in the editor's heading and `Error 500` from the proxy were still hard-coded Danish.
- Import failures were wrapped inside themselves and said nothing useful.
- The unknown-speaker warning had lost which *step* it came from.
- English counts were always plural ("1 unknown rooms").
- The three-toast cap could remove the toast offering an undo.

---

## 2.4.0

### Fixed

- **A cancelled scene could beat the one that replaced it.** Cancellation reached the commands aimed at the speakers a scene named, but not those aimed at their group leader — and the leader decides what plays. The signal now travels the whole way.
- **A cancelled step reported success**, in the log and in Activity, so a chained scene could claim to have run something that never happened.
- **Repeated presses of the same scene** now count as one press while it is running — but only for scenes that decide what plays. Two presses on "turn it up" is still twice +5 %.
- **A chained scene cancelled its own caller.** Every step after the chaining was dropped, and the scene reported success anyway.
- **The leader's own break-out was never booked**, so for up to 30 seconds the model believed it was still in the old group and the next scene could skip joins that were needed.
- **Shuffle could silently turn repeat off.** The play-mode memo never expired, so a scene setting shuffle wrote the stale repeat value back. It has a lifetime now.
- Runs are booked per run rather than per scene, so two concurrent runs cannot overwrite each other's bookkeeping.
- The sticky header's grey background was painted over the white dialog; Homebridge sizes the frame to its content, so the header was inert anyway.

### Changed

- **Levels are set completely before any sound is made.** If something was left loud last night you used to hear it for the fraction of a second the level took to catch up. It costs one round trip. (Fixed delays keep the original order, because that is what choosing them asks for.)
- "Delay before this step" moved under Advanced. Commands arrive immediately, so a manual wait is the exception.
- Tests run with realistic network latency — several of the faults above were invisible with instant answers. Added: 200 random presses with the group torn apart along the way, and a check after every scene that the model matches the speakers.

---

## 2.3.0

An 18-second scene in the log turned out to be three consecutive 6-second SOAP timeouts, not two scenes colliding.

### Changed

- **Timeout down to 2.5 s, with one retry.** A speaker on the local network answers in fractions of a millisecond; waiting six seconds gains nothing.
- **Only idempotent calls are retried.** Reads and absolute commands are safe to repeat; relative volume changes and "add to queue" are not, and are never retried. A refusal from the speaker is an answer, and is not retried either.
- Genuinely slow calls get a longer leash: fetching a playlist from a service, browsing the library, reading the topology.
- If the group leader must be freed from another group first, the change is booked internally instead of re-reading the whole topology.
- **Joins go out in batches of six.** Every grouping change makes Sonos broadcast a new topology to the household; eleven at once means the speakers spend their time talking to each other.
- A step over three seconds is named in the log, with what it was doing.

---

## 2.2.0

### Fixed

- **Two music scenes could run on top of each other**, sending contradictory commands to the same speakers. Sonos serialised them and scenes that normally take under a second took 6 and 18. A new music scene now cancels the previous one; volume, pause and next/previous do not count.
- **Grouping already in place is skipped.** On a repeat press those commands were pure no-ops, and the slowest thing the scene sent. Grouping is booked internally at once, and a speaker pulled out from the Sonos app is still brought back in.
- **Play mode costs one call instead of two.** Shuffle and repeat share a single field in Sonos, which used to require a read first.

### Changed

- Search fields fill the width. Favourites without cover art get a note mark rather than an empty square. Activity has a proper empty state. Two-line scene summaries are no longer clipped. At most three messages are shown at once.

---

## 2.1.0

### Changed

- **The queue is reused.** Pushing a streaming playlist onto the queue is the most expensive thing a scene does. Press the scene again while the same playlist is queued and only a Play is sent. The queue's `UpdateID` is compared, so music changed in the Sonos app is fetched again.
- **Levels are set while the source loads** rather than afterwards. Grouping still happens after, so each speaker keeps its own level.
- **Startup is faster.** Discovery used to wait out the full 4-second search window; one answer is enough, because one speaker describes the whole household.

---

## 2.0.0

Renamed to **Sonos Control Pro**: package `homebridge-sonos-control-pro`, platform alias `SonosControlPro`.

### Fixed

- **A name collision.** `homebridge-sonos-control` exists on npm as a different plugin, and their latest version was also 1.4.0 — so the Homebridge UI showed "up to date". Had they published, the UI would have offered an update that quietly replaced this plugin with an unrelated one.
- The status pill on the speaker cards wrapped inside its own oval.
- The logo, first tab and search field did not share a left edge, and the sticky header sat as a detached grey block over the white dialog.

### Changed

- Scenes and backups migrate automatically from the old state directories, the old platform aliases stay registered, and accessory identity is bound to a fixed namespace rather than the package name, so the rename does not reset the switches in Apple Home.
- **Scene descriptions are generated from the steps** rather than stored, so changing a scene changes its line. Your own description is shown as a tooltip.
- The layout is responsive: at narrow widths the buttons drop onto their own line instead of being pushed out of sight.

---

## 1.5.0

### Fixed

- **Grouped speakers showed "Silent" while playing.** Transport state was read only on the group leader, and a follower has its own transport paused by Sonos. State is now read once per group and applied to every member — a whole house in one group costs one network call instead of fourteen.

### Changed

- "Silent" is now "Not playing".
- The Sonos view refreshes every 5 seconds while the tab is open, and immediately when you switch to it. Only the speakers are fetched, and nothing while the browser tab is hidden.
- Cards show what is playing, and the play/pause button targets the group and updates at once.

---

## 1.4.0

### Fixed

- **Installation reached the wrong directory.** An `hb-service` install does not use the global npm directory — plugins go in `/var/lib/homebridge/node_modules` with its own Node in `/opt/homebridge`. A global install ends up somewhere Homebridge never looks, and everything appears correct right up until nothing happens.
- Installation runs as the user that owns Homebridge's files, so nothing ends up root-owned and unreadable to the service.
- The release archive lives in the storage directory rather than root's home, so Homebridge's own backup covers it.

---

## 1.3.0

### Fixed

- **Stereo pairs and Boost.** A room name could resolve to the invisible satellite in a stereo pair, since both halves carry the same name. A satellite is never a group leader, so every grouping in that scene failed — and the step reported success anyway.
- **An empty volume field set every chosen speaker to 0 %** and reported success. The step is now refused with a clear message.
- **Restarting a scene left the old one's network calls in flight**, so stale commands could land on top of the new ones.
- **Join group** now points at the real group leader if the chosen room is itself following another. Before, every join failed.
- **Sonos playlists** are sent without fabricated metadata, and a URL gets the right content class.
- **Fixed delays** are measured from the start of the scene as promised, rather than stacking on top of however long the preceding steps took.
- **SSDP** sets the egress interface, so multiple networks are genuinely searched.
- A lost connection mid-answer is reported at once and with the right cause, instead of waiting out the timeout and blaming something else.
- The library cache works in a house with no favourites.
- The "everyone playing right now" target refreshes grouping first, so it asks the right group leaders.

### Changed

- **Automatic timing.** Music scenes no longer wait out fixed delays: each step starts when the previous one confirms. A whole-house scene goes from a good three seconds to under one.
- Connections to the speakers are reused instead of a new TCP handshake per command.
- The topology is fetched once and shared by every step. If a speaker does not answer, the rest are asked simultaneously — worst case falls from about 84 seconds to a single timeout.

### Added

- **New speakers look after themselves.** The network is swept every 5 minutes by default, and music scenes using "everyone except…" include a new speaker without editing.
- A new-speaker panel on the Sonos tab: speakers with no level in your music scenes are highlighted, and one click gives them a level in all of them.
- A scene pressed right after a restart waits for the speakers to be found rather than failing.

---

## 1.2.0

- A built-in update script for hand-distributed builds, with version archiving, `--list`, `--rollback` and `--no-restart`. (Removed in 3.1.0, when the plugin moved to npm.)

---

## 1.1.0

- Renamed to **Sonos Control**, with automatic migration of scenes and backups and the old platform alias still registered.
- Transport commands are sent only to group leaders. A group of 13 speakers costs one network call instead of 13, and the false "transition not available" errors from followers are gone.
- Playing a favourite, playlist, radio station or URL on a grouped speaker targets the group leader, so the whole group plays it instead of the group being torn apart.
- Music scenes break the group leader out of a foreign group first. Otherwise the source is refused or starts in the wrong group.

---

## 1.0.0

First release.

- Scenes as switches in Apple Home, press or on/off per scene.
- Local Sonos control over UPnP: SSDP discovery, group topology, playback, volume, grouping, play modes, and browsing of favourites, playlists and radio stations.
- A visual backend: scene list with drag to reorder, editor with a timeline, live Sonos view, favourites picker, testing of whole scenes and single steps, activity log, import/export and backups.
- A combined music-scene action: group leader, source, leave-list, per-speaker level and two shared delays in one step.
- The "only those playing right now" target filter, so a volume change does not touch silent speakers.
- Scenes stored separately from `config.json`, with atomic writes, automatic backups and quarantine of unreadable files.
