# Originals: 3-4 out-of-the-box posts every run

The catalogue (`generate.py`) makes the same shapes every round. Originals are the
opposite: each one is a fresh idea with a visual built for it, invented at run time. They
are options; the user posts the ones they like. Round 8's five set the bar:
`social/round-08/pre/` (`make.py` is the code).

## What an original is
- **One surprising, true fact** from the data: something that contradicts what players
  believe, a contrast, a change or a prediction. It is not a list of players.
- **A familiar format that makes the fact instant**: a weather app, a receipt, a dating
  profile, a "would you rather". Copy the genre, never the brand: no real app's name or
  logo, no real person's or account's style.
- **1-3 big faces**: cutouts 650-930 px tall on the 1200x1350 page.
- **One question** fantasy players have an opinion on. It ends the text, and the image sets it up.

Never a top-N table, never one of the catalogue's shapes (hot hand, value kings, budget
picks, injury watch, captain poll, team of the round), and never about basketball with no
fantasy angle.

## The run
`O=.claude/skills/euroguru-social/originals.py`. Prefix `SSL_CERT_FILE=backend/.ca-bundle.pem` on the work network.

1. `generate.py prepare` ends with a line per batch, e.g. `✦ round-09/pre: no originals yet`.
   - Make 3-4 for the run, across the batches that have none (e.g. 2 for the recap + 2 for the preview).
   - A batch with `ORIGINALS.md` keeps its originals: list them in the brief, and make new
     ones only when the user asks. New ones go in the same `make.py`, with new ids and new formats.
   - If a core post is due now, give it to the user first, in one short message.
2. `python3 $O facts social/round-09/pre` pulls the batch's data, freezes it in
   `.data.json`, and prints the stories sheet: about 40 lines, lens by lens.
   - Read it looking for surprise: equal X but different Y, then against now, the
     matchup, boom or bust, prices, hindsight, birthdays.
   - `(OUT)` / `(GTD)` marks injured players.
   - Night and recap batches add the night's lines and grade the preview's forecasts.
3. `python3 $O history`: the formats already used.
4. **Brainstorm 8+ one-liners**, each "fact → format → question", before choosing any.
   Use the ways to find ideas below. Then pick 3-4 by the rules under "Choosing".
5. Optionally, compare photos and poses before a layout: `python3 $O sheet "S. Vezenkov:OLY" "Y. Madar:HTA:2025"`.
6. **Write `social/round-09/pre/make.py`** (the skeleton is at the end). Start from the
   closest past batch's code (`history` says where it is), then change the layout, colors and data.
7. Run `python3 social/round-09/pre/make.py`. Open every PNG with Read and check it against
   the visual checklist. Fix, then re-run one post with `make.py <id>`.
8. Verify every number (see "Text and numbers"), then brief:
   - the originals table: time, title, format, image path;
   - the other ideas, so the user can say "make #6".

## Choosing 3-4
- **New formats:**
  - At least 2 must use a format `history` doesn't have.
  - None may reuse a format from the last 2 rounds.
  - A format that worked can come back after that, with a new story.
- **Different moods:** something playful (a pop-culture format), something analytical
  (how the scoring works), a decision for this round (matchup, captain, price), and a story
  (a season arc, last season, a person).
- **The moment:**
  - **preview**: decisions before the lock;
  - **game night**: tonight's story, posted right after the games or the next morning;
  - **recap**: the round's story.
  - Close loops where you can: grade the preview's forecast after the games.
- **Overlap:** if an original makes a catalogue post redundant, say which one to skip
  (Round 8: same-price made value-kings redundant).
- **Safety:**
  - never joke about an injury;
  - never feature an `(OUT)` / `(GTD)` player as a pick;
  - when a post contradicts the injury report, don't take a side;
  - no politics, no betting language;
  - nothing about a player's private life;
  - `country` in the data is the roster's listed nationality, not the national team
    (Vezenkov is listed as Greece), so never make a national-team claim from it.

## Ways to find ideas
- **Move a fantasy fact into a non-basketball format.** Matchups became a weather
  forecast; an FPT breakdown became a receipt.
