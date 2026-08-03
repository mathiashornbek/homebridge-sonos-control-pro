<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/icon.png" width="128" alt="Sonos Control Pro" />
</p>

<h1 align="center">Sonos Control Pro</h1>

<p align="center">
  <b>🎵 Hele huset spiller — fra én kontakt i Apple Home.</b><br />
  Byg scenen i en lækker grafisk editor. Tryk på den på telefonen, på uret, eller sig det bare til Siri.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-sonos-control-pro"><img src="https://img.shields.io/npm/v/homebridge-sonos-control-pro?color=4f46e5&label=npm" alt="npm-version" /></a>
  <a href="https://www.npmjs.com/package/homebridge-sonos-control-pro"><img src="https://img.shields.io/npm/dt/homebridge-sonos-control-pro?color=4f46e5" alt="downloads" /></a>
  <a href="https://github.com/mathiashornbek/homebridge-sonos-control-pro/blob/main/LICENSE"><img src="https://img.shields.io/badge/licens-MIT-4f46e5" alt="MIT-licens" /></a>
  <img src="https://img.shields.io/badge/Homebridge-1.8%20%7C%202.x-4f46e5" alt="Homebridge 1.8 og 2.x" />
  <img src="https://img.shields.io/badge/tests-126%20%2B%20100-4f46e5" alt="126 tests, 100 browserkontroller" />
</p>

---

## 😩 Du kender følelsen

Du vil have musik i hele huset **undtagen** stuen. Med de lydstyrker *du* kan lide. Og køkkenet som gruppeleder.

Så du åbner Sonos-appen. Grupperer syv rum i hånden. Sætter syv lydstyrker. Finder playlisten. Hver. Eneste. Gang. 🙄

## ✨ Nu er det én kontakt

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/scenes.png" width="760" alt="Scenelisten" />
</p>

Hver scene du bygger bliver til en helt almindelig kontakt i Apple Home. Tryk på den, og gruppen dannes, hver lydstyrke lander, og musikken starter — **et hus med fjorten rum spiller efter cirka et sekund**. ⚡

> 🗣️ *"Hey Siri, festmusik."*
> 🏠 Læg den på hjemmeskærmen. ⏰ Lad en automatik trykke kl. 07.00. 🎛️ Bind den til en knap.

Det er bare en kontakt. Så **alt hvad HomeKit kan gøre ved en kontakt, kan den nu gøre ved din musik.** 👇

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/apple-home.png" width="700" alt="Scenerne som kontakter i Apple Home" />
</p>

---

## 🏆 Bygget til at være den mest fleksible Sonos-styring du kan lægge i HomeKit

Her er den samme aften, gjort på begge måder.

| | 📱 Sonos-appen, i hånden | ⚡ **Sonos Control Pro** |
| --- | :---: | :---: |
| Gruppér elleve rum | elleve tryk | **ét** |
| Sæt elleve forskellige lydstyrker | elleve træk | **ét** |
| Find playlisten | søg den frem | **ét** |
| Gør det igen i morgen | forfra hver gang | **ét** |
| Fra uret | ❌ | ✅ |
| Fra Siri | ❌ | ✅ |
| Fra en HomeKit-automatik kl. 07.00 | ❌ | ✅ |
| Spring stuen over automatisk | ❌ | ✅ |
| Skru op *kun* i de rum der spiller | ❌ | ✅ |
| Få en højttaler du køber næste måned med, uden at røre noget | ❌ | ✅ |
| Rul hele opsætningen tilbage til i går | ❌ | ✅ |

Og under motorhjelmen: en grafisk editor uden JSON, uden YAML og uden UUID'er · betingelser, forgreninger, forsinkelser og tidslinjer · færdige skabeloner · backup og gendannelse med ét klik · dansk og engelsk overalt · **nul Sonos-afhængigheder i drift**.

**30 handlinger. 5 målgruppetyper. 4 live-filtre. Ubegrænset antal scener.** Kombinér dem som du vil — pluginnet antager aldrig noget om, hvordan dit hus ser ud.

---

## 🔄 Alt er live. Intet er hårdkodet.

Det er den del, folk bliver forelskede i. 💘

