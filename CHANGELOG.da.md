# Ændringslog (dansk)

> Den løbende ændringslog er nu [`CHANGELOG.md`](CHANGELOG.md) på engelsk.
> Denne fil bevarer den danske historik frem til og med 3.0.1.

## 3.0.1

### `'}))" />` i favoritlisten

Hvert favoritkort havde en stump kode stående over titlen. Årsagen: billedets `onerror`-attribut indeholdt et helt SVG-ikon, og det ikon indeholder selv anførselstegn (`viewBox="0 0 24 24"`). Browserens parser lukkede derfor attributten ved det første indre anførselstegn, og resten — `'}))" />` — endte som synlig tekst på siden. Fejlen har været der siden favoritfanen blev bygget.

Løsningen er at holde op med at bygge markup inde i en attribut: node-mærket tegnes nu altid, og coveret lægges ovenpå. Kan coveret ikke hentes, fjerner det sig selv, og mærket kommer til syne. Ingen markup, ingen anførselstegn, intet at slippe ud. Fire nye browserkontroller holder øje: at der ingen `/>`, `}))`, `onerror` eller `<svg` står som tekst i listen, at hvert kort har præcis ét mærke, at pladsholderen er tom for tekst, og at et billede der ikke kan hentes faktisk forsvinder.

### Indstillingssiden er ryddet

Fanen med Homebridges egen formular viser nu kun **Navn** og **Sprog**. Hele "Avanceret"-blokken er væk, og dermed også kortet "Tekniske indstillinger" i backend, der ikke gjorde andet end at folde den ud.

De seks nøgler (`playerIps`, `discoveryTimeoutMs`, `rediscoverIntervalMs`, `topologyIntervalMs`, `libraryTtlMs`, `controlPort`) læses stadig fra `config.json`, hvis de står der — de er bare ikke noget man skal falde over. De står beskrevet i README under *Skjulte indstillinger*. Beskeden om ingen fundne højttalere peger nu det rigtige sted hen, i stedet for på en menu der ikke findes mere.

### Test

138 enhedstests og 91 browserkontroller (+4).

## 3.0.0

Dansk og engelsk — og en runde på selve håndværket i brugerfladen.

### To sprog, ét valg

Hele plugin'et taler nu både dansk og engelsk: backend, handlingslisten, betingelser, kvitteringer, fejlbeskeder og hver eneste linje i Homebridge-loggen. Der er ét sted at vælge sprog — vælgeren med globussen øverst til højre — og valget gemmes i plugin'ets egen konfiguration, så loggen skifter med. Der er også `Følg systemet`, hvis maskinens sprogindstilling skal bestemme.

Ingen tekst ligger længere spredt ud i koden. Alt, der kan ses, slås op i to ordbøger som en test holder i takt: samme nøgler i begge, ingen tomme, ingen der ved et uheld står ens på begge sprog, og de samme pladsholdere begge steder. Glemmer man en oversættelse, falder testen — den bliver ikke opdaget af dig først.

Handlingerne og betingelserne beskriver nu kun *hvad de gør*; hvad de **hedder** kommer fra ordbogen. Det betyder også, at et sprogskifte slår igennem med det samme i hele editoren — også i handlingslistens overskrifter og i hvert enkelt felts hjælpetekst — uden genstart. Skiftet sendes desuden videre til selve broen, så også trinbeskrivelser, kvitteringer og loggen skifter med det samme og ikke først ved næste opstart. Har du en scene åben mens du skifter, oversættes hele redigeringsvinduet med — og scenens navn bliver stående.

Dine egne navne røres ikke: scener, rum og favoritter hedder præcis hvad du har kaldt dem, uanset sprog.

### Dialoger vi selv tegner

Browserens egne `bekræft`- og `indtast`-bokse er væk. De blev tegnet af browseren, i browserens sprog, midt på skærmen, uden nogen mulighed for at forklare hvad der egentlig sker. I stedet:

