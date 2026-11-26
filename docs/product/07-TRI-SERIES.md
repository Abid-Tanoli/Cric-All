# Tri-series plan

CricAll ka **pehla asli live-scored muqabla**. Maqsad: koi ball na khoye, table sahi ho, scorer pareshan na ho.

## 1. Malik se chahiye (F1)
Tareekh · 3 teams · overs · tape ya hard · har team doosri se 1 ya 2 match · final · barish ke points · har match ka scorer (naam + phone) · ground par net kaisa.

## 2. Banana kaise hai
- **Tournament → type `league`**, 3 teams. `Event` wala "Tri-Series" **na** chunein: use tournament hub nahi milta.
- Auto fixtures **ek round** banate hain (3 matches). Doosra round aur final haath se.
- Final: stage `final`, date baad mein bhi ho sakti hai.
- Points: jeet 2, barabar 1, barish 1 (jab tak F6 na badle).

## 3. Kya lazmi, kya nahi (waqt ke hisaab se)

| Baqi waqt | Lazmi kaam (05 ke number) |
|---|---|
| **3 din** | T0.1–T0.4, T1.1 (NRR/points), backup, 1 practice match. Offline nahi → kaghaz ka scorer saath |
| **1 hafta** | Upar wala + T1.2 (`clientBallId`), T1.3 (overs), T3.3 ka chhota roop: pad upar, ek tap |
| **3 hafte+** | Upar wala + poori scoring screen, offline, match banane ka naya flow (form mein Urdu madad), practice series |

Overs 6/8/10/20/50 ke ilawa hon (jaise 12, 15, 16) to T1.3 **lazmi**.

## 4. Practice series (dress rehearsal)
Test server ya local par, live data se alag:

- [ ] 3 teams × 11 khilari, tournament, 3 fixtures + final
- [ ] Match 1: doosri team pehle batting kare (B1)
- [ ] Match 2: chase jaldi mukammal (B2); haath se NRR milayen
- [ ] Match 3: abandoned (B3)
- [ ] Wide, no ball + run, bye, leg bye, free hit, run out, aakhri ball wicket
- [ ] Undo: run, wicket, over ki aakhri ball, innings ki aakhri ball
- [ ] Scorer beech mein badle
- [ ] Phone band karke chalaya; app dobara kholi
- [ ] Net 10 minute band *(offline ban jaye to)*
- [ ] Tie → super over
- [ ] Points table, stats, player of match, OBS overlay, WhatsApp link
- [ ] Kaghaz ka scorecard = app ka scorecard

Ek bhi ball ka farq ho to series us par na chalayen.

## 5. Match ke din

**Pehle (2 ghante):** backup · **deploy band** · teams/XI dale · scorer login aur screen khuli · phone charge + power bank · net check · kaghaz scoresheet.

**Dauran:** ek hi device se score · har over ke baad umpire/kaghaz se total milayen · masla ho to kaghaz jari, app baad mein · Reset kabhi nahi, malik se poochein.

**Baad (30 minute):** result · player of match · table dekhein · WhatsApp par link · masle likhein (kab, kis ball par, screenshot).

## 6. Agar app ruk jaye

| Masla | Kya karein |
|---|---|
| Net nahi (offline se pehle) | Kaghaz; net aane par wahin se, ya manual scorecard |
| Ghalat ball | Undo; purani ho to malik/admin edit |
| Score nahi badal raha | Page band karke kholen; **dobara ball dalne se pehle total dekhein** (dohri ball ka khatra) |
| Server band | Kaghaz, baad mein manual scorecard |
| Table ghalat | Haath ka hisaab publish na karein; masla likhein, recompute dry-run |

## 7. Series ke baad
Har scorer se 5 sawal (kya mushkil laga, kahan ruke, kya chhupana hai…) · bugs `06` mein · phir agla marhala.