Der er **ikke ét eneste UUID, én IP-adresse eller ét rumnavn**, du skal skrive. Hele editoren fyldes ud fra dine højttalere, i realtid:

- 🔊 **Dine højttalere** vises som klikbare navne — hentet live fra husstanden, lige nu
- 🎧 **Dine favoritter, playlister og radiostationer** kommer direkte fra Sonos-systemet — vælg fra en liste i stedet for at lede efter en URI
- 📊 **Rigtige lydstyrker, rigtig afspilningsstatus, rigtige grupper** — opdateret løbende, ikke gættet
- ➕ **Køber du en ny højttaler i eftermiddag**, kommer den *automatisk* med i dine "alle undtagen…"-scener. Uden at du retter noget. Sonos-fanen fremhæver den, så du kan give den en lydstyrke med ét klik.
- ✏️ **Omdøber du et rum i Sonos-appen**, markeres hver berørt scene med rødt, med navns nævnelse, så intet holder op med at virke i stilhed

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/speakers.png" alt="Live højttaleroversigt" /></td>
<td width="50%"><img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/favourites.png" alt="Favoritter hentet fra Sonos" /></td>
</tr>
<tr>
<td>🎚️ <b>Din husstand, live.</b> Hver højttaler med sin rigtige lydstyrke, hvad den spiller, og hvilken gruppe den er i. Træk i en skyder her, og højttaleren følger med i rummet.</td>
<td>💿 <b>Dit bibliotek, direkte fra Sonos.</b> Favoritter, playlister og radiostationer hentet fra dit eget system — med albumbilleder. Klik for at bruge.</td>
</tr>
</table>

---

## 🎨 Ét trin bygger en hel scene

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/editor.png" width="760" alt="Sceneeditoren" />
</p>

Den handling du kommer til at bruge mest er **Start musik i en gruppe** — ét trin, der klarer alt hvad en musikscene har brug for:

| | |
| --- | --- |
| 👑 **Gruppeleder** | Højttaleren der driver afspilningen. Alle andre følger den. |
| 🎵 **Hvad der skal spilles** | En Sonos-favorit, en playliste, en radiostation, en URL — eller behold det der allerede kører. |
| ➕ **Hvem der er med** | *Alle undtagen…* (passer sig selv) eller en fast liste. |
| ➖ **Hvem der forlader** | De rum der skal noget andet. Eller ingenting. |
| 🔉 **Lydstyrke pr. højttaler** | Med den normale *automatiske* timing sat færdig **inden** der kommer lyd — så en højttaler der stod på 60 % i går aftes ikke giver dig et chok. |
| 🔀 **Bland / gentag / crossfade** | Lad stå på *Uændret* for ikke at røre dem. |
| ⏱️ **Timing** | *Automatisk* (hurtigst — hver fase starter når den forrige melder klar) eller faste tidspunkter du selv sætter, vist som en tidslinje. |

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/editor-group.png" width="700" alt="Valg af kilde, hvem der forlader gruppen, og hvem der kommer med automatisk" />
</p>

Læg mærke til **Included automatically**: de rum har du aldrig skrevet ind. Du sagde *"alle undtagen stuen og garagen"*, og scenen regner resten ud — i dag, og igen den dag du sætter en ny højttaler op. 🪄

### 🎚️ Skriv den, eller træk i den — du bestemmer

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/editor-levels.png" width="700" alt="Lydstyrke pr. højttaler med indtastede procenter" />
</p>

Hver højttaler får sin egen lydstyrke, med både skyder **og** talfelt — for en skyder er fremragende til at finde niveauet på øret og ubrugelig til at sige "tolv". 🎯 Ét klik på **Brug nuværende lydstyrker** fanger det, der allerede lyder rigtigt i huset. Ét `×` betyder *lad den her højttaler være*.

### 🛟 Og den er svær at ødelægge

Alt destruktivt spørger først — og giver dig **alligevel** en Fortryd bagefter. ↩️ Scener valideres mens du bygger: en musikscene uden gruppeleder siger det selv, ved trinnet, inden du gemmer. Intet skrives i `config.json`, så en dårlig rettelse kan aldrig vælte din bridge. 🛡️

