<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/icon.png" width="128" alt="Sonos Control Pro" />
</p>

<h1 align="center">Sonos Control Pro</h1>

<p align="center">
  <b>Hele huset spiller — fra én kontakt i Apple Home.</b><br />
  Byg scenen i en grafisk editor. Tryk på den på telefonen, på uret, eller sig det til Siri.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-sonos-control-pro"><img src="https://img.shields.io/npm/v/homebridge-sonos-control-pro?color=4f46e5&label=npm" alt="npm-version" /></a>
  <a href="https://github.com/mathiashornbek/homebridge-sonos-control-pro/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/homebridge-sonos-control-pro?color=4f46e5" alt="MIT-licens" /></a>
  <img src="https://img.shields.io/badge/Homebridge-1.8%20%7C%202.x-4f46e5" alt="Homebridge 1.8 og 2.x" />
  <img src="https://img.shields.io/badge/tests-124%20%2B%2095-4f46e5" alt="124 tests, 95 browserkontroller" />
</p>

---

Du kender følelsen. Du vil have musik i hele huset *undtagen* stuen, med de lydstyrker du kan lide, og køkkenet som gruppeleder — og det kræver, at du åbner Sonos-appen, grupperer syv rum i hånden og sætter syv lydstyrker. Hver eneste gang.

**Sonos Control Pro gør det til én kontakt.**

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-scenes-da.png" width="720" alt="Scenelisten" />
</p>

Hver scene bliver til en helt almindelig kontakt i Apple Home. Tryk på den, og gruppen dannes, lydstyrkerne lander, og musikken starter — typisk **på under et sekund for et hus med fjorten rum**. Spørg Siri. Læg den på hjemmeskærmen. Lad en HomeKit-automatik trykke på den kl. 07.00. Det er bare en kontakt, så alt hvad HomeKit kan gøre ved en kontakt, kan den nu gøre ved din musik.

---

## Hvorfor lige denne

**Den er ægte lokal.** Kommandoerne går direkte til højttalerne over UPnP på dit eget netværk. Ingen tur forbi skyen, ingen konto, ingen hub, ingen web-API der skal spørges. Er internettet nede, virker dine scener stadig. Der er **nul Sonos-afhængigheder i drift** — hele protokollaget er skrevet i hånden og testet mod en komplet efterligning af en husstand.

**Ingenting er hårdkodet.** Højttalere vælges som klikbare navne, hentet live fra dit system. Du skal aldrig lede efter et UUID i en logfil.

**Den er hurtig med vilje.** Lydstyrken sættes færdig, *inden* der kommer lyd, så en højttaler der stod på 60 % i går aftes ikke giver dig et chok. Grupperinger der allerede er på plads springes over. Kommandoer sendes i hold, så højttalerne ikke bruger tiden på at sladre om topologi i stedet for at svare.

**Lydstyrken justeres kirurgisk.** "Skru op" rører kun højttalere der *faktisk spiller*. Stille rum lades i fred — ikke mere vækning af soveværelset, fordi du skruede op i køkkenet.

**Nye højttalere passer sig selv.** Sætter du en Sonos One op i eftermiddag, kommer den automatisk med i dine "alle undtagen…"-scener. Sonos-fanen fremhæver den, så du kan give den en lydstyrke med ét klik.

**Dansk og engelsk.** Hele backend, hver handling, hver linje i Homebridge-loggen. Én vælger, i toppen.

---

## Sådan ser det ud

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-editor-da.png" alt="Sceneeditoren" /></td>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-sonos-da.png" alt="Live højttaleroversigt" /></td>
</tr>
<tr>
<td><b>Ét trin klarer hele scenen.</b> Vælg gruppeleder, hvad der skal spilles, hvem der er med, hvem der holdes udenfor, og lydstyrken for hver — med en tidslinje der viser præcis hvornår hver fase går i gang.</td>
<td><b>Din husstand, live.</b> Hver højttaler med sin rigtige lydstyrke, hvad den spiller, og hvilken gruppe den er i. Træk i en skyder, og højttaleren følger med.</td>
</tr>
<tr>
<td><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-library-da.png" alt="Favoritter" /></td>
<td><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/ui-activity-da.png" alt="Aktivitetslog" /></td>
</tr>
<tr>
<td><b>Dine favoritter, direkte fra Sonos.</b> Playlister, radiostationer og favoritter læses fra dine højttalere — vælg fra en liste i stedet for at skrive en URI.</td>
<td><b>Hver afvikling, trin for trin.</b> Hvor lang tid det tog, og præcis hvad hver højttaler svarede. Går noget galt, kan du se hvorfor.</td>
</tr>
</table>

---

## Installation

