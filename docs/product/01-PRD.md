# PRD: CricAll (Product Requirements)

## 1. Ek jumle mein
CricAll Pakistan ke har qism ke idaron ko apna cricket **phone se, asaan aur international standard ki app par, muft** chalane deta hai: teams, matches, tournament, live scoring, aur har khilari ka record.

## 2. Masla
- Local cricket ka record kaghaz par hota hai aur kho jata hai.
- Maujooda scoring apps mein bohat options hain; naye logon ke liye forms mushkil hain.
- Hamari apni app bhi mushkil hai: club banane ka form 3.9 screens, match ki tayyari 4.8 screens, aur scoring mein run ka button pehli screen par nazar nahi aata (naap: [03-UI-UX.md](03-UI-UX.md) §2).
- Pakistan mein 10 saal se upar ki shrah-e-khwandgi **63%** hai; gaon mein 55%, deehi khawateen 44% ([Dawn, Economic Survey 2025-26](https://www.dawn.com/news/2007104)). GSMA ke mutabiq 2024 mein smartphone 68%, magar mobile internet istemal karne wale sirf 29% abadi ([GSMA 2025](https://www.gsma.com/about-us/regions/asia-pacific/wp-content/uploads/2025/07/Unlocking-Pakistan-digital-future-FINAL.pdf)).

## 3. Kis ke liye

| Persona | Kaun | Halat | Kamyabi |
|---|---|---|---|
| **P1 Nazim bhai** (sab se ahem) | Mohalle ke club ka malik, 35 saal | Urdu dheere parhte hain, English nahi. WhatsApp aur YouTube chalate hain. Form se ghabrate hain | Akele 2 minute mein match shuru |
| **P2 Scorer larka** | 16 saal, club ka scorer | Roman Urdu theek, dhoop mein, kamzor internet, sasta phone | Har ball 1 tap, ghalti foran wapas |
| **P3 Khilari** | 20 saal | Apna score dost ko dikhana chahta hai | WhatsApp par apna card bheje |
| **P4 Organizer** | Tournament karata hai, 8 teams | Points aur fixtures haath se banata hai | Table khud bane, sahi bane |
| **P5 Fan / ghar wale** | Sirf dekhte hain | Login nahi karenge | Link khole, score dekhe |
| **P6 Idara** | School, college, university, company, NGO | Kai teams, kai log | Apni branches aur log sambhale |
| **P7 Platform admin** | CricAll malik | Sab ki madad | Ghalat data pakre, theek kare |

**Faisla:** jab P1/P2 aur P6 ki zaroorat takraye, pehli screen P1/P2 ke liye; P6 ki cheezen "More" ke andar.

## 4. Maqsad aur paimane

Aaj ka naap `03-UI-UX.md` §2 se. Naye paimane 5 asli logon ke test se ([08-TEST-PLAN.md](08-TEST-PLAN.md) §3).

| Maqsad | Aaj | Target |
|---|---|---|
| Club banane ki fields | 16 | **2** (naam, shehar) |
| Match shuru karne ki screens | form 2.4 + setup 4.8 | **4 chhoti screens** |
| Aam ball ke taps | 2 (chunna + Submit); pad aur score ek screen par nahi | **1, sab ek screen par** |
| Wicket ke taps | 4–5 | **3** |
| P1 bina madad match shuru kare | naapa nahi | 5 mein se 4 log |
| Scoring mein offline ball zaya | poora offline nahi | **0** |
| Forms mein Urdu madad | Register aur email code par | Har MUST form ki har field aur ghalti |

## 5. Scope

### 5.1 MUST (tri-series aur pehle clubs ke liye)
| ID | Zaroorat | Kamyabi ki shart |
|---|---|---|
| R1 | **English app; forms waghera mein Urdu madad** | Har form field ke neeche chhoti Urdu line, ghalti par Urdu line. Navigation, match, scorecard, tournament, scoring: sirf English |
| R2 | Asaan Home: "Start a match" sab se bara | Login shuda malik ko pehli screen par |
| R3 | Club 2 fields mein | Baqi cheezen baad mein, marzi se |
| R4 | Match 4 qadam mein: teams → overs → khilari → toss | Har screen par ek sawal |
| R5 | Nayi scoring screen | Run 1 tap; sab buttons bina scroll 360×640 par |
| R6 | Undo hamesha nazar aaye | 1 tap, 1 ball peeche |
| R7 | Offline scoring | Internet ke baghair match chale, baad mein sync |
| R8 | Ek ball ek hi dafa | Retry par dohri ball nahi |
| R9 | Sahi NRR aur points | [06-BUGS](06-BUGS-AND-RISKS.md) B1–B3 ke test pass |
| R10 | Apni marzi ke overs (1–50) aur ball type | Owner UI se |
| R11 | Data na mite | B4, B5 ke test pass |
| R12 | WhatsApp par match bhejna | Link par sahi naam, score, tasveer |
| R13 | Madad: har mushkil screen par "?" aur WhatsApp help | Number: FAISLA |

### 5.2 SHOULD
| ID | Zaroorat |
|---|---|
| R14 | Bahar ki team ke khilaf match: chhupi guest Team, public aur rankings se bahar |
| R15 | 11 se kam khilari (2–11) aur "khilari baad mein" |
| R16 | Phone number se login (SMS/WhatsApp code) |
| R17 | Forms mein awaaz: mushkil qadam par chhota Urdu audio |
| R18 | Scorer ko link/QR se bulana |
| R19 | Khilari ka share card, badges |
| R20 | Follow aur match ki ittila |
| R21 | Tournament mein team ki darkhwast |
| R22 | Bachon (under-18) ki privacy. **Schools se pehle lazmi** |
| R23 | Idara ki gallery aur khabrein |

### 5.3 LATER
Sponsor report, Pro plan, online payment, native app.

### 5.4 NAHI
Fantasy/betting, player auction, video hosting, licensed international feed, club accounting, **database badalna** (alag faisla, is plan mein nahi).

## 6. User stories (ahem)
- **S1 (P1):** Main app kholta hoon, "Start a match" dabata hoon, form mein Urdu madad parh kar do teams ke naam likhta hoon, overs chunta hoon aur scoring shuru ho jati hai.
- **S2 (P2):** Batsman ne chauka mara, main `4` dabata hoon, bas. Ghalti ho to `Undo`.
- **S3 (P2):** Internet chala gaya, main score karta raha; upar likha hai "12 balls to send"; net aaya, khud chali gayin.
- **S4 (P4):** Barish se match nahi hua, dono ko 1 point khud mil gaya.
- **S5 (P5):** WhatsApp link khola, bina login score dekha.
- **S6 (P6):** University ke 3 departments ki teams, ek tournament, ek page.

## 7. Maujooda hissay
| Hissa | Halat |
|---|---|
| Login, 12 roles, invitations, audit | LIVE; phone verification band hai |
| Squad, image upload, scorer chunna | LIVE |
| Scoring, undo, super over, manual scorecard | LIVE; sirf online, UI mushkil |
| Tournament hub, points, awards, sponsors | LIVE; NRR ghalat |
| Team page, club page | LIVE |
| OBS overlay, PWA install, AI commentary, community | LIVE / flag |

Ab tak ke **saton mukammal matches manual** scorecard se aaye; koi match poora live score nahi hua. Tri-series pehla asli imtihan hai.

## 8. Faisle jo malik ko karne hain
| # | Sawal | Meri salah |
|---|---|---|
| F1 | Tri-series: tareekh, overs, ball, single/double round, final? | Jald batayein; tarteeb isi par |
| F2 | Zubaan | **TAY:** app English, Urdu sirf forms waghera mein |
| F3 | Phone login: SMS ya WhatsApp code (kharcha) | Pehle email/Google rakhein, phir WhatsApp code |
| F4 | Madad ka WhatsApp number | Alag number, zaati nahi |
| F5 | Bahar ki team | **TAY (26 Nov):** chhupi guest Team (`isGuest`, `isPublic:false`), owner merge abhi nahi |
| F6 | Barish par points | 1–1 (tournament setting se) |
| F7 | 11 se kam khilari ki ijazat | Haan, 2–11 |
| F8 | "Event" aur "Incubation" chhupana | Haan, owner UI se |
