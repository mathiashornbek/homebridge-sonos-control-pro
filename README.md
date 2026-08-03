<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/icon.png" width="128" alt="Sonos Control Pro" />
</p>

<h1 align="center">Sonos Control Pro</h1>

<p align="center">
  <b>Your whole house, playing, from one switch in Apple Home.</b><br />
  Build the scene in a visual editor. Press it on your phone, your watch, or say it to Siri.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-sonos-control-pro"><img src="https://img.shields.io/npm/v/homebridge-sonos-control-pro?color=4f46e5&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/homebridge-sonos-control-pro"><img src="https://img.shields.io/npm/dt/homebridge-sonos-control-pro?color=4f46e5" alt="downloads" /></a>
  <a href="https://github.com/mathiashornbek/homebridge-sonos-control-pro/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/homebridge-sonos-control-pro?color=4f46e5" alt="MIT licence" /></a>
  <img src="https://img.shields.io/badge/Homebridge-1.8%20%7C%202.x-4f46e5" alt="Homebridge 1.8 and 2.x" />
  <img src="https://img.shields.io/badge/tests-124%20%2B%2095-4f46e5" alt="124 unit tests, 95 browser checks" />
</p>

---

You know the feeling. You want music in the whole house *except* the living room, at the levels you like, with the kitchen leading — and getting it means opening the Sonos app, grouping seven rooms by hand and setting seven volumes. Every single time.

**Sonos Control Pro turns that into one switch.**

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-scenes.png" width="720" alt="The scene list" />
</p>

Every scene becomes an ordinary switch in Apple Home. Press it, and the group forms, the levels land and the music starts — typically in **well under a second for a fourteen-room house**. Ask Siri. Put it on your Home screen. Trigger it from a HomeKit automation at 07:00. It is just a switch, so everything HomeKit can do to a switch, it can now do to your music.

---

## Why this one

**It is genuinely local.** Commands go straight to the speakers over UPnP on your own network. No cloud round-trip, no account, no hub, no polling a web API. If your internet is down, your scenes still work. There are **zero runtime Sonos dependencies** — the whole protocol layer is hand-written and tested against a full mock household.

**Nothing is hard-coded.** Speakers are picked as clickable names read live from your system. You will never hunt for a UUID in a log file.

**It is fast on purpose.** Levels are set *before* a note is played, so a speaker left at 60 % last night cannot startle you. Grouping calls that are already satisfied are skipped. Commands are batched so the speakers do not spend their time gossiping about topology instead of answering.

**Volume changes are surgical.** "Turn it up" only touches speakers that are *actually playing*. Silent rooms are left alone — no more waking the bedroom because you nudged the kitchen.

**New speakers look after themselves.** Set up a Sonos One this afternoon and your "everywhere except…" scenes include it automatically. The Sonos tab highlights it so you can give it a level in one click.

**Danish and English.** The whole backend, every action, every line in the Homebridge log. One picker, in the header.

---

## What it looks like

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-editor.png" alt="The scene editor" /></td>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-sonos.png" alt="Live speaker view" /></td>
</tr>
<tr>
<td><b>One step does the whole scene.</b> Pick the leader, what plays, who joins, who stays out and the level for each — with a timeline showing exactly when each phase fires.</td>
<td><b>Your household, live.</b> Every speaker with its real volume, what it is playing and which group it is in. Drag a slider and the speaker moves.</td>
</tr>
<tr>
<td><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-library.png" alt="Favourites" /></td>
<td><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-activity.png" alt="Activity log" /></td>
</tr>
<tr>
<td><b>Your favourites, straight from Sonos.</b> Playlists, radio stations and favourites are read from your speakers — pick one from a list instead of typing a URI.</td>
<td><b>Every run, step by step.</b> How long it took and exactly what each speaker answered. When something misbehaves, you can see why.</td>
</tr>
</table>

---

## Install

In the Homebridge UI, search for **Sonos Control Pro** under Plugins and press Install. Or:

```bash
npm install -g homebridge-sonos-control-pro
```

Then add the platform. The settings page has only two fields, because everything else belongs in the editor:

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

Restart Homebridge, open **Plugins → Sonos Control Pro → Settings** and press **Load the four starter scenes**. You will have music everywhere, pause, and volume up and down working immediately — then edit them into whatever you actually want.

> **Tip:** run it as a [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges). Scene switches appear and disappear as you edit, and a child bridge keeps that churn away from your main bridge.

---

## Building a scene

A scene is a name, a switch type and a list of actions. That is all.

The one you will use most is **Start music in a group** — a single step that does everything a music scene needs:

| | |
| --- | --- |
| **Group leader** | The speaker that drives playback. Everyone else follows it. |
| **What should play** | A Sonos favourite, a playlist, a radio station, a URL — or keep whatever is playing. |
| **Who is in the group** | *Everyone except…* (self-maintaining) or an explicit list. |
| **Speakers that leave** | The rooms that should do something else. Or nothing. |
| **Level per speaker** | Set before a note is played. Sliders, or "use current levels" to capture what already sounds right. |
| **Shuffle / repeat / crossfade** | Leave on *Unchanged* to not touch them. |

Everything is validated as you build it: a music scene with no leader says so, at the step, before you save.

### The rest of the actions