- **Slet en scene** spørger i en rigtig dialog, der siger hvad konsekvensen er — og bagefter kan du **fortryde direkte fra kvitteringen**. Hele scenen kommer tilbage, med samme id, så kontakten i Apple Home er den samme som før.
- **"Sæt alle til…"** er blevet en skyder i stedet for et tekstfelt. Man kan ikke længere skrive `12o` og undre sig.
- **Luk uden at gemme**, **gendan backup** og **erstat alle scener** spørger på samme måde, med knapper der siger hvad de gør — ikke "OK".
- Escape lukker, Enter bekræfter, og et klik ved siden af annullerer.

### Fejl der siger til med det samme

Editoren fortæller nu *mens du bygger*, hvad der mangler: en musikscene uden gruppeleder, en kilde der ikke er valgt, en liste uden højttalere. Advarslen står ved det trin den handler om, og et lille mærke på trinnets hoved gør den synlig selv når trinnet er foldet sammen. Før fandt man først ud af det, når scenen kørte.

### Fundet i gennemgangen

Et uafhængigt review af hele ændringen fandt otte ting, som alle er rettet: sprogskiftet nåede ikke frem til broen; et åbent redigeringsvindue blev kun halvt oversat og mistede scenens navn; to steder var der stadig dansk indlejret (`Ny scene` i editorens overskrift og `Fejl 500` fra proxyen); importfejl blev pakket ind i sig selv og sagde ingenting; advarslen om en ukendt højttaler havde mistet oplysningen om *hvilket* trin den kom fra; engelske tællinger stod altid i flertal ("1 unknown rooms"); og kvitteringsloftet på tre kunne fjerne netop den kvittering der tilbød en fortrydelse. Testen der leder efter indlejret dansk kiggede kun i `src/` og kun efter æ, ø og å — den dækker nu også brugerfladen og en håndfuld ord der ikke kan være engelske.

### Under motorhjelmen

- Handlingskataloget bygges nu ved hver forespørgsel i stedet for at ligge fast, så sprogskiftet ikke kræver genstart.
- Kataloget kender forskel på et felts navn i *denne* handling og det generelle navn, så "Lydstyrke" og "Grænse" kan være det samme felt to steder uden at nogen af dem skal skrives to gange.
- Tre lag der stadig havde dansk indlejret — SOAP-timeouts, topologifejl og beskeden om nye højttalere — er nu også oversat.
- En test går koden igennem og fejler, hvis nogen skriver dansk direkte ind i en fil igen.

### Test

138 enhedstests (+17) og 87 kontroller i en rigtig browser (+22). De nye dækker: ordbøgernes overensstemmelse — samme nøgler, samme pladsholdere, ingen tomme, ingen utilsigtet ens; sprogvalg fra brugerfladen hele vejen ned i både konfigurationen og broen; hele editoren på engelsk; et sprogskifte midt i en redigering; slet-og-fortryd med trinnene i behold; og at advarslerne både dukker op og forsvinder igen.

## 2.4.0

Dyb hærdning. Et uafhængigt review med adversarielt fokus fandt otte fejl i afviklingen — alle reproduceret, alle rettet, alle dækket af tests.

### Hurtige tryk og afbrydelser

- **En afbrudt scene kunne vinde over den der afløste den.** Afbrydelsen nåede kommandoerne til de højttalere scenen selv nævnte, men ikke dem til deres gruppeleder — og det er gruppelederen der bestemmer hvad der spiller. Trykkede du to musikscener kort efter hinanden, kunne den *aflyste* ende med at bestemme musikken. Afbrydelsessignalet følger nu med hele vejen.
- **Et afbrudt trin blev talt som lykkedes.** En scene der blev stoppet meldte grønt, både i loggen og i Aktivitet — og en kædet scene kunne rapportere at den havde kørt noget, der aldrig blev kørt.
- **Gentagne tryk på samme scene** er nu ét tryk så længe den kører. Men kun for scener der bestemmer hvad der spiller: to tryk på "Skru op" er stadig to gange +5 %. Før afbrød det andet tryk det første, så lydstyrken kun ændrede sig én gang — og loggen påstod oven i købet at en højttaler havde fejlet.
- **En kædet scene skød sin egen kalder.** Kaldte en scene en anden, opfattede den kaldte scene forælderen som en konkurrent og afbrød den. Alle trin efter kædningen blev droppet, og scenen meldte alligevel succes.
- Afviklinger bogføres nu pr. kørsel i stedet for pr. scene, så to samtidige kørsler ikke kan overskrive hinandens bogholderi og efterlade en kørsel der aldrig ryddes op.

