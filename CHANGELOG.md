# Changelog

## 3.1.5

### The screenshots are of a real house now

Every picture in both READMEs came from the test suite: a mock household with fourteen invented rooms called Kitchen, Pantry and Dining Room. It was accurate, it was safe, and it looked exactly like what it was — a fixture.

They are now photographs of the system this plugin was built to run: fourteen real Sonos speakers in three groups, eight scenes, twenty-one favourites read off the household, a backup list with real timestamps, and — the one no fixture could ever produce — the scenes sitting in Apple Home as ordinary switches.

Two of them earn their place beyond looking real. The editor shot shows *Included automatically* listing eleven rooms nobody typed, next to the two that were excluded by hand: that is the "everyone except…" idea in one picture, better than the paragraph explaining it. And the backup list is a genuine one, twenty deep, timestamps and scene counts — the difference between claiming a safety net and showing one.

The gallery the UI smoke test renders has moved to `docs/ui-gallery/` and is no longer committed. It was always a visual check on the interface rather than documentation, and keeping it in `docs/screenshots/` meant sixteen files nothing pointed at.

The confirm-dialog and activity pictures are gone with it; those sections stand on their text until there are real ones to put back.

## 3.1.4

### A README that actually sells the thing

The old one explained the plugin well and undersold it badly. It buried the three things that make this plugin different — that nothing is hard-coded, that templates give you a working system in half a minute, and that every change is backed up automatically — under a wall of prose about UPnP.

The rewrite leads with the feeling everybody recognises (grouping seven rooms by hand, every single time), answers it in one line, and then earns the claim: a side-by-side table against what a typical Sonos plugin offers, a section on how everything in the editor is read live from the household rather than typed in, and proper space for templates and backups. Eight screenshots instead of five — the level editor with its typed percentages, the Import & backup tab, and the confirm-with-undo dialog are all shown now. Danish mirrors it line for line.

Every count and button name in it was then checked against the code rather than remembered — 30 actions, 5 target modes, 4 filters, and the labels in the tables are the labels the UI actually renders, in both languages — which turned up three claims that had quietly drifted:

- **"Levels are set before a note is played" is only true on automatic timing.** Choose fixed timing and the source starts at t=0 while the levels land at their own offset, which is the whole point of fixed timing. Both READMEs now say which mode they mean.
- **"Timeouts are 2.5 s"** ignored `Browse`, `GetZoneGroupState`, `SetAVTransportURI` and `AddURIToQueue`, which are deliberately given longer. Now stated as a default with an exception.
- **"A fixed timeline you draw yourself"** oversold three number fields. The timeline is a preview; the offsets are typed.

The comparison up top is now against doing the same evening by hand in the Sonos app — something anyone can check for themselves — rather than against an unnamed "typical plugin", which was a claim this repository could not back up.

### The Danish README had an English screenshot

The confirm-and-undo dialog was only ever captured in English, so the Danish page showed English chrome under a Danish caption — in the one document whose argument is that the plugin is bilingual all the way down. The gallery step of the UI smoke test now captures the dialog in whichever language it is running, so both get their own.

No functional change. 124 unit tests and 100 browser checks.

## 3.1.3

### The test suite could not run on a machine with cores to spare

`node --test` runs test files in parallel, one per core. Five files, five mock households, all binding the same fixed ports — so on a ten-core machine the suite fell over with `EADDRINUSE` while a two-core container ran them in a queue and never noticed. The same fixed range had also just been introduced to solve the macOS problem in 3.1.1, trading one collision for another.

The mock speakers now listen on a port the operating system hands them, and announce it in their `LOCATION` header the way a real device does. Nothing is fixed, so nothing can collide: the suite runs at whatever parallelism the machine offers. The guard test checks the ports are ephemeral as well as distinct.

124 unit tests and 100 browser checks, verified both serially and at ten-way parallelism.

## 3.1.2

### The level can be typed

Reaching for a volume slider dragged the whole step. The step card is draggable so the list can be reordered, and a range input inside a draggable element hands the gesture to its parent — so a careful nudge from 8 % to 12 % moved the step three places down the list instead.

A step is now dragged only by its grip, and so is a scene. The grip was always there with a tooltip saying what it does; now it is the only thing that starts a drag.

