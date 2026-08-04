<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/icon.png" width="128" alt="Sonos Control Pro" />
</p>

<h1 align="center">Sonos Control Pro</h1>

<p align="center">
  <b>🎵 Your whole house, playing, from one switch in Apple Home.</b><br />
  Build the scene in a beautiful visual editor. Press it on your phone, your watch, or just ask Siri.
</p>

<p align="center">
  <a href="https://github.com/homebridge/homebridge/wiki/Verified-Plugins"><img src="https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat" alt="Verified by Homebridge" /></a>
  <a href="https://www.npmjs.com/package/homebridge-sonos-control-pro"><img src="https://img.shields.io/npm/v/homebridge-sonos-control-pro?color=4f46e5&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/homebridge-sonos-control-pro"><img src="https://img.shields.io/npm/dt/homebridge-sonos-control-pro?color=4f46e5" alt="downloads" /></a>
  <a href="https://github.com/mathiashornbek/homebridge-sonos-control-pro/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-4f46e5" alt="MIT licence" /></a>
  <img src="https://img.shields.io/badge/Homebridge-1.8%20%7C%202.x-4f46e5" alt="Homebridge 1.8 and 2.x" />
  <img src="https://img.shields.io/badge/Node-22%20%7C%2024%20%7C%2026-4f46e5" alt="Node 22, 24 and 26" />
  <img src="https://img.shields.io/badge/tests-190%20%2B%20114-4f46e5" alt="190 unit tests, 114 browser checks" />
  <a href="https://www.paypal.com/paypalme/MathiasHornbek"><img src="https://img.shields.io/badge/PayPal-buy%20me%20a%20coffee-00457C?logo=paypal&logoColor=white&style=flat" alt="Support the plugin on PayPal" /></a>
</p>

---

## 😩 You know this feeling

You want music in the whole house **except** the living room. At the levels *you* like. With the kitchen leading.

So you open the Sonos app. Group seven rooms by hand. Set seven volumes. Find the playlist. Every. Single. Time. 🙄

## ✨ Now it is one switch

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/scenes.png" width="760" alt="The scene list" />
</p>

Every scene you build becomes an ordinary switch in Apple Home. Press it and the group forms, every level lands and the music starts — **a fourteen-room house is up and playing in about a second**. ⚡

> 🗣️ *"Hey Siri, party mode."*
> 🏠 Put it on your Home screen. ⏰ Fire it from an automation at 07:00. 🎛️ Bind it to a button.

It is just a switch. So **everything HomeKit can do to a switch, it can now do to your music.** 👇

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/apple-home.png" width="700" alt="The scenes as switches in Apple Home" />
</p>

---

## 🏆 Built to be the most flexible Sonos control you can put in HomeKit

Here is the same evening, done both ways.

| | 📱 The Sonos app, by hand | ⚡ **Sonos Control Pro** |
| --- | :---: | :---: |
| Group eleven rooms | eleven taps | **one** |
| Set eleven different volumes | eleven drags | **one** |
| Find the playlist | search it | **one** |
| Do it again tomorrow | all over again | **one** |
| From your watch | ❌ | ✅ |
| From Siri | ❌ | ✅ |
| From a HomeKit automation at 07:00 | ❌ | ✅ |
| Skip the living room automatically | ❌ | ✅ |
| Turn up *only* the rooms that are playing | ❌ | ✅ |
| Include a speaker you buy next month, untouched | ❌ | ✅ |
| Roll the whole setup back to yesterday | ❌ | ✅ |

And under the bonnet: a visual editor with no JSON, no YAML and no UUIDs · conditions, branches, delays and timelines · ready-made templates · one-click backup and restore · English and Danish everywhere · **zero runtime Sonos dependencies**.

**30 actions. 5 target modes. 4 live filters. Unlimited scenes.** Combine them however you like — the plugin never assumes what your house looks like.

---

## 🔄 Everything is live. Nothing is hard-coded.

This is the part people fall in love with. 💘

There is **not one UUID, IP address or room name** for you to type. The whole editor is populated from your speakers, in real time:

- 🔊 **Your speakers** appear as clickable names — read live from the household, right now
- 🎧 **Your favourites, playlists and radio stations** come straight off the Sonos system — pick one from a list instead of hunting for a URI
- 📊 **Real volumes, real playback state, real groups** — refreshed continuously, not guessed
- ➕ **Buy a new speaker this afternoon** and your "everywhere except…" scenes include it *automatically*. No editing. The Sonos tab highlights it so you can give it a level in one click.
- ✏️ **Rename a room in the Sonos app** and every affected scene is flagged in red, by name, so nothing silently stops working

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/speakers.png" alt="Live speaker view" /></td>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/favourites.png" alt="Favourites read from Sonos" /></td>
</tr>
<tr>
<td>🎚️ <b>Your household, live.</b> Every speaker with its real volume, what it is playing and which group it is in. Drag a slider here and the speaker moves in the room.</td>
<td>💿 <b>Your library, straight from Sonos.</b> Favourites, playlists and radio stations pulled from your own system — with artwork. Click to use.</td>
</tr>
</table>

---

## 🎨 One step builds a whole scene

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/editor.png" width="760" alt="The scene editor" />
</p>

The action you will use most is **Start music in a group** — a single step that does everything a music scene needs:

| | |
| --- | --- |
| 👑 **Group leader** | The speaker that drives playback. Everyone else follows it. |
| 🎵 **What should play** | A Sonos favourite, a playlist, a radio station, a URL — or keep whatever is already on. |
| ➕ **Who joins** | *Everyone except…* (self-maintaining) or an explicit list. |
| ➖ **Who leaves** | The rooms that should do something else. Or nothing at all. |
| 🔉 **Level per speaker** | On the default *Automatic* timing, set **before** a note is played — so a speaker left at 60 % last night cannot startle you. |
| 🔀 **Shuffle / repeat / crossfade** | Leave on *Unchanged* to not touch them. |
| ⏱️ **Timing** | *Automatic* (fastest — each phase starts the moment the last confirms) or fixed offsets you set yourself, previewed as a timeline. |

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/editor-group.png" width="700" alt="Choosing the source, who leaves the group and who is included automatically" />
</p>

Look at **Included automatically**: you never listed those rooms. You said *"everyone except the living room and the garage"*, and the scene works the rest out — today, and again the day you add a speaker. 🪄

### 🎚️ Type it or drag it — your choice

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/editor-levels.png" width="700" alt="Per-speaker levels with typed percentages" />
</p>

Every speaker gets its own level, with a slider **and** a number field — because a slider is great for finding a level by ear and useless for saying "twelve". 🎯 One click on **Use current levels** captures whatever already sounds right in the house. One `×` means *leave this speaker alone*.

### 🛟 And it is hard to break

Every destructive action asks first — and then **still** gives you an Undo. ↩️ Scenes are validated as you build: a music scene with no leader tells you so, at the step, before you save. Nothing is written to `config.json`, so a bad edit can never take your bridge down. 🛡️

---

## 🎁 Templates: a working system in about thirty seconds

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/backup.png" width="760" alt="Templates, export/import and backups" />
</p>

Don't start from an empty page. Press **Load the four starter scenes** and you instantly get four working switches — **Music everywhere**, **Pause everything**, **Turn up**, **Turn down** — already wired to *your* speakers, because the template hydrates itself from your live household. 🪄

Under **Import & backup → Getting started** you choose **Load and replace everything** or **Add alongside my scenes**. They are ordinary scenes afterwards: edit them into whatever you actually want. And any scene can be **duplicated** with one click, so "same again, but the upstairs" is a ten-second job. 📋

## 💾 Backups: a safety net you never have to think about

- 🔁 **Automatic.** A timestamped version is saved *every single time* you change anything. The newest 20 are kept.
- ⏮️ **One-click restore.** Pick a point in time from the list and roll the whole system back.
- 📤 **Export everything as JSON** — download it, or copy it to the clipboard.
- 📥 **Import** on a new bridge, or share a setup with a friend. Rooms that don't exist are named for you rather than failing silently.
- 🧯 **Corruption-proof.** Writes are atomic; a damaged file is quarantined, never fatal.

Moving house, rebuilding your bridge or just experimenting — your scenes are always one click from safe. 😌

---

## 📈 See exactly what happened

Open the **Activity** tab and there is every run, step by step, with **how long each one took** and **exactly what each speaker answered**. ⏱️ When something misbehaves you can see why, in seconds — instead of guessing at a log file. A step over three seconds is also called out by name in the Homebridge log.

