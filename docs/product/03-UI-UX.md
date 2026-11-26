# UI/UX: asaan CricAll

Maqsad: **international standard ki app jo kam parha likha shakhs bhi bina madad chala sake.**

**Zubaan ka faisla:** app English. Urdu sirf forms waghera mein madad ke liye. Baqi sadgi tasveer, rang, kam lafz aur bare buttons se aaye.

## 1. Kaise naapa
- Public screens: live `cricall.online`, 375×812 phone size, 25 Nov 2026.
- Owner aur scoring screens: local app (branch `feat/public-club-page` + uncommitted 0.1 fixes), throwaway database, wohi size. 12–12 khilariyon ki do teams, "6 Overs" match.
- Naap DOM se: screens = page ki lambai ÷ 812; chhota text = 12px se kam; chhota button = 44px se kam unchai.
- **Had:** asli users ke saath test abhi nahi hua. Undo, innings break aur super over ki screens nahi naapin. Browser pane chhupa tha, is liye animations par raye nahi di.

## 2. Aaj ki halat (naap)

| Screen | Naap | Masla |
|---|---|---|
| Club banana | **3.9 screens, 16 fields** | Sirf naam lazmi hai. Type dobara poochhta hai jab ke register par chuna ja chuka |
| Owner dashboard | **9 tabs**, 3 qataron mein | Kaam ki cheez (match) 5wan tab; upar "New organization" sab se bara |
| Settings | 5.1 screens, 20 fields | Sab ek saath |
| Members | 23 buttons, 26 chhote targets | Roles ki zubaan mushkil |
| Naya match | 2.4 screens, 7 cheezen | AI commentary aur Event bhi poochhta hai |
| Match card | 7 buttons ek barabar | Start Scoring, OBS link, Scorer, Setup XI, Edit, Call off, Deletion |
| Setup XI | **4.8 screens, 46 buttons, 14 fields** | 22 taps khilari + Captain, VC, WK, 12th Man, Super Sub |
| Setup do jagah | "Setup XI" aur "Match Setup Wizard" | Ek hi kaam do tareeqe se |
| Wizard | "Step 2 of 4" se khulta hai | Step 1 pehle ho chuka; user ko pata nahi |
| **Scoring** | Run buttons **839px** par, phone 812px | Pehli screen par nahi. Scroll ke baad pad dikhta hai to **score aur batsman upar chhup jate hain** |
| **Scoring** | Run chuno, phir **Submit** | **2 taps**, do jagah (run tap par score nahi badla, Submit par badla) |
| Scoring upar | OBS link, Report issue, AI commentary, note | Pehli screen par kaam ka hissa nahi |
| Wicket | 9 tareeqe ek saath + dropdown + Confirm | Nayab tareeqe (Timed out) aam ke barabar |
| Menu | "End innings" ke saath "Reset match" | Khatarnak buttons pass pass |
| Match page | 2 theme buttons; mukammal match par upar sirf ek team ka score dikha | Jeetne wali team ka score upar nahi |
| Teams page | 12 category + org type + search + location | 8 teams ke liye |
| Series page | Pehle khali "live provider" block | "No live series found" |
| Register | Login/Register/Guest + 6 cards | Achha: Urdu labels maujood |

**Poore code mein** (`Frontend/User/src` + `Frontend/Shared`, JSX):

| Cheez | Tadaad | Kyun masla |
|---|---|---|
| Text 11px ya chhota | **1,089** jagah | Dhoop aur kamzor nazar mein nahi parha jata |
| `uppercase` | 1,267 | BARE HAROOF parhna mushkil |
| chaure `tracking-*` | 877 | Lafz toot kar dikhte hain |
| Naranji `#ff6b35` par safed text | **2.84:1** | Aam text ke liye 4.5:1 chahiye (WCAG AA) |

**Login ki rukawat:** phone verification band hai (`Backend/.env.example`), is liye naya malik **email** ke baghair aage nahi barh sakta. P1 ke paas aksar email yaad nahi hota.

## 3. Design ke usool

