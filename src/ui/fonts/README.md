# Bundled fonts

Slotify's interface uses the same two faces as the NEXT Roleplay portal, so a screen
designed here and the page that documents it read as one product.

| File | Face | Weights | Licence |
|---|---|---|---|
| `archivo-latin.woff2` | [Archivo](https://fonts.google.com/specimen/Archivo) | 100–900 (variable) | SIL Open Font License 1.1 |
| `plex-mono-400-latin.woff2` | [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) | 400 | SIL Open Font License 1.1 |
| `plex-mono-600-latin.woff2` | IBM Plex Mono | 600 | SIL Open Font License 1.1 |

Both families are under the SIL OFL 1.1, which permits bundling and redistribution
inside this GPL-3.0 application.

Only the **latin** subset is shipped. It covers U+0000–U+00FF, which includes every
accented character Italian and English need; anything outside it falls back per
character to the next family in the stack, which is what the stack is for. The app is a
desktop tool and must render identically with no network, so the faces are bundled
rather than fetched from a CDN.