- **Make a player or a stat a character**: a dating profile, a job ad, a horoscope, a
  wanted poster, a trading card.
- **Flip the usual frame**: one contrast instead of a top 5, e.g. same price but two players
  for one, or same points but different FPT.
- **Make the reader choose**: would you rather, swipe right or left, buy or sell, A or B.
- **Close a loop**: an earlier original's prediction, graded; "you swiped right, here's the date".
- **The audience's countries**: Greek, Israeli, Serbian, Lithuanian, Turkish and Spanish
  fans; derbies, local stars, Hebrew wordplay in the Hebrew version.
- **Calendar dates**: Halloween (31 Oct), Black Friday (late Nov), the Christmas and New
  Year rounds, Valentine's Day (14 Feb), April Fools' Day, a birthday this week.
- **The site's features as the hero**: the Matchups tab (forecast), the price tracker
  (a stock ticker), the Live tab, the coach model, last season's numbers.

## Idea bank: sparks, not a menu
- **Preview**:
  - a stock-market ticker (price risers and fallers);
  - a fight poster (two players at one price: tale of the tape);
  - a restaurant menu ("today's specials under 10 CR");
  - a job ad ("wanted: a 6th man");
  - a boarding pass (an away trip to the toughest defense);
  - an ECG or lab results (the steadiest floor);
  - a real-estate listing (cheap, room to grow);
  - a horoscope (this week's birthdays).
- **Game night**:
  - a forecast check (the preview's suns and storms against what happened);
  - the hero and the zero;
  - tonight's receipt;
  - a "missing" poster for a star's quiet night (playful, never an injury);
  - a scoreboard in fantasy points.
- **Recap**:
  - Wrapped (the round or the season so far);
  - a report card;
  - the perfect captain, round by round (hindsight);
  - the team nobody picked;
  - an awards night;
  - yearbook superlatives;
  - a movie poster.

## The visual
The toolkit (`import originals as o`):
- **Data and lookups:**
  - `o.data(B)`: the frozen data.
  - `o.player`, `o.form`, `o.log`, `o.hi_lo`, `o.last` (last season), `o.people` (born,
    country, height), `o.hurt`.
  - `o.fixture(D, club)`: vs, home, tip-off, the model's win chance.
  - `o.anatomy(D)`: FPT broken into its parts; `o.game_lines`: a game's lines.
  - `o.rank(D, name, key)`, `o.softness`, `o.round_parts`, `o.CLUB` (short club names).
- **Photos and the page:**
  - `o.photo(name, club, season=None)`: `season=o.LAST_SEASON` gives last season's jersey.
  - `o.place(path, height, head_x, top=|bottom=)`: the head's middle lands on `head_x`.
  - `o.page(css, body)`, `o.chrome(badge)`.
  - `o.build(POSTS, B, notes=[...], ideas=[...])`.

Recipe:
- The page is 1200x1350, rendered at 2x (2400x2700). `o.chrome()` draws the logo, badge and footer.
- **Title**: a display line, `class="disp"` (Avenir Next Condensed 800), 84-150 px.
- **Background**: a scene for the format (sky, paper, phone, split), using the brand's
  purple glow where it fits.
- **Faces**: cutouts behind the text panels. Use `drop-shadow`, never a box. Put the hero
  number on a plate or panel.

Checklist (Round 8's fixes):
- Nothing covers a head: not a pill, a label or a plate. Move the photo, not the text.
- Titles stay clear of busy backgrounds. A seam or gradient stays transparent behind them.
- Plates over a jersey need 0.9 or more opacity.
- No head is cut off at the edge (a shoulder is fine).
- Images show the day only ("Wednesday"), never a time: the audience spans three time zones.
- Fonts in headless Chrome:
  - "SF Mono" isn't there: use "Courier New" for monospace;
  - set `font-family: "Apple Color Emoji"` on emoji spans.
- Parts that add up to a total (receipts): `o.round_parts`. The headline number never moves.
- A variant class goes after the base rule, with equal specificity (Round 8's grey bubble lost to the red one).
- Fill empty space evenly, e.g. a flex column with `space-around`.
- An initials circle or a "No photo" stop means the name or club didn't match.
- An interlaced photo gets an estimated head position: check the render.
- Each PNG must be under 5 MB, X's limit; `build` warns otherwise.

## Text and numbers
- **EN and HE, 275 characters or less each** (280 is a hard error):
  - a hook that names the format;
  - 2-3 data lines with the same players and numbers as the image;
  - the question, then `#EuroLeagueFantasy #EBF`.
- **The Hebrew is written natively**, not translated word for word, with the same numbers.
  `build` warns when they differ.
- **No link in the post.** `build` puts the UTM link (`rNN-<id>`) in the reply.
- **Every number comes from the frozen snapshot**, never from memory:
  - Images compute theirs from `D`; texts quote the same values.
  - `build` warns when an EN decimal isn't in the image.
- **Superlatives**: run `o.rank(D, name, "fpt" | "value" | "per36")` before "the most" or "#1".
  If someone ranks above with fewer games, write "(5+ games)".
- **post.md's "numbers"**: every number with its source and the math.
- **post.md's "replies"**: 3-5 likely comments, each with an answer ready (one number, friendly).

## Timing (your local time)
- **Preview**:
  - the evening before the lock, 20:00-22:00, when no games are on: the prime slot, for the strongest original;
  - lock day, 10:00-13:00;
  - two evenings before the lock.
- **Game night**: ~23:00 right after the games, or 09:00-10:00 the next morning.
- **Recap**: 09:00-11:00, 12:30-13:30 or 20:00-21:30 the day after the round.
- **Spacing**:
  - at least 2 hours from any other post (catalogue or original);
  - nothing during games;
  - nothing about the preview after the lock.
- The `when` field is free text ("Mon 26 Oct, 20:00"). Add a condition when there is one
  ("if it didn't go out last night").

## The Round 8 five (`social/round-08/pre/make.py`)
| Post | Story | Format | Worth reusing |
|---|---|---|---|
| same-price | the #1 scorer costs exactly the 2 best values (18.4 CR) | would you rather | diagonal split screen, the price as the title, plates under the faces |
| round-8-forecast | the Matchups tab's biggest boosts and drops | weather forecast | sky by condition, the forecast as the temperature, why-pill |
| new-jersey | the biggest jumps from last season among club changers | then vs now | last season's photo greyed behind this season's, the new club's color |
| same-points-different-receipt | ~15 points each, 24.2 against 13.9 FPT | receipt | Courier receipts, the deciding lines highlighted, `round_parts` |
| swipe-right | the biggest boom-or-bust in the top 20 | dating profile | a phone with the profile, green and red flags as bubbles |

## make.py skeleton
```python
"""Round 9 · preview · originals.  python3 social/round-09/pre/make.py [ids] [--out DIR] [--keep-html]"""
import html
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude" / "skills" / "euroguru-social"))
import originals as o  # noqa: E402
from originals import g  # noqa: E402

B = o.batch(__file__)
D = o.data(B)  # frozen in .data.json by `originals.py facts`

TICKER_CSS = """ ... """


def ticker():
    st = o.player(D, "A. Diarra")
    body = f"""{o.chrome("Round 9 · Market")}
<h1 class="disp">...</h1>
{o.place(o.photo("A. Diarra", "VIR"), 860, 600, bottom=1290)}
<div class="plate">{st['Average_Score']:.1f}</div>"""
    return o.page(TICKER_CSS, body)


POSTS = [
    dict(id="fantasy-stock-market", format="stock ticker", title="...", when="Sun 01 Nov, 20:30", html=ticker,
         what="One line: what the image shows.",
         en="""...""", he="""...""",
         numbers=["source and math", "  - a sub-point"], replies=["**\"A likely comment\"** the answer."]),
]

if __name__ == "__main__":
    o.build(POSTS, B, notes=["Skip <catalogue post>: <original> makes the same point."],
            ideas=["fact → format → question (not made)", "..."])
```