And each speaker's level has a number field next to its slider. A slider is good for finding a level by ear and useless for saying "twelve". Type it, or drag it, whichever suits — they follow each other. Out-of-range numbers are clipped to 0–100 when you leave the field, and clearing it means the same as pressing × : leave this speaker alone.

### A new icon

Sand rather than indigo, with the mark — a switch, with sound coming out of it — over the name of the system it controls. The word is set in a plain grotesque and converted to outlines, so the icon needs no font wherever it is opened, and is deliberately not Sonos's own logotype, which is theirs. The settings header carries the same tile.

### Smaller things

- The mock household hangs up its own keep-alive sockets when a test finishes, rather than leaving the plugin's pooled agent holding ports open into the next test.
- One help text still named two rooms from the house this plugin was first built for. It now says "the living room and the garage", like the English always did.

124 unit tests and 100 browser checks.

## 3.1.1

### The test suite could not run on macOS

Every test failed instantly with `EADDRNOTAVAIL`. The mock household gave each of its speakers a loopback address of its own — 127.0.0.2, 127.0.0.3 and so on — which Linux hands you for free and macOS does not configure at all. The suite had therefore only ever run on Linux; on a Mac it died before the first assertion.

The speakers now all answer on 127.0.0.1, each on its own port, and announce that port in their `LOCATION` header exactly as a real device does. Ports are available everywhere.

That meant teaching the plugin to read the port it is told rather than assuming 1400:

- SSDP responses are parsed for host **and** port.
- `ZoneGroupState` member locations are parsed for host **and** port.
- `playerIps` accepts `192.168.1.40:1400` as well as a bare address.

For a normal household this changes nothing — Sonos always answers on 1400 — but a speaker reached through a port map now works, and the test suite runs anywhere. A new test asserts the mock binds only to 127.0.0.1, so this cannot come back.

124 unit tests and 95 browser checks.

## 3.1.0

The release that turns a private build into a plugin anyone can install.

### Getting started in one click

The old preset was a one-to-one copy of one particular house — a list of room names nobody else has. It is gone, replaced by **four starter scenes that work in any household**: music everywhere, pause everything, turn up, turn down.

They are not a template you are stuck with. The only value a preset genuinely cannot know in advance — which speaker leads the group — is filled in from the speakers actually found on your network at the moment you press the button. Everything else is described by shape ("everyone", "everyone that is playing") rather than by name, so a new speaker is included without editing. Load them, press one, then rebuild them into whatever you actually want.

### Documentation, in English

`README.md` is now English and written for someone deciding whether to install this, with screenshots of the editor, the live speaker view, the favourites list and the activity log. The Danish text lives on in [`README.da.md`](README.da.md), and this changelog keeps its Danish history in [`CHANGELOG.da.md`](CHANGELOG.da.md).

### An icon of its own

A switch with sound coming out of it — the plugin's whole idea in one shape, and readable down to 28 px. Deliberately not a speaker grille: that belongs to Sonos. The same mark now sits in the settings header.

### Installed the ordinary way

`install.sh` and the `sudo sonos-control-update` command are gone. They existed only because the plugin was distributed by hand; from npm, the Homebridge UI updates it with a button. That also removes the last thing in the package that wanted root, which is a requirement for Homebridge verification and a good idea regardless.

### Smaller things

- Every reference to the automation system this plugin was originally built to replace is gone from the code, the settings and the strings. What was "fixed delays — as X did it" is now "fixed delays — I decide when", which is what it always meant.
- `package.json` now carries `repository`, `bugs`, `homepage` and a keyword set npm can actually find, and declares Node 18/20/22/24.
- The settings schema exposes only **Name** and **Language**. The six network keys are still read from `config.json` if present and are documented in the README under *Hidden settings*.
- Volume and URI errors from the speaker layer were the last three strings not going through the dictionary. They are now translated too.

### Test

123 unit tests and 94 browser checks. The whole suite runs against a fictional household in `test/fixtures/household.js` rather than a real one — same shape, invented names — so the tests prove behaviour without carrying anyone's address around. New: the starter preset filling in its group leader, and naming its scenes in the chosen language.

## 3.0.1

### `'}))" />` in the favourites list

Every favourite card had a fragment of code sitting above its title. The cause: the image's `onerror` attribute contained a whole SVG icon, and that icon contains double quotes of its own (`viewBox="0 0 24 24"`). The browser's parser therefore closed the attribute at the first inner quote, and the remainder — `'}))" />` — ended up as visible text. The bug had been there since the favourites tab was built.