Søg efter **Sonos Control Pro** under Plugins i Homebridge UI og tryk Install. Eller:

```bash
npm install -g homebridge-sonos-control-pro
```

Tilføj derefter platformen. Indstillingssiden har kun to felter, fordi alt andet hører hjemme i editoren:

```json
{
  "platforms": [
    {
      "platform": "SonosControlPro",
      "name": "Sonos Control Pro",
      "language": "da"
    }
  ]
}
```

Genstart Homebridge, åbn **Plugins → Sonos Control Pro → Settings** og tryk **Hent de fire startscener**. Så har du musik i hele huset, pause, og op og ned for lyden med det samme — og kan bygge dem om til præcis det du vil have.

> **Tip:** kør den som [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges). Kontakter dukker op og forsvinder mens du redigerer, og en child bridge holder det væk fra din hovedbro.

---

## Sådan bygger du en scene

En scene er et navn, en kontakttype og en liste af handlinger. Ikke mere.

Den du kommer til at bruge mest er **Start musik i en gruppe** — ét trin der gør alt hvad en musikscene skal:

| | |
| --- | --- |
| **Gruppeleder** | Højttaleren der styrer afspilningen. Alle andre følger den. |
| **Hvad skal spilles** | En Sonos-favorit, en playliste, en radiostation, en URL — eller behold det der spiller. |
| **Hvem er med i gruppen** | *Alle undtagen…* (passer sig selv) eller en liste du selv styrer. |
| **Højttalere der forlader** | De rum der skal noget andet. Eller ingenting. |
| **Lydstyrke pr. højttaler** | Sættes inden der kommer lyd. Skydere, eller "brug nuværende lydstyrker" til at fange det der allerede lyder rigtigt. |
| **Bland / gentag / crossfade** | Lad stå på *Uændret* for ikke at røre dem. |

Alt kontrolleres mens du bygger: en musikscene uden gruppeleder siger til med det samme, ved trinnet, inden du gemmer.

### De øvrige handlinger

| Kategori | Handlinger |
| --- | --- |
| **Afspilning** | Afspil favorit · Afspil playliste · Afspil radio · Afspil URL/stream · Afspil · Pause · Stop · Skift · Næste · Forrige · Line-in · TV-lyd |
| **Lydstyrke** | Sæt lydstyrke · Skru op/ned · Sæt gruppelydstyrke · Skru gruppen op/ned · Slå lyden fra · Skift lyd fra/til |
| **Gruppering** | Tilslut gruppe · Forlad gruppe |
| **Indstillinger** | Bland · Gentag · Crossfade · Loudness · Bas og diskant |
| **Forløb** | Vent · Gem tilstand · Gendan tilstand · Kør en anden scene |

### Hvilke højttalere

Hver handling har en målgruppe, og det er der skarpheden ligger:

| Målgruppe | Betyder |
| --- | --- |
| Alle højttalere | Alt hvad husstanden har, lige nu |
| Valgte højttalere | Præcis de rum du peger på |
| Alle undtagen | Alt minus de rum du peger på — nye højttalere kommer automatisk med |
| Gruppen omkring | Dem der lige nu er grupperet med et bestemt rum |
| Gruppelederen for | Den ene højttaler der ejer gruppens afspilning |

…og derefter et filter: **uanset tilstand** · **kun dem der spiller lige nu** · **kun de stille** · **kun gruppeledere**.

Det andet er det, der gør en lydstyrkescene skudsikker. "+5 %, kun dem der spiller" er hele tricket.

### Kontakttyper

- **Tryk** — kører og slukker sig selv igen, som en knap. Til "start musikken", "pause alt", "skru op".
- **Til/fra** — bliver stående tændt, og når du slukker den, køres en anden liste af handlinger. Til "aftenmusik" der sætter huset på pause, når du slukker.

En scene kan også have en **betingelse** — spiller der noget? er klokken mellem 22.00 og 06.00? er køkkenet over 30 %? — med en anden gren for når den ikke er opfyldt.

---

## Under motorhjelmen

<details>
<summary><b>Sådan taler den med Sonos</b></summary>

Rent UPnP/SOAP over HTTP til port 1400 på hver højttaler: `AVTransport`, `RenderingControl`, `GroupRenderingControl`, `ContentDirectory`, `ZoneGroupTopology`, `DeviceProperties`. Søgningen er SSDP med tidlig afslutning — ét svar beskriver hele husstanden — plus en manuel IP-liste til netværk der blokerer multicast.

Forbindelser genbruges og holdes i live. Ventetiden er 2,5 sekund med ét kort genforsøg, og kun for kald der er ufarlige at sende to gange: aflæsninger og absolutte kommandoer. En relativ lydstyrkeændring eller en "læg i kø" prøves aldrig igen, for det ville være forkert at gøre to gange.

