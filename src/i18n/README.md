<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# The copy rules

Slotify speaks two languages. English is the source of truth; Italian is written against
it, not against whatever English said before.

The copy in this app was rewritten once already, and the reason is worth keeping: it had
grown into an essay. Em dashes, semicolons, a tooltip 190 characters long, a paragraph
under a panel explaining three of its twelve buttons and none of the other nine. It read
like something generated, not like something an app says. What follows is what replaced
it.

## Rules

1. **An action is imperative and at most six words.** "Save project", not "Save this
   project to disk". A heading is a noun: "Screen", not "Screen settings".
2. **No em dashes, no semicolons.** One clause per sentence. If a sentence needs a
   semicolon it is two sentences, and probably one of them is not needed.
3. **No "it never X, it only Y".** State what the thing does. What it does not do belongs
   in a paragraph somebody asked for, not in a label.
4. **A hint is one line, sixty characters or so.** Anything longer moves behind an info
   affordance next to the heading. The knowledge is kept; it stops shouting.
5. **Numbers, codepoints, paths and coordinates are never translated** and are always
   mono. This whole tool is measurements, and a column of digits is read far faster when
   it lines up.
6. **British spelling** — `colour`, `centre`. The engine and the pack already use it.
7. **Do not translate a tool's name.** `erase`, `cover`, `plate`, `paint` are the tool's
   identity, they key the digit shortcuts, and `GUIDA.md` has always used them as they
   are. The same goes for `ascent`, `advance` and `codepoint`: they are what the pack
   format calls them.

## Where the words live

`messages.en.ts` is the key set. `messages.it.ts` is typed against it, so a key added to
English and forgotten in Italian will not compile. `i18n.test.ts` catches what the type
system cannot: a translation that quietly drops a `{placeholder}`, a plural stem with only
one of its two halves, an empty string.

Italian terminology comes from `GUIDA.md`, deliberately. The manual has called a screen a
*schermata* and a sheet a *foglio* since the project's second week, and an app that
renamed them would leave its own documentation wrong.

## Plurals

`tn("status.deleted", n)` picks `status.deleted.one` or `status.deleted.other` and binds
`{n}`. English used to fake this with `(s)`; Italian cannot copy that, because
"1 livello(i)" is not a thing anyone writes.

Only the `.other` form has to name the count. "Aligned in the window" is the better
singular of "3 layers aligned" precisely because it drops the 1.

## Adding a string

Add the key to `messages.en.ts` in the group it belongs to, add the Italian, use `t("…")`.
Never interpolate a translated fragment into another translated string: pass a parameter
instead, so word order stays the translator's to choose.