The fix is to stop building markup inside an attribute: the note mark is now always drawn and the cover is laid on top of it. If the cover cannot be fetched it removes itself and the mark shows through. No markup, no quotes, nothing to escape from. Four browser checks now watch for it: that no `/>`, `}))`, `onerror` or `<svg` appears as text in the list, that each card has exactly one mark, that the placeholder carries no text, and that an image that fails to load really does disappear.

### The settings page is cleared out

Homebridge's own form now shows only **Name** and **Language**. The entire "Advanced" block is gone, and with it the "Technical settings" card in the backend that did nothing but unfold it.

The six keys (`playerIps`, `discoveryTimeoutMs`, `rediscoverIntervalMs`, `topologyIntervalMs`, `libraryTtlMs`, `controlPort`) are still read from `config.json` if present — they are simply not something you should trip over. The "no speakers found" message now points at the right place instead of a menu that no longer exists.

## 3.0.0

Danish and English — and a pass over the craftsmanship of the interface itself.

### Two languages, one choice

The whole plugin now speaks both Danish and English: the backend, the action list, the conditions, the results, the error messages and every line in the Homebridge log. There is one place to choose — the globe at the top right — and the choice is written to the plugin's own configuration, so the log follows. There is also `Follow the system`, if the machine's locale should decide.

No text is scattered through the code any more. Everything visible is looked up in two dictionaries that a test keeps in step: same keys in both, none empty, none accidentally identical, and the same placeholders on both sides. Forget a translation and the test fails — you do not find out first.

The actions and conditions now describe only *what they do*; what they are **called** comes from the dictionary. That also means a language switch takes effect immediately across the whole editor — including the action list's group headings and every field's help text — without a restart. The switch is passed on to the bridge itself, so step descriptions, results and the log change over at once rather than at next startup. Switch language with a scene open and the whole editing drawer is translated with it — and the scene's name stays put.

Your own names are untouched: scenes, rooms and favourites are called exactly what you called them.

### Dialogs we draw ourselves

The browser's own confirm and prompt boxes are gone. They were drawn by the browser, in the browser's language, in the middle of the screen, with no way to explain what was actually about to happen. Instead:

- **Deleting a scene** asks in a real dialog that says what the consequence is — and afterwards you can **undo straight from the toast**. The whole scene comes back, with the same id, so the switch in Apple Home is the one it was.
- **"Set all to…"** became a slider instead of a text field. You can no longer type `12o` and wonder.
- **Close without saving**, **restore backup** and **replace all scenes** ask the same way, with buttons that say what they do — not "OK".
- Escape closes, Enter confirms, and a click beside it cancels.

### Mistakes that speak up immediately

The editor now tells you *while you are building* what is missing: a music scene with no group leader, a source that was never picked, a list with no speakers. The warning sits at the step it belongs to, and a small mark on the step's header keeps it visible even when the step is folded away. Before, you found out when the scene ran.

### Found in review

An independent review of the whole change found eight things, all fixed: the language switch never reached the bridge; an open editor was only half translated and lost the scene's name; two places still had Danish embedded (`New scene` in the editor's heading and `Error 500` from the proxy); import failures were wrapped inside themselves and said nothing; the unknown-speaker warning had lost which *step* it came from; English counts were always plural ("1 unknown rooms"); and the three-toast cap could remove exactly the toast that was offering an undo. The test that looks for embedded Danish only searched `src/` and only for æ, ø and å — it now covers the interface too, plus a handful of words that cannot be English.

### Under the bonnet

- The action catalogue is now built per request instead of sitting fixed, so a language switch needs no restart.
- The catalogue distinguishes a field's name in *this* action from the generic one, so "Volume" and "Threshold" can be the same field in two places without either being written twice.
- Three layers that still had Danish embedded — SOAP timeouts, topology errors and the new-speaker message — are translated too.
- A test walks the code and fails if anyone writes Danish straight into a file again.

## 2.4.0

Deep hardening. An independent, adversarially-minded review found eight faults in execution — all reproduced, all fixed, all covered by tests.

### Fast presses and cancellation