### Rigtige svar frem for hurtige

- **Gruppelederens egen løsrivelse blev ikke bogført.** Skulle scenens gruppeleder først ud af en anden gruppe, troede modellen bagefter stadig at den sad i den gamle gruppe — i op til 30 sekunder. Næste scene kunne så springe tilslutninger over, som faktisk var nødvendige, og sende kommandoer til den forkerte højttaler.
- **Bland kunne slå gentag fra i stilhed.** Hukommelsen over afspilningstilstand udløb aldrig, så en scene der satte bland skrev den gamle gentag-værdi tilbage. Hukommelsen har nu en levetid, og alle veje der ændrer tilstanden opdaterer den.

### Lydstyrke før afspilning

Lydstyrken sættes nu færdig, **før** der overhovedet kommer lyd. Var der skruet højt op i går aftes, nåede man før at høre det i det splitsekund niveauet tog om at følge med. Det koster ét netværkskald og er hele forskellen mellem en scene og et chok. (Vælger man "Faste forsinkelser — som i Homey", beholdes Homeys oprindelige rækkefølge, for det er hvad det valg betyder.)

### Brugerfladen

- **Den grå kasse i toppen er væk.** Homebridge tilpasser rammens højde til indholdet, så siden aldrig scroller — den klæbende header var derfor virkningsløs, og dens baggrund var bare et gråt rektangel malet hen over den hvide dialog. Nu skinner dialogens egen baggrund igennem, og der er luft hele vejen rundt, så ikon og tekst ikke står i kanten.
- **"Forsinkelse før dette trin" er flyttet ned under Avanceret.** Kommandoerne når frem med det samme, så en manuel ventetid er undtagelsen. Den er der stadig, hvis du får brug for den.

### Test

Tests kører nu også med realistisk netværksforsinkelse — flere af fejlene ovenfor var usynlige med øjeblikkelige svar. Tilføjet: 200 tilfældige tryk i træk med gruppen revet fra hinanden undervejs, hvor der kontrolleres for hængende kørsler, ubehandlede fejl og at et sidste tryk stadig sætter huset i en kendt tilstand; og en kontrol efter hver scene af at modellen af husstanden stemmer med højttalerne.

## 2.3.0

De 18 sekunder var ikke sammenstødet mellem to scener. Tallet — 18014 ms — er tre gange den gamle SOAP-timeout på 6000 ms, altså tre kald i træk hvor en højttaler ikke svarede. Gruppen skulle bygges op fra bunden, så alle elleve tilslutninger blev faktisk sendt, og en enkelt tavs højttaler undervejs kostede seks sekunder pr. kald.