| Category | Actions |
| --- | --- |
| **Playback** | Play favourite · Play playlist · Play radio · Play URL/stream · Play · Pause · Stop · Toggle · Next · Previous · Line-in · TV audio |
| **Volume** | Set volume · Turn up/down · Set group volume · Turn group up/down · Mute · Toggle mute |
| **Grouping** | Join group · Leave group |
| **Settings** | Shuffle · Repeat · Crossfade · Loudness · Bass and treble |
| **Sequence** | Wait · Remember state · Restore state · Run another scene |

### Which speakers

Every action takes a target, and the target is where the sharpness lives:

| Target | Means |
| --- | --- |
| All speakers | Everything the household has, right now |
| Chosen speakers | Exactly the rooms you pick |
| All except | Everything minus the rooms you pick — new speakers included automatically |
| The group around | Whoever is currently grouped with a given room |
| The leader of | The one speaker that owns that group's transport |

…and then a filter: **whatever they are doing** · **only those playing right now** · **only the silent ones** · **only group leaders**.

That second one is what makes a volume scene safe. "+5 %, only those playing" is the entire trick.

### Switch types

- **Press** — runs and turns itself back off, like a button. Use it for "start the music", "pause everything", "turn it up".
- **On/off** — stays on until you switch it off, and switching it off runs a second list of actions. Use it for "evening music" that pauses the house when you turn it off.

Optionally a scene can have a **condition** — is anything playing? is it between 22:00 and 06:00? is the kitchen above 30 %? — with a second branch for when it is not met.

---

## Under the bonnet

<details>
<summary><b>How it talks to Sonos</b></summary>

Straight UPnP/SOAP over HTTP to port 1400 on each speaker: `AVTransport`, `RenderingControl`, `GroupRenderingControl`, `ContentDirectory`, `ZoneGroupTopology`, `DeviceProperties`. Discovery is SSDP with an early exit — one answer describes the whole household — plus a manual IP list for networks that block multicast.

Connections are pooled and kept alive. Timeouts are 2.5 s with a single short retry, and only for calls that are safe to send twice: reads and absolute sets. A relative volume change or an "add to queue" is never retried, because doing it twice would be wrong.

The topology is cached and refreshed on a schedule, with grouping changes booked immediately rather than re-read — both faster and more correct, since a read moments after a change is answered from the cache anyway.
</details>

<details>
<summary><b>How a scene runs</b></summary>

Every step starts at once and waits out its own delay, measured from the start of the scene. A step with a 2 s delay fires 2 s after the press — not 2 s after the previous step finished. A scene can opt into strict sequential execution instead.

Inside a music scene the phases are ordered so nothing surprises you: levels first, then anything that makes a sound, then grouping, then play modes. On *automatic* timing each phase starts the moment the last one confirms; on *fixed* timing each phase starts at its own offset from the scene's start.

Pressing the same scene again while it is running counts as one press, not two — but only for scenes that decide what plays. Two taps on "turn it up" genuinely means twice. Pressing a *different* music scene cancels the first, all the way down to the commands aimed at its group leader.
</details>

<details>
<summary><b>Where your data lives</b></summary>

Scenes live in `sonos-control-pro/scenes.json` next to your Homebridge config — never in `config.json`, so a bad edit can never take the bridge down. Writes are atomic and every save leaves a timestamped backup behind; the newest 20 are kept and can be restored from the settings. A corrupt file is quarantined rather than fatal.

Nothing leaves your network. No telemetry, no analytics, and no outbound connection of any kind other than to your own speakers.
</details>

<details>
<summary><b>Hidden settings</b></summary>

The settings page shows two fields on purpose. These are still read from `config.json` if you put them there, and all have sensible defaults:

| Key | Default | Does |
| --- | --- | --- |
| `playerIps` | — | Fixed IP addresses, for networks that block multicast. Comma separated; one is enough. |
| `discoveryTimeoutMs` | `4000` | How long to listen for speakers at startup. |
| `rediscoverIntervalMs` | `300000` | How often to look for new speakers. |
| `topologyIntervalMs` | `30000` | How often grouping is re-read. |
| `libraryTtlMs` | `300000` | How long the favourites list is cached. |
| `controlPort` | `0` | Port for the loopback control API. `0` picks a free one. Listens on 127.0.0.1 only. |
</details>

---

## Troubleshooting

**No speakers found.** Some networks block multicast between VLANs, or have AP isolation on. Put one speaker's IP address in `config.json` under `playerIps` — the rest are discovered through it.

**A scene names a room that no longer exists.** Renaming a room in the Sonos app renames it everywhere. The scene list marks affected scenes in red and names the missing room; open the scene and pick the new name.

**A step says "none of the speakers were playing".** That is the *only those playing* filter doing its job. It is not an error.

**Something took longer than expected.** Open the **Activity** tab. Every step is there with its duration and the speaker's own answer. A step over three seconds is also called out by name in the Homebridge log.

---

## Contributing

Issues and pull requests are welcome. The test suite is the contract:

```bash
npm test        # 124 unit and integration tests against a full mock Sonos household
npm run test:ui # 95 checks driving the real settings UI in Chromium
```

The mock household in `test/mock-sonos.js` speaks real SOAP over real HTTP on loopback, with configurable latency, real queue update IDs and speakers that can appear mid-run — so the tests exercise the actual protocol, not a stub of it.

---

## Licence

MIT © Mathias Hornbek

Not affiliated with, endorsed by or sponsored by Sonos, Inc. "Sonos" is a trademark of Sonos, Inc., used here only to describe what this plugin controls.

**[Dansk dokumentation →](README.da.md)**