---

## 🎁 Skabeloner: et fungerende system på cirka tredive sekunder

<p align="center">
  <img src="https://raw.githubusercontent.com/mathiashornbek/homebridge-sonos-control-pro/main/docs/screenshots/backup.png" width="760" alt="Skabeloner, eksport/import og backups" />
</p>

Start ikke på en tom side. Tryk **Hent de fire startscener**, og du har med det samme fire kontakter der virker — **Musik i hele huset**, **Pause alt**, **Skru op**, **Skru ned** — allerede koblet til *dine* højttalere, fordi skabelonen fylder sig selv ud fra din live husstand. 🪄

Under **Import & backup → Kom godt i gang** vælger du **Indlæs og erstat alt** eller **Tilføj ved siden af mine scener**. Bagefter er de helt almindelige scener: ret dem til præcis det, du gerne vil have. Og enhver scene kan **dubleres** med ét klik, så "det samme igen, bare ovenpå" er ti sekunders arbejde. 📋

## 💾 Backup: et sikkerhedsnet du aldrig behøver tænke over

- 🔁 **Automatisk.** Der gemmes en version med tidsstempel *hver eneste gang* du ændrer noget. De 20 nyeste bevares.
- ⏮️ **Gendan med ét klik.** Vælg et tidspunkt i listen og rul hele systemet tilbage.
- 📤 **Eksportér alt som JSON** — download det, eller kopiér det til udklipsholderen.
- 📥 **Importér** på en ny bridge, eller del en opsætning med en ven. Rum der ikke findes bliver nævnt ved navn i stedet for bare at fejle i stilhed.
- 🧯 **Umuligt at korrumpere.** Der skrives atomisk; en beskadiget fil sættes i karantæne i stedet for at være fatal.

Flytter du, bygger du din bridge om, eller eksperimenterer du bare — dine scener er altid ét klik fra at være i sikkerhed. 😌

---

## 📈 Se præcis hvad der skete

Åbn fanen **Aktivitet**, og der ligger hver kørsel, trin for trin, med **hvor lang tid hvert trin tog** og **præcis hvad hver højttaler svarede**. ⏱️ Når noget opfører sig underligt, kan du se hvorfor på få sekunder — i stedet for at gætte ud fra en logfil. Et trin over tre sekunder nævnes også ved navn i Homebridge-loggen.

---

## ⚡ Installeret på to minutter

Søg efter **Sonos Control Pro** under Plugins i Homebridge-brugerfladen og tryk Installér. Eller:

```bash
npm install -g homebridge-sonos-control-pro
```

Tilføj så platformen. Indstillingssiden har præcis **to felter**, fordi alt andet hører hjemme i editoren: 😌

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

Genstart Homebridge → åbn **Plugins → Sonos Control Pro → Indstillinger** → tryk **Hent de fire startscener**. Færdig. 🎉

> 💡 **Tip:** kør den som [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges). Scenekontakter kommer og går, mens du retter, og en child bridge holder den uro væk fra din hovedbridge.

---

## 🧰 Hele værktøjskassen

### 🎬 Handlinger

| Kategori | Handlinger |
| --- | --- |
| 🎵 **Musikscene** | Start musik i en gruppe *(den store — leder, kilde, hvem der er med, hvem der forlader, lydstyrker, afspilningstilstande, timing)* |
| ▶️ **Afspilning** | Afspil Sonos-favorit · Afspil Sonos-playliste · Afspil radiostation · Afspil URL / stream · Afspil · Pause · Stop · Afspil / pause (skift) · Næste nummer · Forrige nummer · Skift til line-in · Skift til TV-lyd |
| 🔊 **Lydstyrke** | Sæt lydstyrke · Skru op / ned · Sæt gruppelydstyrke · Skru gruppen op / ned · Slå lyden fra / til · Skift lyd fra / til |
| 🔗 **Gruppering** | Tilslut gruppe · Forlad gruppe |
| ⚙️ **Lydindstillinger** | Bland numre · Gentag · Crossfade · Loudness · Bas og diskant |
| 🧩 **Rækkefølge** | Vent · Gem nuværende tilstand · Gendan gemt tilstand · Kør en anden scene |