- **Kortere ventetid, ét genforsøg.** En Sonos-højttaler på det lokale netværk svarer på titusindedele af et sekund. At vente seks sekunder på et svar giver ingenting — det kommer ikke. Ventetiden er nu 2,5 sekund, og et kald der ikke besvares prøves én gang mere med kort snor. Et kortvarigt tabt svar bliver dermed hentet ind i stedet for at fejle, og en højttaler der er slukket koster mindre end før.
- **Kun det der kan sendes to gange, sendes to gange.** Aflæsninger og absolutte kommandoer (sæt lydstyrke til 20, tilslut gruppe, bliv selvstændig) er ufarlige at gentage. Relative ændringer og "læg playliste i kø" er ikke — de ville ændre lydstyrken to gange eller lægge playlisten i køen to gange. De prøves aldrig igen. Et rigtigt svar fra højttaleren, også et afvisende, er et svar og genforsøges heller ikke.
- **De kald der reelt tager tid har fået længere snor:** at hente en playliste fra en musiktjeneste, gennemse biblioteket og læse gruppetopologien.
- **Ét netværkskald færre i den kritiske vej.** Skal gruppelederen først løsrives fra en anden gruppe, bogføres ændringen internt i stedet for at hente hele topologien igen.
- **Tilslutninger sendes i hold af seks.** Hver gruppeændring får Sonos til at udsende en ny topologi til hele husstanden; elleve på én gang betyder at højttalerne bruger tiden på at snakke indbyrdes. Samme samlede tid, roligere netværk.
- **Et trin der tager over tre sekunder nævnes nu ved navn i loggen** med hvad det lavede. Næste gang noget er langsomt, forklarer loggen sig selv.

Opbygning af hele gruppen fra bunden — præcis situationen fra loggen — er nu en fast test.

## 2.2.0

Ud fra loggen fra rigtig brug. Det vigtigste fund stod på to linjer:

```
2:13:35  ▶ "Baggrundsmusik"
2:13:38  ▶ "Afspil DR P3"
2:13:41  ✔ "Baggrundsmusik" færdig på 6213 ms
2:13:57  ✔ "Afspil DR P3" færdig på 18014 ms
```

- **To musikscener kørte oven i hinanden.** Begge sendte modstridende kommandoer til de samme højttalere, Sonos serialiserede dem, og scener der normalt tager under et sekund tog 6 og 18 sekunder. Nu afbryder en ny musikscene den forrige: trykker du en scene mere, betyder det "nej, denne her i stedet", og den nyeste vinder. Lydstyrke, pause og næste/forrige tæller ikke med — de må gerne køre samtidig med at musik sættes op.
- **Gruppering der allerede er på plads springes over.** Ved et gentryk er huset som regel allerede grupperet præcis som scenen vil have det, og de 13 kommandoer var rene nul-operationer — og samtidig de langsomste, scenen sendte. Grupperingen bogføres internt med det samme, så vurderingen aldrig sker ud fra et forældet billede, og en højttaler du har trukket ud fra Sonos-appen bliver stadig hentet ind igen.
- **Afspilningstilstand koster nu ét kald i stedet for to.** Shuffle og gentag deler samme felt hos Sonos, så det plejede at kræve en læsning først. Den værdi huskes nu.
- `Join Stue til Sonos` melder "allerede med i gruppen" og sender ingenting, hvis Stue allerede er der.

### Brugerfladen

- Søgefelterne fylder nu bredden ud i stedet for at sidde som en lille stump.
- Favoritter uden omslagsbillede får et nodemærke frem for et tomt gråt felt.
- Aktivitet har fået en rigtig tom-tilstand i stedet for én linje løs tekst.
- To linjers scene-resumé bliver ikke længere klippet midt i bogstaverne.
- Højst tre beskeder vises ad gangen, så de ikke dækker det du kigger på.
- Preset-beskrivelsen er kortet ned til én linje.

## 2.1.0

Optimeringer ud fra rigtige målinger. Lydstyrke og pause lå allerede på 27–50 ms; det var opstarten og `Baggrundsmusik` der kunne gøres bedre.

- **Køen genbruges.** Det dyreste en scene laver er at skubbe en Spotify-playliste på køen — Sonos henter den fra tjenesten, og det er hvad der gjorde `Baggrundsmusik` til 1–2 sekunder mod `Afspil DR P3`'s ½. Trykker du scenen igen mens den samme playliste stadig ligger i køen, springes hentningen helt over, og der sendes kun et Play. Køens `UpdateID` sammenlignes, så har du skiftet musik i Sonos-appen i mellemtiden, hentes playlisten selvfølgelig igen.
- **Lydstyrken sættes samtidig med at kilden loader** i stedet for bagefter. De to ting er uafhængige, og grupperingen sker stadig først bagefter, så hver højttaler beholder sit eget niveau.
- **Opstarten er hurtigere.** Søgningen efter højttalere ventede hele søgevinduet ud — 4 sekunder hver eneste gang. Nu er én besvarelse nok, for én højttaler kan beskrive hele husstanden. Det gælder også knappen "Søg efter højttalere igen", som nu svarer med det samme.