---

## ⚡ Install in two minutes

In the Homebridge UI, search for **Sonos Control Pro** under Plugins and press Install. Or:

```bash
npm install -g homebridge-sonos-control-pro
```

Then add the platform. The settings page has exactly **two fields**, because everything else belongs in the editor: 😌

```json
{
  "platforms": [
    {
      "platform": "SonosControlPro",
      "name": "Sonos Control Pro",
      "language": "en"
    }
  ]
}
```

Restart Homebridge → open **Plugins → Sonos Control Pro → Settings** → press **Load the four starter scenes**. Done. 🎉

> 💡 **Tip:** run it as a [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges). Scene switches appear and disappear as you edit, and a child bridge keeps that churn away from your main bridge.

---

## 🧰 The full toolbox

### 🎬 Actions

| Category | Actions |
| --- | --- |
| 🎵 **Music scene** | Start music in a group *(the big one — leader, source, joins, leaves, levels, play modes, timing)* |
| ▶️ **Playback** | Play Sonos favourite · Play Sonos playlist · Play radio station · Play URL / stream · Play · Pause · Stop · Play / pause (toggle) · Next track · Previous track · Switch to line-in · Switch to TV audio |
| 🔊 **Volume** | Set volume · Turn up / down · Set group volume · Turn the group up / down · Mute / unmute · Toggle mute |
| 🔗 **Grouping** | Join group · Leave group |
| ⚙️ **Sound settings** | Shuffle · Repeat · Crossfade · Loudness · Bass and treble |
| 🧩 **Sequence** | Wait · Remember the current state · Restore a saved state · Run another scene |

### 🎯 Targets — where the real sharpness lives

| Target | Means |
| --- | --- |
| 🌍 **All speakers** | Everything the household has, *right now* |
| ✅ **Chosen speakers** | Exactly the rooms you pick |
| 🚫 **All except** | Everything minus the rooms you pick — **new speakers included automatically** |
| 🔗 **The group around** | Whoever is currently grouped with a given room |
| 👑 **The leader of** | The one speaker that owns that group's transport |

…then a live filter: **whatever they are doing** · **only those playing right now** · **only the silent ones** · **only group leaders**.

That second one is the whole trick behind a safe volume scene. 🤫 **"+5 %, only those playing"** turns up the kitchen without ever waking the bedroom.

### 🎚️ Switch types

- **Press** ▶️ — runs and turns itself back off, like a button. *"Start the music", "pause everything", "turn it up".*
- **On/off** 🔛 — stays on until you switch it off, and switching it off runs a **second list of actions**. *"Evening music" that pauses the house when you turn it off.*

Any scene can also carry a **condition** 🤔 — *is anything playing? is it between 22:00 and 06:00? is the kitchen above 30 %?* — with a whole second branch for when it isn't met.

---

## 🔒 Genuinely local. Genuinely private.

- 🏠 Commands go **straight to your speakers** over UPnP on your own network
- ☁️ **No cloud round-trip. No account. No hub. No web API polling.**
- 📴 **Internet down? Your scenes still work.**
- 📡 **Zero telemetry, zero analytics** — no outbound connection of any kind other than to your own speakers
- 📦 **Zero runtime Sonos dependencies** — the entire protocol layer is hand-written and tested against a full mock household

---

## 🇬🇧 🇩🇰 Bilingual, all the way down

The whole backend, every action, every help text, every line in the Homebridge log — in **English and Danish**. One picker, in the header, switching live. 🌍

---

<details>
<summary><b>🔧 Under the bonnet — how it talks to Sonos</b></summary>

Straight UPnP/SOAP over HTTP to port 1400 on each speaker: `AVTransport`, `RenderingControl`, `GroupRenderingControl`, `ContentDirectory`, `ZoneGroupTopology`, `DeviceProperties`. Discovery is SSDP with an early exit — one answer describes the whole household — plus a manual IP list for networks that block multicast.

Connections are pooled and kept alive. Timeouts default to 2.5 s — longer for the handful of calls that are genuinely slow, like browsing the library — with a single short retry, and only for calls that are safe to send twice: reads and absolute sets. A relative volume change or an "add to queue" is never retried, because doing it twice would be wrong.

The topology is cached and refreshed on a schedule, with grouping changes booked immediately rather than re-read — both faster and more correct, since a read moments after a change is answered from the cache anyway.
</details>