### 🎯 Hvem det rammer — her ligger den rigtige præcision

| Målgruppe | Betyder |
| --- | --- |
| 🌍 **Alle højttalere** | Alt hvad husstanden har, *lige nu* |
| ✅ **Valgte højttalere** | Præcis de rum du peger på |
| 🚫 **Alle undtagen** | Alt minus de rum du peger på — **nye højttalere kommer automatisk med** |
| 🔗 **Gruppen omkring** | Dem der lige nu er grupperet med et bestemt rum |
| 👑 **Gruppelederen for** | Den ene højttaler der ejer gruppens afspilning |

…og derefter et live-filter: **uanset tilstand** · **kun dem der spiller lige nu** · **kun dem der er stille** · **kun gruppeledere**.

Det andet er hele tricket bag en tryg lydstyrkescene. 🤫 **"+5 %, kun dem der spiller"** skruer op i køkkenet uden nogensinde at vække soveværelset.

### 🎚️ Kontakttyper

- **Tryk** ▶️ — kører og slukker sig selv igen, som en knap. *"Start musikken", "sæt alt på pause", "skru op".*
- **Tænd/sluk** 🔛 — bliver ved med at være tændt, indtil du slukker den, og at slukke kører **en anden liste af handlinger**. *"Aftenmusik" der sætter huset på pause, når du slukker den.*

Enhver scene kan også bære en **betingelse** 🤔 — *spiller der noget? er klokken mellem 22 og 06? er køkkenet over 30 %?* — med en hel anden gren for når den ikke er opfyldt.

---

## 🔒 Ægte lokal. Ægte privat.

- 🏠 Kommandoerne går **direkte til dine højttalere** over UPnP på dit eget netværk
- ☁️ **Ingen tur forbi skyen. Ingen konto. Ingen hub. Intet web-API der skal spørges.**
- 📴 **Internettet nede? Dine scener virker stadig.**
- 📡 **Nul telemetri, nul analytics** — ingen udgående forbindelse overhovedet, ud over til dine egne højttalere
- 📦 **Nul Sonos-afhængigheder i drift** — hele protokollaget er skrevet i hånden og testet mod en komplet efterligning af en husstand

---

## 🇩🇰 🇬🇧 Tosproget hele vejen ned

Hele backend, hver handling, hver hjælpetekst, hver linje i Homebridge-loggen — på **dansk og engelsk**. Én vælger, i toppen, der skifter live. 🌍

---

<details>
<summary><b>🔧 Under motorhjelmen — sådan taler den med Sonos</b></summary>

Ren UPnP/SOAP over HTTP til port 1400 på hver højttaler: `AVTransport`, `RenderingControl`, `GroupRenderingControl`, `ContentDirectory`, `ZoneGroupTopology`, `DeviceProperties`. Opdagelsen sker med SSDP med tidligt stop — ét svar beskriver hele husstanden — plus en manuel IP-liste til netværk, der blokerer multicast.

Forbindelser genbruges og holdes i live. Timeout er som udgangspunkt 2,5 s — længere for de få kald der reelt er langsomme, f.eks. at gennemse biblioteket — med ét kort genforsøg, og kun for kald der er sikre at sende to gange: læsninger og absolutte sæt. En relativ lydstyrkeændring eller "læg i kø" gentages aldrig, for det ville være forkert at gøre to gange.

Topologien caches og opdateres efter skema, og grupperingsændringer bogføres med det samme frem for at blive læst igen — både hurtigere og mere korrekt, da en læsning lige efter en ændring alligevel besvares fra cachen.
</details>

<details>
<summary><b>⏱️ Under motorhjelmen — sådan kører en scene</b></summary>

Alle trin starter på én gang og venter hver sin forsinkelse af, målt fra scenens start. Et trin med 2 s forsinkelse går i gang 2 s efter trykket — ikke 2 s efter det forrige trin blev færdigt. En scene kan i stedet vælge streng sekventiel udførelse.