| # | Usool | Buniyad |
|---|---|---|
| U1 | Ek screen, ek sawal, ek bara button | [NN/g](https://www.nngroup.com/articles/writing-for-lower-literacy-users/): ek column, seedhi tarteeb |
| U2 | Zaroori cheez bina scroll | NN/g: scroll se kam parhe log jagah kho dete hain |
| U3 | Chhote, aam lafz; 6 lafz tak | NN/g: aasan likhne se kamyabi 46% → 82% (2005, ek site) |
| U4 | Tasveer + lafz + rang, kabhi akela nahi | [Text-free UI, Medhi 2007](https://www.microsoft.com/en-us/research/?p=160568): tasveer aur awaaz ko tarjeeh mili |
| U5 | Jahan ho sake likhwana nahi, chunwana | [Medhi 2011](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf): sirf text wale interface pehli dafa ke users nahi chala sake |
| U6 | Awaaz aur insaan ki madad | Medhi 2011: insani operator se darustagi bohat barhi (sehat ke data mein) |
| U7 | Baad mein bhi ho sakta hai | Lazmi sirf woh jis ke baghair match na chale |
| U8 | Ghalti ka dar nahi: hamesha Undo | CricHeroes aur CricÓ dono Undo dete hain |
| U9 | Na samajh aane wali cheez chhupao | OBS, AI, Super Sub, Event → "More" mein |
| U10 | Net na ho to bhi kaam | CricÓ aur Play-Cricket Scorer offline chalte hain |

Medhi ke papers ka poora matn nahi parha ja saka; yeh unke khulase se hai.

## 4. Naap ke qaide (design tokens)

| Cheez | Qaida |
|---|---|
| Screen | 360×640 par bhi poori; buniyadi naap 375×812 |
| Aam text | 16px, kam se kam 14px. **12px se chhota mana** |
| Score | 40px+ bold |
| Button | unchai **56px**, scoring pad 64px, aapas mein 8px |
| Target | kam se kam 48×48 ([Google/Apple 48/44](https://smashingmagazine.com/2024/07/getting-bottom-minimum-wcag-conformant-interactive-element-size/)) |
| Contrast | Text 4.5:1. Naranji button `#c2410c` par safed = **5.18:1**, ya `#ff6b35` par kala `#0a0e14` = **6.82:1** |
| Rang | Hara `#15803d` (5.02:1) = haan/live theek; Laal `#b91c1c` (6.47:1) = wicket/khatra; Naranji = asal button |
| Haroof | App: Inter (maujooda). Urdu madad: Noto Naskh Arabic 15px, `line-height` 1.8. Uppercase aur chaura tracking mana |
| Hindse | 0–9 |
| Urdu | Sirf form field ke neeche, ghalti aur tasdeeq mein; us line par `lang="ur" dir="rtl"`. Page LTR rahe |
| Motion | Chalta text mana (NN/g) |
| Theme | Sirf ek button, Settings mein. Dhoop ke liye default light |

## 5. Navigation

**Neeche 4 bare buttons** (icon + English lafz), Cricinfo ki tarah neeche chipke hue:

```
 [ 🏠 Home ]   [ 🏏 Matches ]   [ 🏆 Tournaments ]   [ 👥 My club ]
```

(Emoji sirf khake ke liye; asal app mein ek hi style ke SVG icons.)

- Login nahi: "My club" → "Join".
- Scorer: "Matches" mein pehle us ke match.
- Rankings, Players, Community, News, Videos, International → "More".
- Owner ke 9 tabs → 3 hissay:

| Naya | Andar |
|---|---|
| **Matches** | Matches, Competitions |
| **Teams** | Teams, players |
| **More** | People (Members + Invitations), Club details (Settings), My reports, OBS link, Public page. *Events chhupa* |

## 6. Ahem flows aur wireframes

### 6.1 Form field ka namoona (Urdu yahan)
```
┌──────────────────────┐
│ Club name            │  16px, English
│ [ e.g. Young Star  ] │  56px
│   اپنے کلب کا نام لکھیں │  15px, Urdu madad
└──────────────────────┘
Ghalti:
│ ✕ Enter a club name  │  laal
│       کلب کا نام لکھیں │
```

### 6.2 Malik ka Home (sirf English)
```
┌──────────────────────┐
│ Young Star         ? │
│ ┌──────────────────┐ │
│ │  🏏 Start a match │ │  bara, naranji
│ └──────────────────┘ │
│ ┌────────┐┌────────┐ │
│ │👥 Teams ││🏆 Tourn.│ │
│ └────────┘└────────┘ │
│ Today                │
│ Lions  v  Tigers     │
│ [  Continue scoring ]│
│ ──────────────────── │
│ 🏠    🏏    🏆    👥 │
└──────────────────────┘
```

### 6.3 Club banana: 1 screen, 2 cheezen
```
Club name  [______________]
            کلب کا نام
City       [ Karachi    ▾ ]
            شہر چنیں
[       Create club       ]
Logo, address and phone: later
```
Pehli team khud bane (maujooda `ensureDefaultTeam`).

### 6.4 Match shuru karna: 4 qadam (har field ke neeche Urdu madad)
```
1/4 Teams            2/4 Overs           3/4 Players        4/4 Toss
┌────────────┐       ┌────────────┐      ┌────────────┐     ┌────────────┐
│ My team    │       │ 5   6   8  │      │ Lions 11 ✓ │     │ Who won    │
│ [Lions  ▾] │       │ 10  12  15 │      │ [Last XI ] │     │ the toss?  │
│ Opponent   │       │ 16  20  ✎  │      │ Tigers 0   │     │[Lions][Tig]│
│ [Tigers ▾] │       │ Ball       │      │ [Add names]│     │ Chose to   │
│ + New team │       │[Tape][Hard]│      │ [Later]    │     │[Bat][Bowl] │
│ [ Next → ] │       │ [ Next → ] │      │ [ Next → ] │     │ [ Start ]  │
└────────────┘       └────────────┘      └────────────┘     └────────────┘
```
- "Last XI" ek tap; naye match mein khud chuni hui.
- Captain, VC, WK, 12th Man, Super Sub: "More options" mein, lazmi nahi (WK sirf stumping ke waqt poochein).
- Khilari se pehle match shuru ho sakta hai; jis ka naam nahi woh "Player 1". *(TRD §4.4)*
- Openers aur bowler scoring screen ke upar naam par tap karke.

### 6.5 Scoring screen (sab se ahem, sirf English)
Sab kuch **360×640 mein bina scroll**:
```
┌──────────────────────┐
│ ← Lions  ☁ 3 to send ⋮│ 48   net ki halat + more
│  87/3    12.4 ov     │ 64   bara score
│ Target 142 · need 55 │ 24
│ ▶Ali 34   Umar 12    │ 48   tap = badlo
│ 🔴 Bilal 2-0-18-1    │ 40
│ This over: 1 4 • W 2 │ 32
├──────────────────────┤
│ [ 0 ][ 1 ][ 2 ][ 3 ] │ 64
│ [ 4 ][ 6 ][Wide][No b]│ 64
│ [Bye][Leg b][  OUT  ]│ 64   OUT laal
│ [      ↩  Undo      ]│ 56   hamesha
└──────────────────────┘  = 504 + fasle
```
Qaide:
1. `0 1 2 3 4 6` = **ek tap, ball darj.** Submit nahi.
2. 4 second tak neeche patti: "Ali: FOUR · Undo".
3. `Wide / No ball / Bye / Leg bye` → chhoti sheet "Runs with it?" `0 1 2 3 4`, ek tap. No ball mein bat/bye ka chhota chunao.
4. 5 run ya khaas surat → `⋮`.
5. Over mukammal → agla bowler: aakhri over wala chhupa, quota wale neeche, 1 tap.
6. Strike khud badle (maujooda engine); naam par tap se haath se bhi.
7. Vibration + halki awaaz har ball par (band ho sakti hai).
8. Screen na soye (Wake Lock jahan ho).
9. AI commentary, note, OBS, issue report, graphs, shot direction → `⋮`.

### 6.6 OUT: 3 taps
```
How out?                     New batter
[🏏 Bowled][🤲 Caught]        [Sami] [Zain]
[🏃 Run out][🦵 LBW]          [Omar] [+ New]
[🧤 Stumped][ More ▾ ]
```
Caught/run out mein fielder "Skip" bhi ho sakta hai. Run out mein "Who is out?" aur run poochein.

### 6.7 Khatarnak kaam
- "End innings" → sadharan tasdeeq, Urdu madad ke saath.
- **Reset innings / Reset match** → `⋮` → "Repair match" → team ka naam likhwa kar, sirf malik; scorer ko nazar na aaye.
- "Call off" → "Match called off (rain)".

### 6.8 Fan ka match page (sirf English)
1. Dono teams ka score **hamesha upar**, jeetne wali numayan.
2. Tabs sirf 3: **Scorecard · Commentary · Info** (Graphs/Partnerships "More").
3. Bara hara **WhatsApp** share button.
4. Result ka ek saaf jumla.

### 6.9 Lists
Teams/Players/Series: ek search + zyada se zyada 1 filter ("City"). Category/type filter tab dikhe jab 2 se zyada qismein hon. Khali hissa na dikhe.

## 7. Zubaan ke qaide
- **English:** navigation, buttons, headings, match, scoring, scorecard, tournament, profiles, share, notifications.
- **Urdu madad (chhoti line):** form fields, tasdeeq, ghalti, net ki halat, help.
- English bhi asaan: "Start a match", na ke "Match Setup Wizard". Lafz [09-URDU-COPY.md](09-URDU-COPY.md) se.
- Naam jaise likhe gaye waise rahen.
- Ghalti ka message: **kya hua + ab kya karein**. "Validation failed" kabhi nahi.

## 8. Madad
- `?` → 3 tasveeron wala tareeqa, Urdu line ke saath.
- Forms mein `🔊`: 10–15 second ki record ki hui Urdu awaaz (R17, baad mein).
- "Ask on WhatsApp" (number FAISLA F4).
- Pehle match se pehle **Practice**: naqli 1 over, record mein nahi jata.

## 9. International standard ki checklist (har screen)
- [ ] 360×640 par asal button bina scroll
- [ ] Ek asal button, baqi halke
- [ ] 14px se chhota text nahi, uppercase nahi
- [ ] Target 48px+, contrast 4.5:1 (WCAG 2.2 AA)
- [ ] Ek hi icon set, ek hi spacing (4/8px), light aur dark dono
- [ ] 375, 768, 1280 chaurai par theek
- [ ] Form ho to har field par Urdu madad; form na ho to Urdu nahi
- [ ] Keyboard aur screen reader se chalta hai
- [ ] Net band karke dekha
- [ ] Khali, loading, ghalti teeno halatein
- [ ] Kisi ghair developer ne bina samjhaye chalaya
