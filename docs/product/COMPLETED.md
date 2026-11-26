# Mukammal kaam

[05-IMPLEMENTATION-PLAN.md](05-IMPLEMENTATION-PLAN.md) ke jo task **mukammal** ho jayen, un ki row wahan se **hat kar** yahan aati hai. Bugs bhi [06-BUGS-AND-RISKS.md](06-BUGS-AND-RISKS.md) se yahan aate hain. Tafseeli tabdeeliyan [CHANGELOG.md](../../CHANGELOG.md) mein hain.

## Mukammal ka matlab
Teeno sharten poori hon:
1. PR **master mein merge**.
2. **Live par deploy**.
3. Plan ki **"Mukammal jab"** shart live par dekh li gayi.

Sirf code likha ya PR khula ho to task plan mein hi rahe, halat `TAYYAR`.

## Row kaise move karein
Malik, ya malik ke kehne par agent:

1. 05 se task ki poori row **kaat kar** neeche "Plan ke tasks" ke jadwal mein lagayen. Agar 06 ka bug band hua to us ki row "Bugs" ke jadwal mein.
2. Naye khane bharein: **Mukammal tareekh**, **PR**, **Commit**, **Deploy**, **Kaise dekha**.
3. 05 mein jo task is ID par `Depend` karte hain, un ka ID na mitayen; ID dekh kar woh yahan mil jayega.
4. CHANGELOG mein `[Unreleased]` ki lines deploy ki tareekh ke heading mein le jayen.
5. Teeno files ek hi commit mein: `docs: complete <ID>`.

Ek task ka kuch hissa reh jaye to woh hissa naye ID ke saath 05 mein rahe, aur mukammal hissa yahan aaye.

## Plan ke tasks

| ID | Kaam | Mukammal tareekh | PR | Commit | Deploy | Kaise dekha |
|---|---|---|---|---|---|---|
| — | Abhi koi nahi | | | | | |

## Jaanch mukammal

| Jaanch | Nateeja | Tareekh | Kaise dekha |
|---|---|---|---|
| `stats:recompute` ke baad hundreds | **Sahi.** Scorecards mein theek 7 innings 100+ (Luqman Khan 136, Raheel 154, Ijaz Koistani 100, Wajid 100, Abdul Rehman 116, Ejaz Swati 107, Wali Amber 156); saton players par `hundreds=1`; 94 aur 69 wali innings fifties mein | 2026-11-26 | Live public API: 7 match scorecards aur 126 players (2 pages). Browser mein page dekhna baqi |

## Bugs (06 se)

| ID | Masla | Theek tareekh | PR | Kaise dekha |
|---|---|---|---|---|
| — | Abhi koi nahi | | | |

## Plan se pehle mukammal
`docs/club-owner-journey-audit.md` ke yeh hissay live hain (tafseel CHANGELOG mein):

| Audit PR | Kaam | GitHub PR | Merge |
|---|---|---|---|
| 1 | Match ke baad har raste par recompute | [#81](https://github.com/Abid-Tanoli/Cric-All/pull/81) | 2026-11-24 |
| 2 | Shirt number, role sync | [#80](https://github.com/Abid-Tanoli/Cric-All/pull/80) | 2026-11-24 |
| 3 | Owner squad mein khilari jode | [#79](https://github.com/Abid-Tanoli/Cric-All/pull/79) | 2026-11-24 |
| 4 | Owner image upload, compression | [#82](https://github.com/Abid-Tanoli/Cric-All/pull/82) | 2026-11-25 |
| 5 | Scorer chunna, toss ki jaanch | [#83](https://github.com/Abid-Tanoli/Cric-All/pull/83) | 2026-11-25 |
| 7 | Team page: live, upcoming, top performers | [#84](https://github.com/Abid-Tanoli/Cric-All/pull/84) | 2026-11-25 |
| 8 | Public club page | [#85](https://github.com/Abid-Tanoli/Cric-All/pull/85) | 2026-11-25 |

PR 85 ke review mein mile masle (B4, B5, B14) plan ke task **T0.1** mein hain.