## 2.0.0

Omdøbt til **Sonos Control Pro**. Pakken hedder nu `homebridge-sonos-control-pro`, og platform-aliaset `SonosControlPro`.

- **Navnekollision undgået.** `homebridge-sonos-control` findes allerede på npm som et andet plugin (af glurz), og deres nyeste version var tilfældigvis også 1.4.0 — derfor viste Homebridge UI et flueben ved "opdateret". Havde de udgivet en ny version, ville UI'et have tilbudt en opdatering der stilfærdigt erstattede dette plugin med et helt andet. Det kan ikke længere ske.
- **Alt følger med.** Scener og backups flyttes automatisk fra `sonos-control/` (og `sonos-flows/`) til `sonos-control-pro/`. Aliasserne `SonosControl` og `SonosFlows` er stadig registreret, så en uændret `config.json` loader videre. Kontakternes identitet i Apple Home er bundet til et fast navnerum og ikke til pakkenavnet, så en omdøbning ikke i sig selv nulstiller dem.
- **Det gamle navn ryddes op.** Både `install.sh` og `sonos-control-update` afinstallerer en efterladt `homebridge-sonos-control` og fjerner dens forældede kontakter fra Homebridges accessory-cache, så der ikke bliver stående døde kontakter tilbage i Apple Home.

### Brugerfladen

- **Beskrivelserne er nu levende.** Teksten under hvert scenenavn genereres ud fra scenens faktiske trin i stedet for at være gemt tekst — ændrer du en scene, ændrer linjen sig med. F.eks. `♪ DR P3 · → Køkkenalrum · + alle · − Stue, Garage Soundboks`.
- Resuméet er kort og brydes over to linjer i stedet for at strække kortet ud i bredden. Lange lister vises som antal frem for som afkortet tekst.
- Layoutet er gjort responsivt: ved smal bredde falder knapperne ned på deres egen linje i stedet for at blive skubbet ud af syne, og siden kan ikke længere scrolles vandret.
- Din egen beskrivelse er ikke væk — den vises nu som hjælpetekst når du holder musen over linjen.
- **Statuspillen på højttalerkortene ombrød inde i sin egen oval** ("Spiller / ikke" over to linjer). Den holdes nu på én linje, og skriftstørrelserne på kortene er strammet, så et langt rumnavn som "Garage Soundboks" står pænt.
- **Toppen flugter.** Logo, første faneblad og søgefeltet delte ikke venstrekant, og den klæbende header stod som et løsrevet gråt felt oven på den hvide dialog. Baggrunden er nu gennemgående, og alt er rettet ind efter samme kant.
- "fx" er rettet til "f.eks." overalt.

## 1.5.0

- **Grupperede højttalere viste "Stille" selv om de spillede.** Afspilningstilstanden blev kun læst på gruppelederen; en højttaler der følger en gruppe har sin egen transport sat på pause af Sonos og svarede derfor ingenting. Tilstanden læses nu én gang pr. gruppe og gælder alle medlemmer — hele huset i én gruppe koster ét netværkskald i stedet for fjorten, og svaret passer med det man rent faktisk hører i rummet.
- "Stille" hedder nu **"Spiller ikke"**.
- **Sonos-oversigten opdaterer sig selv** hvert 5. sekund mens fanen er åben, og med det samme når du skifter til den. Kun højttalerne hentes, så resten af siden står stille. Der hentes ikke noget mens browserfanen er skjult.
- Kortene viser nu **hvad der spiller** — titel og kunstner fra gruppen.
- Afspil/pause-knappen rammer gruppen og opdaterer med det samme i stedet for efter en fuld genindlæsning.