- **A cancelled scene could beat the one that replaced it.** Cancellation reached the commands aimed at the speakers the scene named, but not those aimed at their group leader — and it is the leader that decides what plays. Press two music scenes in quick succession and the *abandoned* one could end up choosing the music. The cancel signal now travels the whole way.
- **A cancelled step counted as a success.** A scene that was stopped reported green, both in the log and in Activity — and a chained scene could report having run something that never happened.
- **Repeated presses of the same scene** now count as one press for as long as it is running. But only for scenes that decide what plays: two presses on "turn it up" is still twice +5 %. Before, the second press cancelled the first, so the volume changed only once — and the log claimed a speaker had failed on top of that.
- **A chained scene shot its own caller.** When one scene called another, the callee saw the parent as a competitor and cancelled it. Every step after the chaining was dropped, and the scene reported success anyway.
- Runs are now booked per run rather than per scene, so two concurrent runs cannot overwrite each other's bookkeeping and leave one that is never cleaned up.

### Right answers over fast ones

- **The leader's own break-out was never booked.** If the scene's group leader had to leave another group first, the model still believed it was inside the old group afterwards — for up to 30 seconds. The next scene could then skip joins that were genuinely needed, and send commands to the wrong speaker.
- **Shuffle could silently turn repeat off.** The play-mode memo never expired, so a scene that set shuffle wrote the stale repeat value back. The memo now has a lifetime, and every path that changes the state updates it.

### Levels before playback

Levels are now set completely **before** any sound is made. If something was left loud last night, you used to hear it for the fraction of a second the level took to catch up. It costs one round trip and is the entire difference between a scene and a shock. (Choosing "Fixed delays" keeps the original order, because that is what choosing it asks for.)

### The interface

- **The grey box at the top is gone.** Homebridge sizes the frame to its content, so the page never scrolls — the sticky header was therefore inert, and its background was just a grey rectangle painted over the white dialog. The dialog's own background now shows through, and there is air all the way round so the icon and text do not sit against the edge.
- **"Delay before this step" moved down under Advanced.** Commands arrive immediately, so a manual wait is the exception. It is still there if you need it.

### Test

Tests now also run with realistic network latency — several of the faults above were invisible with instant answers. Added: 200 random presses in a row with the group torn apart along the way, checking for hung runs, unhandled errors, and that a final press still leaves the house in a known state; and a check after every scene that the model of the household matches the speakers.

## 2.3.0

The eighteen seconds were not a collision between two scenes. The figure — 18014 ms — is three times the old 6000 ms SOAP timeout: three calls in a row where a speaker did not answer. The group had to be built from scratch, so all eleven joins were genuinely sent, and a single silent speaker along the way cost six seconds per call.

- **Shorter wait, one retry.** A Sonos speaker on the local network answers in fractions of a millisecond. Waiting six seconds for an answer gains nothing — it is not coming. The wait is now 2.5 seconds, and an unanswered call is tried once more on a short leash. A briefly lost answer is therefore recovered rather than failing, and a speaker that is switched off costs less than before.
- **Only what can be sent twice, is sent twice.** Reads and absolute commands (set volume to 20, join group, stand alone) are safe to repeat. Relative changes and "add playlist to queue" are not — they would change the volume twice or queue the playlist twice. Those are never retried. A real answer from the speaker, even a refusal, is an answer and is not retried either.
- **The calls that genuinely take time got a longer leash:** fetching a playlist from a music service, browsing the library, and reading the group topology.
- **One fewer network call in the critical path.** If the group leader has to be freed from another group first, the change is booked internally instead of re-reading the whole topology.
- **Joins are sent in batches of six.** Every grouping change makes Sonos broadcast a new topology to the whole household; eleven at once means the speakers spend their time talking to each other. Same total time, calmer network.
- **A step taking over three seconds is now named in the log** along with what it was doing. Next time something is slow, the log explains itself.

Building the whole group from scratch — exactly the situation from the log — is now a permanent test.

## 2.2.0

From a real-world log. The most important finding was two lines:

```
2:13:35  ▶ "Background music"
2:13:38  ▶ "Play City Radio"
2:13:41  ✔ "Background music" finished in 6213 ms
2:13:57  ✔ "Play City Radio" finished in 18014 ms
```

