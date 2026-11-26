# CricAll: product documents

Tareekh: 25 Nov 2026 · Code ki buniyad: `origin/master` `1708a5b` (PR 85)

Yeh folder CricAll ka **kya banana hai, kyun, kaise aur kis tarteeb se** batata hai. Is mein database badalne ka kaam shamil **nahi**; sab kuch maujooda backend par hai.

| # | File | Kis ke liye | Kya hai |
|---|---|---|---|
| 1 | [01-PRD.md](01-PRD.md) | Sab | Product kya hai, kis ke liye, kaunsi cheezen banengi, kamyabi ka paimana |
| 2 | [02-TRD.md](02-TRD.md) | Developer / AI agent | Har feature ka technical tareeqa, files, API, qaide |
| 3 | [03-UI-UX.md](03-UI-UX.md) | Designer / developer | Hamari screens ka naap, masle, naya asaan design, wireframes |
| 4 | [04-COMPETITOR-RESEARCH.md](04-COMPETITOR-RESEARCH.md) | Sab | Doosri cricket sites kaise chalti hain, hum kya lein |
| 5 | [05-IMPLEMENTATION-PLAN.md](05-IMPLEMENTATION-PLAN.md) | Developer / AI agent | Har kaam ka number, tarteeb, files, "mukammal" ki shart, taiyar prompt |
| 6 | [06-BUGS-AND-RISKS.md](06-BUGS-AND-RISKS.md) | Sab | Mile hue tamam bugs aur khatre, saboot ke saath |
| 7 | [07-TRI-SERIES.md](07-TRI-SERIES.md) | Aap + scorer | Tri-series se pehle, dauran aur baad ka plan |
| 8 | [08-TEST-PLAN.md](08-TEST-PLAN.md) | Tester | Code tests aur asli logon ke saath test |
| 9 | [09-URDU-COPY.md](09-URDU-COPY.md) | Developer / translator | English lafz, aur forms ke liye Urdu madad |
| 10 | [COMPLETED.md](COMPLETED.md) | Sab | Mukammal tasks aur band bugs (plan se hat kar yahan aate hain) |
| — | [CHANGELOG.md](../../CHANGELOG.md) | Sab | Har merge shuda tabdeeli, tareekh ke hisaab se (repo ki root mein) |

## Pehle kya parhein
- **Aap:** 01, 03, phir 05 ka pehla jadwal.
- **AI agent (opencode, freebuff, Claude):** 05 se apna ek task, us mein diye hue hissay 02/03 se, aur 06 ka mutalliqa bug. Ek waqt mein **ek task, ek branch, ek folder**.

## Chaar usool jo kabhi na tootein
1. **Poori app international standard, English mein. Urdu sirf forms waghera mein madad ke liye** (malik ka faisla, 25 Nov 2026). Sadgi design se aaye: kam lafz, tasveer, bare button.
2. **Kam parha likha shakhs bina madad match score kar sake.** Jo screen is imtihan mein fail ho, woh mukammal nahi.
3. **Data kabhi chupke se na mite.** Update sirf bheji hui cheez badle.
4. **Push, merge, deploy aur live data** par har qadam malik ki ijazat se.

## Halat ke nishan
`NAYA` shuru nahi · `TAYYAR` code likha, merge nahi · `MERGED` master mein, deploy baqi · `FAISLA` malik ka jawab chahiye
Deploy aur jaanch ke baad task **COMPLETED.md** mein chala jata hai.