## 1.4.0

Installation og opdatering rammer nu den maskine hvor Homebridge faktisk kører.

- **Rigtig plugin-mappe.** En `hb-service`-installation (Debian/Ubuntu-pakken) bruger ikke den globale npm-mappe — den lægger plugins i `/var/lib/homebridge/node_modules` med sin egen Node i `/opt/homebridge`. En global installation ender et sted Homebridge aldrig kigger, og alt ser rigtigt ud lige indtil ingenting sker. Både `install.sh` og `sonos-control-update` finder nu selv layoutet og installerer det rigtige sted.
- **Rigtige rettigheder.** Installationen kører som den bruger der ejer Homebridges filer, så intet ender root-ejet og ulæseligt for tjenesten bagefter.
- **`install.sh`** afløser den tidligere macOS-only `install.command`. Den køres på Homebridge-maskinen, finder pakken i `/tmp`, installerer, lægger `sonos-control-update` på PATH, tilføjer platformen til den rigtige `config.json` (med backup) og genstarter via `hb-service` eller `systemctl`.
- **`sonos-control-update --where`** viser hvad der blev fundet: opsætning, plugin-mappe, datamappe, config-sti, npm, hb-service og hvilken bruger tjenesten kører som.
- Release-arkivet ligger nu i `<datamappe>/plugin-releases` i stedet for i root's hjemmemappe, så det følger med i Homebridges egen backup. `/tmp` gennemsøges først, fordi det er der en upload lander.

## 1.3.0

Gennemgang af hele plugin'et med et uafhængigt kodereview. Elleve reelle fejl rettet, plus hastighed og nye funktioner.

### Rettelser

- **Stereopar og Boost:** et rumnavn kunne slå op i den usynlige satellit i et stereopar (begge halvdele hedder det samme). En satellit er aldrig gruppeleder, så *alle* grupperinger i den scene fejlede — og trinnet meldte alligevel succes. Navneopslag rammer nu kun rigtige, adresserbare rum.
- **Tom lydstyrke:** et trin uden udfyldt lydstyrke satte alle valgte højttalere til 0 % og meldte succes. Nu afvises trinnet med en tydelig besked, og intet ændres.
- **Afbrydelse:** genstarter du en scene mens den kører, afbrydes den forriges netværkskald nu med det samme. Før kunne gamle kommandoer lande oven i de nye og efterlade højttalere i den forkerte gruppe.
- **Tilslut gruppe** peger nu på den reelle gruppeleder, hvis det valgte rum selv følger en anden. Før fejlede hver eneste tilslutning.
- **Sonos-playlister** sendes nu uden opdigtet metadata, og en URL får den rigtige indholdsklasse. Før kunne en gemt kø blive afvist af højttaleren.
- **Faste forsinkelser** måles nu fra scenens start som lovet, i stedet for at hobe sig oven på hvor lang tid de foregående skridt tilfældigvis tog.
- **SSDP** sætter nu udgangsinterfacet, så flere netværk faktisk bliver gennemsøgt — ikke kun standardruten.
- **Mistet forbindelse** midt i et svar meldes med det samme og med den rigtige årsag, i stedet for at vente hele timeouten ud og skyde skylden på noget forkert.
- Biblioteks-cachen virker nu også i et hus uden favoritter; før blev favoritter, playlister og radio hentet forfra hver eneste gang.
- Målgruppen "alle der spiller lige nu" opdaterer nu grupperingen først, så den spørger de rigtige gruppeledere.

### Hurtigere

- **Automatisk timing.** Musikscener venter ikke længere på faste forsinkelser: hvert skridt starter, når det forrige er bekræftet udført. En scene med hele huset går fra godt tre sekunder til under ét. Du kan altid vælge "Faste forsinkelser — som i Homey" pr. scene, og de gamle værdier ligger stadig gemt.
- **Genbrugte forbindelser** til højttalerne i stedet for et nyt TCP-håndtryk pr. kommando.
- **Gruppetopologien** hentes én gang og deles af alle trin i en scene i stedet for én gang pr. trin. Svarer en højttaler ikke, spørges resten samtidigt frem for én ad gangen — værste tilfælde falder fra ca. 84 sekunder til ét timeout.