- **Two music scenes ran on top of each other.** Both sent contradictory commands to the same speakers, Sonos serialised them, and scenes that normally take under a second took 6 and 18 seconds. Now a new music scene cancels the previous one: pressing another scene means "no, this one instead", and the newest wins. Volume, pause and next/previous do not count — they are welcome to run while music is being set up.
- **Grouping that is already in place is skipped.** On a repeat press the house is usually already grouped exactly as the scene wants, and those 13 commands were pure no-ops — while also being the slowest thing the scene sent. Grouping is booked internally at once, so the decision is never made from a stale picture, and a speaker you pulled out from the Sonos app is still brought back in.
- **Play mode now costs one call instead of two.** Shuffle and repeat share a single field in Sonos, which used to require a read first. That value is now remembered.
- A join scene reports "everyone was already in the group" and sends nothing when they were.

### The interface

- Search fields now fill the width instead of sitting as a stub.
- Favourites without cover art get a note mark rather than an empty grey square.
- Activity got a proper empty state instead of one line of loose text.
- A two-line scene summary is no longer clipped through the letters.
- At most three messages are shown at a time, so they do not cover what you are looking at.
- The preset description is trimmed to one line.

## 2.1.0

Optimisations from real measurements. Volume and pause were already at 27–50 ms; it was startup and the playlist scene that could be improved.

- **The queue is reused.** The most expensive thing a scene does is push a streaming playlist onto the queue — Sonos fetches it from the service, and that is what made the playlist scene take 1–2 seconds against the radio scene's half. Press the scene again while the same playlist is still queued and the fetch is skipped entirely, sending only a Play. The queue's `UpdateID` is compared, so if you changed the music in the Sonos app in the meantime the playlist is of course fetched again.
- **Levels are set while the source loads** instead of afterwards. The two are independent, and grouping still happens after, so each speaker keeps its own level.
- **Startup is faster.** Speaker discovery used to wait out the whole search window — 4 seconds, every time. One answer is now enough, because one speaker can describe the whole household. That applies to the "Search for speakers again" button too, which now answers immediately.

## 2.0.0

Renamed to **Sonos Control Pro**. The package is now `homebridge-sonos-control-pro`, and the platform alias `SonosControlPro`.

- **Name collision avoided.** `homebridge-sonos-control` already exists on npm as a different plugin, and their latest version happened to be 1.4.0 too — which is why the Homebridge UI showed a tick next to "up to date". Had they published a new version, the UI would have offered an update that quietly replaced this plugin with an entirely different one. That can no longer happen.
- **Everything comes along.** Scenes and backups are migrated automatically from the old state directories. The old platform aliases are still registered, so an unchanged `config.json` keeps loading. The switches' identity in Apple Home is bound to a fixed namespace rather than to the package name, so a rename does not by itself reset them.
- **The old name is cleaned up.** The installer removes a leftover `homebridge-sonos-control` and clears its stale accessories from Homebridge's cache, so no dead switches are left behind in Apple Home.

### The interface

- **The descriptions are alive.** The text under each scene name is generated from the scene's actual steps rather than being stored text — change a scene and the line changes with it.
- The summary is short and wraps onto two lines instead of stretching the card sideways. Long lists are shown as a count rather than as truncated text.
- The layout was made responsive: at narrow widths the buttons drop onto their own line instead of being pushed out of sight, and the page can no longer be scrolled horizontally.
- Your own description is not gone — it is now shown as a tooltip when you hover the row.
- **The status pill on the speaker cards wrapped inside its own oval.** It is now kept on one line, and the type sizes on the cards are tightened so a long room name sits properly.
- **The top aligns.** The logo, the first tab and the search field did not share a left edge, and the sticky header sat as a detached grey block over the white dialog. The background is now continuous and everything lines up on the same edge.

## 1.5.0

- **Grouped speakers showed "Silent" even while playing.** Transport state was only read on the group leader; a speaker following a group has its own transport paused by Sonos and therefore reported nothing. State is now read once per group and applies to every member — a whole house in one group costs one network call instead of fourteen, and the answer matches what you actually hear in the room.
- "Silent" is now **"Not playing"**.
- **The Sonos view refreshes itself** every 5 seconds while the tab is open, and immediately when you switch to it. Only the speakers are fetched, so the rest of the page stays still. Nothing is fetched while the browser tab is hidden.
- The cards now show **what is playing** — title and artist from the group.
- The play/pause button targets the group and updates at once instead of after a full reload.

## 1.4.0

Installation and updating now reach the machine Homebridge actually runs on.

