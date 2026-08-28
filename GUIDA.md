<p align="center">
  <img src="art/app-icon.svg" width="80" alt="Slotify" />
</p>

# Slotify — Guida completa (italiano)

Slotify è lo strumento di design per le **GUI dipinte** di Minecraft: l'editor visuale,
il registro dei glifi, la misura automatica dei numeri che in gioco falliscono in
silenzio, e l'export completo fino al server. Questa guida copre tutto, dall'installazione
al push sul server dev.

> La versione inglese di riferimento del progetto è nel [README](README.md).

---

## Indice

1. [Che cos'è una GUI dipinta](#1-che-cosè-una-gui-dipinta)
2. [Installazione e avvio](#2-installazione-e-avvio)
3. [Il viewer: esplorare il pack](#3-il-viewer-esplorare-il-pack)
4. [L'editor: creare una schermata](#4-leditor-creare-una-schermata)
5. [Gli strumenti, uno per uno](#5-gli-strumenti-uno-per-uno)
6. [Colori, testi e ombre](#6-colori-testi-e-ombre)
7. [La libreria dei componenti](#7-la-libreria-dei-componenti)
8. [Il generatore di tag](#8-il-generatore-di-tag)
9. [Spostare la GUI e l'ascent](#9-spostare-la-gui-e-lascent)
10. [Esportare](#10-esportare)
11. [Push sul server dev](#11-push-sul-server-dev)
12. [Progetti e profili](#12-progetti-e-profili)
13. [Problemi comuni](#13-problemi-comuni)

---

## 1. Che cos'è una GUI dipinta

Un trucco usato dai grandi server: una normale cassa (chest) il cui **titolo** è un
glifo di un font bitmap. Il glifo è un intero foglio **256×256** registrato in
`assets/minecraft/font/gui.json`; una sequenza di caratteri-spazio invisibili ad
avanzamento negativo riporta il cursore del titolo a sinistra, così l'immagine si
dipinge **dietro l'intera finestra**. I bottoni sono disegnati nel foglio; i click sono
semplici indici di slot gestiti dal plugin.

Funziona benissimo e **fallisce in silenzio**. I tre numeri che decidono tutto:

| Numero | Cos'è | Se è sbagliato |
|---|---|---|
| **ascent** | La posizione verticale del foglio rispetto alla finestra (`rigaFinestra = rigaFoglio − ascent + 13`) | Tutta la schermata è spostata di qualche pixel, e nessun log lo dirà mai |
| **advance** | Di quanto il glifo avanza il cursore = ultima colonna opaca **+ 2** | Ogni overlay successivo finisce fuori posto; un singolo pixel vagante a destra lo gonfia di decine di pixel |
| **codepoint** | Il carattere Unicode privato (es. `U+E8B2`) assegnato al foglio | Due proprietari sullo stesso codepoint: vince l'ultimo, in silenzio |

Slotify **misura** questi numeri dai pixel invece di fartili indovinare, e ti avvisa
quando qualcosa non torna.

---

## 2. Installazione e avvio

### App installata (consigliata)

Lancia `src-tauri/target/release/bundle/nsis/Slotify_0.1.0_x64-setup.exe` (o il `.msi`
nella cartella `msi/`). L'app finisce nel **menu Start** come "Slotify".

Al **primo avvio** l'app chiede la **cartella del repository del pack** (la radice del
repo, quella che contiene `pack-source/`): scegliila col dialog e viene ricordata per le
volte successive.

> Nota: per compilare l'app da sorgente servono Rust (rustup, toolchain MSVC) e i
> VS Build Tools con il Windows SDK — e **Smart App Control deve essere disattivato**,
> perché blocca qualsiasi eseguibile compilato localmente.

### Modalità sviluppo (browser)

```bash
npm install
npm run dev        # server su localhost:1420
```

Copia `slotify.dev.example.json` in `slotify.dev.json` e punta un root al checkout del
repo. In dev il browser parla col filesystem attraverso il bridge del server Vite.

Sul Desktop c'è anche il collegamento **Slotify** (ponte): avvia il server dev e apre
una finestra app dedicata — utile per lo sviluppo con hot-reload.

---

## 3. Il viewer: esplorare il pack

È la schermata iniziale. A sinistra:

- **il riepilogo del pack**: quanti font, glifi e fogli dipinti sono stati trovati;
- **le collisioni di codepoint** in evidenza: due provider che reclamano lo stesso
  carattere nello stesso font — l'errore che in produzione si scopre solo quando una
  schermata "vince" sull'altra;
- **l'elenco dei fogli** raggruppati per cartella (`custom_ui/<modulo>/`).

Selezionando un foglio vedi al centro la **preview pixel-perfect** sulla finestra della
cassa (con le guide: hit-rect degli slot, area inventario) e a destra le **misure**:

- codepoint e file texture;
- **ascent dichiarata** in `gui.json` vs **ascent implicita** ricavata dalle celle
  disegnate — se non combaciano, la schermata è storta in gioco;
- **advance misurato** (ultima colonna opaca + 2);
- **pixel vaganti**: pixel isolati che gonfiano l'advance — il difetto n.1 dell'art
  consegnata, invisibile in un image viewer;
- canvas non-256×256 (verrebbe scalato, non ritagliato).

Le checkbox **Overlays** impilano i fogli della stessa cartella esattamente come li
impilerebbe il titolo in gioco: un errore di advance si vede qui come si vedrebbe lì.

Da qui: **Open in editor** per modificare un foglio esistente, **+ New screen** per
partire da zero, **Tag generator** per il testo pixel.

---

## 4. L'editor: creare una schermata

Il principio da tenere a mente: **disegni sempre la finestra che il giocatore vedrà.**
Le coordinate sono quelle della finestra; l'ascent si applica solo quando il foglio
viene "cotto" all'export. Non puoi sbagliare la verticale in fase di design.

Il layout: **strumenti e libreria a sinistra**, **canvas al centro** (zoom 1–8×,
pinch/rotella; lo sfondo a scacchiera è la trasparenza), **proprietà a destra**
(elemento selezionato, schermo, misure, export).

Il pannello **Screen** a destra governa la schermata:

- `rows` (1–6): le righe del container;
- `shift`: lo shift orizzontale del titolo (default −8, come da convenzione);
- `ascent` / `gui ↓`: vedi [§9](#9-spostare-la-gui-e-lascent);
- `codepoint`: assegnato automaticamente sul primo libero, modificabile;
- `fallback title`: il titolo testuale se il glifo manca;
- `bake window into the sheet`: la finestra (coi suoi buchi) viene disegnata **dentro**
  il PNG esportato — è come funzionano le schermate reali sopra la `generic_54`
  svuotata. Spegnilo solo per art importata che la contiene già.

Nella card **Measured** leggi sempre advance e pixel vaganti del foglio come verrà
esportato.

---

## 5. Gli strumenti, uno per uno

| Strumento | Cosa fa |
|---|---|
| **select** | Seleziona, trascina (gli elementi agganciano i bordi degli altri entro 3px — è così che i pezzi si "connettono"), rifinisce col **nudge pad** da 1px |
| **button** | **Tiles connettibili**: tap su una cella della griglia → bottone 1×1; tap sulla cella adiacente → cresce e si fonde (1×2, 1×3…); tap su una cella già sua → si restringe. Il bevel avvolge il contorno della regione fusa, non le singole celle |
| **infobox** | Piazza **l'infobox standard del progetto**: larghezza piena (176px), altezza nativa della texture dell'artista, agganciata alla riga toccata. Ridimensionabile dai campi w/h; oltre **12 tiles di larghezza si spezza** in una seconda box. Può stare **anche fuori dalla GUI** (a fianco o sotto, ovunque nel canvas 256) |
| **slot** | Uno slot vanilla in più, agganciato alla griglia |
| **erase** | **Scava un buco vero**: tap su qualsiasi regione della finestra (slot, fascia del titolo, gap, margini) → trasparenza piena. Dentro la griglia i vicini si richiudono coi loro bordi; fuori griglia il contorno della finestra si ridisegna attorno al buco. Tap di nuovo per ripristinare |
| **cover** | Il fratello gentile di erase: lo slot **sparisce ma resta il grigio** del pannello, come se non fosse mai stato disegnato. Vale per container, inventario e hotbar |
| **text** | Testo libero nel font di gioco o nel mono 5×5, si auto-misura |
| **panel** | Il **box del titolo del progetto** (la texture `boxtitolo`) reso come ninepatch a qualunque dimensione, con label centrata. Con un colore custom passa al disegno procedurale |
| **well** | Un incavo (inset) libero, per pozzetti decorativi |
| **hotspot** | Dipinge i **gruppi di slot cliccabili**: tap sugli slot con un gruppo attivo per assegnarli; ogni gruppo ha un ruolo colorato (header, action, nav…). Diventano le costanti del Layout Java |

Regole d'oro ereditate dal mondo reale: un bottone largo = tutti gli slot che copre;
un bottone a cavallo di due righe = entrambe le righe; **gli slot dipinti restano
vuoti** (un item sopra coprirebbe l'arte).

---

## 6. Colori, testi e ombre

**Colori.** Ogni elemento colorabile ha il suo picker `fill`. Ricolorando un bottone o
un pannello, **le luci e le ombre non restano mai bianco/nero puri**: la highlight si
schiarisce e vira verso il giallo, l'ombra si scurisce e vira verso il blu-viola — la
regola classica dell'hue-shift in pixel art. Un fill grigio degrada alla rampa vanilla.

**Font.** Due facce ovunque ci sia testo: **minecraft** (l'`ascii.png` vero del pack) e
**mono 5×5** (il monospace integrato, avanzamento fisso 6px, spazio compreso).

**Ombre.** Ogni testo (label, testo libero, righe dell'infobox) ha `shadow`:
`none` oppure una direzione (`below-right`, `below`, `right`, `above-left`, …).
L'ombra è in stile vanilla: stesso testo, un pixel nella direzione scelta, colore al 25%.

**Infobox.** Ogni riga ha **il suo colore** (picker per riga), l'interlinea è a scelta
(`gap` 2/3/4 px) e la **dimensione del testo** è 1× o **2× (lo standard del progetto)**.
La skin è la **texture vera dell'artista** resa come ninepatch: gli angoli restano
angoli, i bordi si ripetono, il centro si affianca — mai stirata.

---

## 7. La libreria dei componenti

I componenti vivono accanto al pack (`tools/slotify/components/`), quindi ogni
schermata futura riparte dagli stessi pezzi.

- **Crearli**: spunta le checkbox ✓ dei layer da raggruppare, scrivi un nome, **Save ✓**.
  Il gruppo viene ri-ancorato al suo angolo e salvato come **composito**.
- **Importarli**: **Import PNG…** carica un'immagine come **sprite**.
- **Piazzarli**: tocca la voce in libreria, poi tocca il canvas. Un composito torna
  **elementi normali e modificabili** (la libreria è un punto di partenza, non un link);
  uno sprite si piazza 1:1.
- **Eliminarli**: il **×** rosso accanto alla voce (con conferma) rimuove i file dal
  disco. Gli elementi già piazzati non vengono toccati; uno sprite orfano mostra un
  contorno rosso al posto dell'immagine.

---

## 8. Il generatore di tag

Il secondo tab della barra: testo → PNG in pixel, nello spirito dei tag generator
classici.

- font **mono 5×5** (default) o **minecraft**;
- scala 1–8×, spaziatura lettere anche negativa;
- **riempimento** pieno o **gradiente verticale** (colore alto → basso);
- **outline** 1px, **ombra** con direzione a scelta;
- **piastra di sfondo** con bordo e padding.

`Download PNG` per il pack; **Save to library** e il tag diventa uno sprite piazzabile
nell'editor (es. l'insegna sopra una schermata).

---

## 9. Spostare la GUI e l'ascent

L'`ascent` è la posizione verticale del foglio: **13** = il foglio inizia esattamente
dove inizia la finestra. Alzarla sposta la finestra **in basso nel canvas**, liberando
spazio sopra per il pannello del titolo o un'insegna. In gioco non cambia nulla: la
finestra atterra sempre al suo posto.

Il campo **`gui ↓`** è la faccia umana della stessa manopola: è lo *spazio sopra la
GUI* in pixel (`ascent − 13`). Alzalo, il margine dell'editor si allarga di
conseguenza, e piazzi il panel sopra la finestra.

**Se invece spingi la finestra oltre il foglio** (ascent sotto 13, o una finestra alta
spostata troppo in giù), il PNG **non viene tagliato di netto**: la finestra viene
**ricostruita più corta**, col bordo e il bevel richiusi sulla linea di taglio, e uno
slot che finirebbe mozzato viene tolto intero.

Ricorda la regola del server: l'ascent è un fatto del resource pack — **non si tara mai
con lo shift**, e nessun comando in gioco può cambiarla.

---

## 10. Esportare

Dalla barra dell'editor e dalla card *Copy out*:

- **Save project** → il progetto come JSON riapribile
  (`tools/slotify/projects/<modulo>-<schermata>.guiproj.json`);
- **Export to pack-source** → scrive il PNG (già ripulito dai pixel vaganti, advance
  misurato) in `pack-source/<modulo>/.../custom_ui/...` e fa lo **splice del provider
  in `gui.json`**. Lo splice è **testuale e idempotente**: aggiunge solo la riga nuova
  prima della parentesi finale, non riserializza mai il file (il diff resta leggibile),
  la seconda esecuzione non fa nulla, e un'ascent cambiata viene corretta chirurgicamente
  sul solo provider interessato;
- **Copy visuals yml** → il blocco `gui.<chiave>.{glyph, title-shift, fallback-title}`
  in stile hospital-visuals;
- **Copy config yml** → la riga `<modulo>.gui.<schermata>-title-shift`;
- **Copy Java scaffold** → la tripletta `<Nome>Glyphs` (codepoint in hex, advance
  misurati, spacer mai clampato), `<Nome>Layout` (le costanti degli hotspot) e
  `<Nome>GlyphsTest` (il simulatore di cursore), nello stile del modulo locker.
  Solo file **nuovi**: Slotify non patcha mai Layout esistenti scritti a mano.

---

## 11. Push sul server dev

La card **Push (dev)**:

1. **pack path**: la cartella del pack di destinazione (una staging dir locale, o il
   pack montato del server dev);
2. **Write files**: scrive il piano di deploy — la texture, e `gui.json` **solo se lo
   splice l'ha davvero cambiato**;
3. host / port / password RCON + **nexo reload pack**: il server ricarica il pack
   (~17 secondi) e guardi il risultato in gioco.

La password RCON viaggia a ogni chiamata e **non viene mai salvata**. Non configurare
mai un target che punti al pack di produzione.

---

## 12. Progetti e profili

**Progetto** = una schermata: righe, codepoint, ascent, shift, elementi, hotspot, buchi,
slot coperti. Si salva e si riapre dalla lista **Projects** nel viewer.

**Profilo** = tutto ciò che è specifico del *tuo* server, in un JSON accanto al pack
(`tools/slotify/next.profile.json` per NEXT): percorsi del font e delle texture, range
di codepoint per modulo, le **skin** dell'infobox e del panel, le costanti geometriche.
Il motore è generico: un progetto futuro = un altro profilo
(vedi `profiles/example.profile.json`).

Regole dei percorsi: nel profilo committato **mai** path assoluti di macchina, host o
credenziali — quelli stanno in `*.profile.local.json` (gitignorato) e nel keychain.

---

## 13. Problemi comuni

| Sintomo | Causa e rimedio |
|---|---|
| *"pack font not loaded — labels won't render"* | Il profilo non trova l'override di `ascii.png` in `default.json`. I testi ripiegano sul mono 5×5; controlla `paths.fontDir` |
| *"no infobox skin in profile"* | Manca `paths.infoboxSkin` nel profilo: l'infobox usa il disegno procedurale (colori misurati dal template NEXT) invece della texture vera |
| Contorno rosso al posto di uno sprite | Il componente sprite è stato eliminato dalla libreria: rimpiazza l'elemento o reimporta il PNG |
| La schermata in gioco è spostata di pochi pixel | Ascent sbagliata: guarda nel viewer "implied ascent vs declared" — e ricorda che si corregge nel pack, non con lo shift |
| Un overlay è fuori posto di decine di pixel | Advance gonfiato da un **pixel vagante**: il contatore "strays" in Measured te lo dice; l'export li rimuove da solo |
| Collisione di codepoint segnalata nel viewer | Due provider sullo stesso carattere nello stesso font: riassegna uno dei due (il campo codepoint propone il primo libero) |
| La schermata si apre grigia in gioco | Il codepoint è citato dal codice ma non ha provider in `gui.json` (riferimento pendente), oppure il pack non è stato ricaricato: `nexo reload pack` |
| L'app installata non vede il pack | Al primo avvio va scelta la **radice del repo** (la cartella che contiene `pack-source/`), non `pack-source` stessa |

---

*Slotify è software libero (GPL-3.0-or-later). Sorgenti: <https://github.com/giovyx90/Slotify>.*