Topologien holdes i hukommelsen og opdateres efter en fast rytme, og grupperinger bogføres med det samme i stedet for at blive læst igen — både hurtigere og mere korrekt, eftersom en aflæsning lige efter en ændring alligevel besvares fra hukommelsen.
</details>

<details>
<summary><b>Sådan afvikles en scene</b></summary>

Alle trin starter på én gang og venter hver deres forsinkelse ud, målt fra scenens start. Et trin med 2 sekunders forsinkelse går i gang 2 sekunder efter trykket — ikke 2 sekunder efter det forrige trin blev færdigt. En scene kan i stedet vælge streng rækkefølge.

Inde i en musikscene ligger faserne, så ingenting overrasker: lydstyrke først, så alt der laver lyd, så gruppering, så afspilningstilstande. På *automatisk* timing starter hver fase i det øjeblik den forrige bekræfter; på *faste forsinkelser* starter hver fase på sit eget tidspunkt målt fra scenens start.

At trykke på den samme scene igen mens den kører tæller som ét tryk, ikke to — men kun for scener der bestemmer hvad der spiller. To tryk på "skru op" betyder virkelig to gange. Trykker du på en *anden* musikscene, afbrydes den første, helt ned til de kommandoer der var på vej til dens gruppeleder.
</details>

<details>
<summary><b>Hvor dine data ligger</b></summary>

Scenerne bor i `sonos-control-pro/scenes.json` ved siden af din Homebridge-config — aldrig i `config.json`, så en dårlig rettelse kan aldrig tage broen ned. Skrivninger er atomare, og hver gemning efterlader en tidsstemplet backup; de 20 nyeste beholdes og kan gendannes fra indstillingerne. En ødelagt fil sættes i karantæne i stedet for at være fatal.

Intet forlader dit netværk. Ingen telemetri, ingen analytics, og ingen udgående forbindelse overhovedet ud over til dine egne højttalere.
</details>

<details>
<summary><b>Skjulte indstillinger</b></summary>

Indstillingssiden viser med vilje kun to felter. Disse læses stadig fra `config.json`, hvis du skriver dem ind, og har alle et fornuftigt standardvalg:

| Nøgle | Standard | Gør |
| --- | --- | --- |
| `playerIps` | — | Faste IP-adresser, til netværk der blokerer multicast. Kommasepareret; én er nok. |
| `discoveryTimeoutMs` | `4000` | Hvor længe der lyttes efter højttalere ved opstart. |
| `rediscoverIntervalMs` | `300000` | Hvor tit der ledes efter nye højttalere. |
| `topologyIntervalMs` | `30000` | Hvor tit grupperingen læses igen. |
| `libraryTtlMs` | `300000` | Hvor længe favoritlisten holdes i hukommelsen. |
| `controlPort` | `0` | Port til kontrol-API'et. `0` vælger en ledig. Lytter kun på 127.0.0.1. |
</details>

---

## Fejlfinding

**Ingen højttalere fundet.** Nogle netværk blokerer multicast mellem VLAN'er eller har AP-isolation slået til. Skriv én højttalers IP-adresse i `config.json` under `playerIps` — resten findes gennem den.

**En scene nævner et rum der ikke findes.** Omdøber du et rum i Sonos-appen, omdøbes det alle steder. Scenelisten markerer de berørte scener med rødt og nævner det manglende rum; åbn scenen og vælg det nye navn.

**Et trin siger "ingen af højttalerne spillede".** Det er filteret *kun dem der spiller* der gør sit arbejde. Det er ikke en fejl.

**Noget tog længere tid end ventet.** Åbn fanen **Aktivitet**. Hvert trin står der med sin varighed og højttalerens eget svar. Et trin over tre sekunder nævnes desuden ved navn i Homebridge-loggen.

---

## Bidrag

Issues og pull requests er velkomne. Testsuiten er kontrakten:

```bash
npm test        # 124 enheds- og integrationstests mod en komplet efterlignet Sonos-husstand
npm run test:ui # 95 kontroller der kører den rigtige backend i Chromium
```

Efterligningen i `test/mock-sonos.js` taler rigtig SOAP over rigtig HTTP på loopback, med netværksforsinkelse, rigtige kø-opdaterings-id'er og højttalere der kan dukke op midt i en afvikling — så testene rammer den faktiske protokol, ikke en attrap.

---

## Licens

MIT © Mathias Hornbek

Ikke tilknyttet, godkendt af eller sponsoreret af Sonos, Inc. "Sonos" er et varemærke tilhørende Sonos, Inc., brugt her udelukkende for at beskrive hvad dette plugin styrer.

**[English documentation →](README.md)**
