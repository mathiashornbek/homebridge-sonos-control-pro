# Changelog

All notable changes to Sonos Control Pro, newest first.

[npm](https://www.npmjs.com/package/homebridge-sonos-control-pro) ·
[Releases](https://github.com/mathiashornbek/homebridge-sonos-control-pro/releases) ·
[Issues](https://github.com/mathiashornbek/homebridge-sonos-control-pro/issues)

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