<details>
<summary><b>⏱️ Under the bonnet — how a scene runs</b></summary>

Every step starts at once and waits out its own delay, measured from the start of the scene. A step with a 2 s delay fires 2 s after the press — not 2 s after the previous step finished. A scene can opt into strict sequential execution instead.

Inside a music scene the phases are ordered so nothing surprises you: **levels first**, then anything that makes a sound, then grouping, then play modes. On *automatic* timing each phase starts the moment the last one confirms; on *fixed* timing each phase starts at its own offset from the scene's start.

Grouping calls that are already satisfied are skipped. Commands are batched so the speakers do not spend their time gossiping about topology instead of answering.

Pressing the same scene again while it is running counts as one press, not two — but only for scenes that decide what plays. Two taps on "turn it up" genuinely means twice. Pressing a *different* music scene cancels the first, all the way down to the commands aimed at its group leader.
</details>

<details>
<summary><b>📁 Under the bonnet — where your data lives</b></summary>

Scenes live in `sonos-control-pro/scenes.json` next to your Homebridge config — never in `config.json`, so a bad edit can never take the bridge down. Writes are atomic and every save leaves a timestamped backup behind; the newest 20 are kept and can be restored from the settings. A corrupt file is quarantined rather than fatal.
</details>

<details>
<summary><b>🎛️ Hidden settings</b></summary>

The settings page shows two fields on purpose. These are still read from `config.json` if you put them there, and all have sensible defaults:

| Key | Default | Does |
| --- | --- | --- |
| `playerIps` | — | Fixed IP addresses, for networks that block multicast. Comma separated; one is enough. Also settable on the **Sonos** tab, which is easier. |
| `discoveryTimeoutMs` | `4000` | How long to listen for speakers at startup. |
| `rediscoverIntervalMs` | `300000` | How often to look for new speakers. |
| `topologyIntervalMs` | `30000` | How often grouping is re-read. |
| `libraryTtlMs` | `300000` | How long the favourites list is cached. |
| `controlPort` | `0` | Port for the loopback control API. `0` picks a free one. Listens on 127.0.0.1 only. |
</details>

---

## 🩺 Troubleshooting

**🔍 No speakers found.** Some networks block multicast between VLANs, or have AP isolation on. Open the **Sonos** tab — the address box opens by itself when nothing is found — and give it one speaker's IP address. The rest of the household is discovered through it, and it takes effect straight away.

**🏷️ A scene names a room that no longer exists.** Renaming a room in the Sonos app renames it everywhere. The scene list marks affected scenes in red and names the missing room; open the scene and pick the new name.

**🤫 A step says "none of the speakers were playing".** That is the *only those playing* filter doing its job. It is not an error.

**🐌 Something took longer than expected.** Open the **Activity** tab. Every step is there with its duration and the speaker's own answer.

---

## 🤝 Contributing

Issues and pull requests are very welcome. The test suite is the contract:

```bash
npm test        # 190 unit and integration tests against a full mock Sonos household
npm run test:ui # 114 checks driving the real settings UI in Chromium
```

Both run in CI on **Node 22, 24 and 26** — the two versions Homebridge supports, plus Current, so a change in Node surfaces here before it surfaces in somebody's house.

The mock household in `test/mock-sonos.js` speaks real SOAP over real HTTP on loopback, with configurable latency, real queue update IDs and speakers that can appear mid-run — so the tests exercise the actual protocol, not a stub of it. 🧪 It never touches the network the suite is run from: the discovery sweep is stubbed everywhere, so `npm test` in a house with real Sonos speakers neither finds them nor talks to them.

---

## 📄 Licence

MIT © Mathias Hornbek

Not affiliated with, endorsed by or sponsored by Sonos, Inc. "Sonos" is a trademark of Sonos, Inc., used here only to describe what this plugin controls.

<p align="center">
  <b>⭐ If this made your house better, a star on GitHub means a lot.</b><br />
  <b>☕ And if you want to buy me a coffee: <a href="https://www.paypal.com/paypalme/MathiasHornbek">PayPal</a> · <a href="https://github.com/sponsors/mathiashornbek">GitHub Sponsors</a></b><br />
  <b><a href="README.da.md">🇩🇰 Dansk dokumentation →</a></b>
</p>