- **The right plugin directory.** An `hb-service` installation does not use the global npm directory — it puts plugins in `/var/lib/homebridge/node_modules` with its own Node in `/opt/homebridge`. A global install ends up somewhere Homebridge never looks, and everything appears correct right up until nothing happens. The installer now works out the layout itself.
- **The right permissions.** Installation runs as the user that owns Homebridge's files, so nothing ends up root-owned and unreadable to the service afterwards.
- The updater reports what it found: layout, plugin directory, storage directory, config path, npm, hb-service and which user the service runs as.
- The release archive lives in the storage directory rather than in root's home, so it is covered by Homebridge's own backup.

## 1.3.0

A pass over the whole plugin with an independent code review. Eleven real faults fixed, plus speed and new features.

### Fixes

- **Stereo pairs and Boost:** a room name could resolve to the invisible satellite in a stereo pair (both halves carry the same name). A satellite is never a group leader, so *every* grouping in that scene failed — and the step reported success anyway. Name lookup now only reaches real, addressable rooms.
- **Empty volume:** a step with an unfilled volume set every chosen speaker to 0 % and reported success. The step is now refused with a clear message, and nothing changes.
- **Cancellation:** restart a scene while it is running and the previous one's network calls are now cancelled immediately. Before, old commands could land on top of the new ones and leave speakers in the wrong group.
- **Join group** now points at the real group leader if the chosen room is itself following another. Before, every join failed.
- **Sonos playlists** are now sent without fabricated metadata, and a URL gets the right content class. Before, a saved queue could be refused by the speaker.
- **Fixed delays** are now measured from the start of the scene as promised, instead of stacking on top of however long the preceding steps happened to take.
- **SSDP** now sets the egress interface, so multiple networks are genuinely searched — not just the default route.
- **A lost connection** mid-answer is reported at once and with the right cause, instead of waiting out the whole timeout and blaming the wrong thing.
- The library cache now works in a house with no favourites; before, favourites, playlists and radio were fetched afresh every time.
- The "everyone playing right now" target now refreshes grouping first, so it asks the right group leaders.

### Faster

- **Automatic timing.** Music scenes no longer wait out fixed delays: each step starts when the previous one confirms it is done. A whole-house scene goes from a good three seconds to under one. Fixed delays remain available per scene.
- **Reused connections** to the speakers instead of a new TCP handshake per command.
- **The group topology** is fetched once and shared by every step in a scene instead of once per step. If a speaker does not answer, the rest are asked simultaneously rather than one at a time — worst case falls from about 84 seconds to a single timeout.

### New

- **New speakers look after themselves.** The network is swept automatically (every 5 minutes by default), so a speaker you set up this afternoon is simply there. Music scenes using "everyone except…" include it without editing.
- **A new-speaker panel** on the Sonos tab: speakers with no level in your music scenes are highlighted, and one click gives them a level in all of them.
- A scene pressed right after a restart now waits for the speakers to be found, instead of failing with "the speaker does not exist".

## 1.2.0

- A built-in update script for hand-distributed builds, with version archiving, `--list`, `--rollback` and `--no-restart`. (Removed in 3.1.0, when the plugin moved to npm.)

## 1.1.0

- Renamed to **Sonos Control**, with automatic migration of scenes and backups from the previous state directory and the old platform alias still registered.
- Transport commands (play, pause, stop, next, previous, toggle) are now sent only to group leaders. A group of 13 speakers costs one network call instead of 13, and the false "transition not available" errors from followers are gone.
- Playing a favourite, playlist, radio station or URL on a speaker that is part of a group now targets the group leader, so the whole group plays it — instead of tearing the group apart.
- Music scenes break the group leader out of a foreign group first if it is following another speaker. Otherwise the source would be refused or start in the wrong group.

## 1.0.0

First release.

- Scenes as switches in Apple Home, with a choice of press or on/off switch per scene.
- Local Sonos control over UPnP: SSDP discovery, group topology, playback, volume, grouping, play modes, and browsing of favourites, playlists and radio stations.
- A visual backend with a scene list (drag to reorder), a scene editor with a timeline, a live Sonos view, a favourites picker, testing of whole scenes and single steps, an activity log, import/export and backups.
- A combined "music scene" action: group leader, source, leave-list, per-speaker level and two shared delays in one step.
- The "only those playing right now" target filter, so a volume change does not touch silent speakers.
- Scenes stored separately from `config.json` with atomic writes, automatic backups and quarantine of unreadable files.