### Nyt

- **Nye højttalere passer sig selv.** Netværket gennemsøges automatisk (som standard hvert 5. minut), så en højttaler du sætter op i eftermiddag bare er der. Musikscener med "alle undtagen…" tager den med uden redigering.
- **Panel for nye højttalere** på Sonos-fanen: højttalere uden lydstyrke i dine musikscener fremhæves, og ét klik giver dem et niveau i dem alle.
- En scene der trykkes lige efter en genstart venter nu på at højttalerne er fundet, i stedet for at fejle på "højttaleren findes ikke".
- **`install.command`** — dobbeltklik for at installere: finder pakken, tilføjer platformen til `config.json` (med backup) og genstarter Homebridge.

## 1.2.0

- Nyt indbygget opdateringsscript: `sudo sonos-control-update`. Finder selv den nyeste `homebridge-sonos-control-*.tgz` i `/tmp`, `~/Downloads`, `~/tmp`, hjemmemappen og release-arkivet, installerer den globalt og genstarter Homebridge.
- Hver installeret version arkiveres i `~/.homebridge/plugin-releases/`, så en tømt `/tmp`-mappe ikke koster muligheden for at geninstallere. De ti nyeste beholdes.
- `--list` viser tilgængelige versioner og markerer den der kører; `--rollback` går tilbage til forrige version; `--no-restart` springer genstarten over; en sti som argument installerer præcis den fil.
- Scriptet finder `hb-service` selv om `sudo` har beskåret `PATH`, og bruger den rigtige brugers hjemmemappe frem for `/var/root`.

## 1.1.0

- Omdøbt til **Sonos Control**. Pakken hedder nu `homebridge-sonos-control`, platform-aliaset `SonosControl` og scenerne ligger i `sonos-control/`.
- Mathias Hornbek sat som author.
- Migrering: scener og backups kopieres automatisk fra `sonos-flows/` ved første start, og det gamle alias `SonosFlows` er stadig registreret, så en uændret `config.json` fortsat loader.
- Transportkommandoer (afspil, pause, stop, næste, forrige, skift) sendes nu kun til gruppeledere. En gruppe på 13 højttalere koster ét netværkskald i stedet for 13, og de falske "transition not available"-fejl fra følgere er væk.
- Afspilning af en favorit, playliste, radiostation eller URL på en højttaler der er med i en gruppe rammer nu gruppelederen, så hele gruppen spiller den — i stedet for at rive gruppen fra hinanden.
- Musikscener bryder gruppelederen ud af en fremmed gruppe først, hvis den følger en anden højttaler. Ellers ville kilden blive afvist eller starte i den forkerte gruppe.

## 1.0.0

Første version.

- Scener som kontakter i Apple Home, med valg mellem tryk-kontakt og til/fra-kontakt pr. scene.
- Lokal Sonos-styring over UPnP: SSDP-opdagelse, gruppetopologi, afspilning, lydstyrke, gruppering, afspilningstilstande og browsing af favoritter, playlister og radiostationer.
- Grafisk backend med scene-liste (træk for at sortere), scene-editor med tidslinje, live Sonos-oversigt, favoritvælger, afprøvning af hele scener og enkelte trin, aktivitetslog, import/eksport og backup.
- Samlet "Musikscene"-handling: gruppeleder, kilde, forlad-liste, lydstyrke pr. højttaler og to fælles forsinkelser i ét trin.
- Målgruppefilter "kun dem der spiller lige nu", så en lydstyrkeregulering ikke rører stille højttalere.
- Preset med færdige scener, klar til at bygge videre på.
- Scener gemmes adskilt fra `config.json` med atomare skrivninger, automatisk backup og karantæne af ulæselige filer.