Inde i en musikscene er faserne rækkefølgesat, så intet overrasker dig: **lydstyrke først**, så alt der laver lyd, så gruppering, så afspilningstilstande. Med *automatisk* timing starter hver fase i det øjeblik den forrige melder klar; med *fast* timing starter hver fase på sit eget tidspunkt regnet fra scenens start.

Grupperinger der allerede er på plads springes over. Kommandoer sendes i hold, så højttalerne ikke bruger tiden på at sladre om topologi i stedet for at svare.

At trykke på den samme scene igen, mens den kører, tæller som ét tryk, ikke to — men kun for scener der bestemmer hvad der spiller. To tryk på "skru op" betyder virkelig to gange. Trykker du på en *anden* musikscene, annulleres den første, helt ned til de kommandoer der er på vej til dens gruppeleder.
</details>

<details>
<summary><b>📁 Under motorhjelmen — hvor dine data ligger</b></summary>

Scenerne ligger i `sonos-control-pro/scenes.json` ved siden af din Homebridge-config — aldrig i `config.json`, så en dårlig rettelse kan aldrig vælte bridgen. Der skrives atomisk, og hver gemning efterlader en backup med tidsstempel; de 20 nyeste bevares og kan gendannes fra indstillingerne. En beskadiget fil sættes i karantæne frem for at være fatal.
</details>

<details>
<summary><b>🎛️ Skjulte indstillinger</b></summary>

Indstillingssiden viser to felter med vilje. Disse læses stadig fra `config.json`, hvis du skriver dem ind, og har alle fornuftige standardværdier:

| Nøgle | Standard | Gør |
| --- | --- | --- |
| `playerIps` | — | Faste IP-adresser, til netværk der blokerer multicast. Kommasepareret; én er nok. |
| `discoveryTimeoutMs` | `4000` | Hvor længe der lyttes efter højttalere ved opstart. |
| `rediscoverIntervalMs` | `300000` | Hvor tit der ledes efter nye højttalere. |
| `topologyIntervalMs` | `30000` | Hvor tit grupperingen læses igen. |
| `libraryTtlMs` | `300000` | Hvor længe favoritlisten caches. |
| `controlPort` | `0` | Port til det lokale kontrol-API. `0` vælger en ledig. Lytter kun på 127.0.0.1. |
</details>

---

## 🩺 Fejlfinding

**🔍 Ingen højttalere fundet.** Nogle netværk blokerer multicast mellem VLAN'er eller har AP-isolation slået til. Skriv én højttalers IP-adresse i `config.json` under `playerIps` — resten findes gennem den.

**🏷️ En scene nævner et rum, der ikke findes længere.** Omdøber du et rum i Sonos-appen, omdøbes det overalt. Scenelisten markerer de berørte scener med rødt og nævner det manglende rum; åbn scenen og vælg det nye navn.

**🤫 Et trin siger "ingen af højttalerne spillede".** Det er filteret *kun dem der spiller*, der gør sit arbejde. Det er ikke en fejl.

**🐌 Noget tog længere tid end forventet.** Åbn fanen **Aktivitet**. Hvert trin står der med sin varighed og højttalerens eget svar.

---

## 🤝 Vil du bidrage?

Issues og pull requests er meget velkomne. Testsuiten er kontrakten:

```bash
npm test        # 126 tests mod en komplet efterligning af en Sonos-husstand
npm run test:ui # 100 kontroller der styrer den rigtige brugerflade i Chromium
```

Efterligningen i `test/mock-sonos.js` taler ægte SOAP over ægte HTTP på loopback, med indstillelig forsinkelse, rigtige kø-id'er og højttalere der kan dukke op midt i en kørsel — så testene afprøver den faktiske protokol, ikke en attrap. 🧪

---

## 📄 Licens

MIT © Mathias Hornbek

Ikke tilknyttet, godkendt af eller sponsoreret af Sonos, Inc. "Sonos" er et varemærke tilhørende Sonos, Inc., brugt her udelukkende til at beskrive hvad dette plugin styrer.

<p align="center">
  <b>⭐ Har det gjort dit hus bedre, betyder en stjerne på GitHub meget.</b><br />
  <b><a href="README.md">🇬🇧 English documentation →</a></b>
</p>
