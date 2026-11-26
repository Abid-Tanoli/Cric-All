# Test plan

## 1. Har PR

```powershell
npm test
```
```powershell
npm --prefix Backend run test:smoke
```
```powershell
npm --prefix Frontend/User run build
```
```powershell
npm --prefix Frontend/Admin run build
```

- Teen backend suites (`community`, `crossTenant`, `noSqlInjection`) ko chalta server chahiye: server throwaway Mongo `cric-all-e2e` par, port 5000, `.env` ka live URI **kabhi nahi**.
- Scoring/points badle: `npm --prefix Backend run test:e2e` (guarded local DB).
- Naya bug fix = pehle fail hone wala test. Update endpoints ka test **validator ke raste** ho, sirf controller nahi (B4 isi liye chhupa raha).

## 2. Feature ke imtihan

| Kaam | Imtihan |
|---|---|
| NRR | Doosri team pehle batting; jaldi chase; all out; `12.4` overs; abandoned; super over; 3 matches haath se mile |
| `clientBallId` | Wohi request 2 dafa = 1 ball; 2 ek saath = 1; purana client bina id = chale; undo 2 dafa = 1 ball wapas |
| Offline | 20 balls net band + reload + net = theek 20; beech ki ball 4xx = ruke, baqi mehfooz; token khatam; phone restart; doosra device rukta hai |
| Overs | 1, 7, 15, 50; quota; purane formats wohi |
| Khilari 2–11 | 6 khilari par 5 wicket = all out |
| Guest team | `isGuest` team aur khilari: rankings, `/teams`, search, club page, share, sitemap mein nahi; match page par naam hai, link nahi |
| Zubaan | Har MUST form field par Urdu madad; public pages, scorecard aur scoring pad mein Urdu nahi; Urdu line par `lang="ur" dir="rtl"` |
| Share | Crawler ko sahi title; private = aam card |
| Privacy | Bina login `/players`, `/teams`, `/organizations/*`, search, share: koi chhupi field nahi |

## 3. Asli logon ke saath (sab se zaroori)

**Kaun:** 5 log, kam az kam 3 jo Urdu dheere parhte hon, 1 scorer, 1 malik. Developer ya dost-developer nahi.
**Kahan:** un ka apna phone, dhoop mein, ek dafa kamzor net.
**Qaida:** hum **chup** rahen. Madad maangein to likhein, phir karein.

| # | Kaam | Kamyab |
|---|---|---|
| 1 | Register karo (form ki Urdu madad ke saath) | 2 min |
| 2 | Club banao | 1 min |
| 3 | Doosri team ke saath 5 over ka match shuru karo | 2 min |
| 4 | Yeh 12 balls likho (kaghaz par di hui, wide aur wicket samet) | 12/12 sahi |
| 5 | Ghalat ball wapas karo | 5 s |
| 6 | Net band karke 6 balls | 6/6 |
| 7 | Match WhatsApp par bhejo | 20 s |

Har kaam par likhein: hua / madad se / nahi hua · waqt · kahan ruka · kya bola.
**Paas:** 5 mein se 4 log, kaam 3 aur 4 bina madad. Fail ho to design badlein, log nahi.

Naam, photo, awaaz ijazat ke baghair record nahi; bachon ke saath sirf walid/ustad ki ijazat se.

## 4. Accessibility
`@axe-core` nayi screens par · 360×640, 375×812, 412×915 · system font 130% · TalkBack se scoring ke buttons ka naam sunai de · rang ke baghair bhi OUT pehchana jaye.

## 5. T0.1 deploy ke baad (live par, 10 minute)
1. Admin se kisi test idaray ka record dekhein (logo, description, social, privacy). Organization Settings mein "Show the club page publicly" **band** karein, phir **chalu** karein. Record wapas dekhein: **kuch nahi badla** siwaye public/private ke.
2. Admin mein usi idaray ko deactivate, phir activate karein: logo, description aur type wohi rahen.
3. Logout karke (ya private window mein) yeh 4 khaali kar ke dekhein; jawab mein `contact`, `members`, `owner`, `createdBy`, `verificationNote`, `typeDetails.registrationNumber` **nahi** hone chahiyen:
   - `https://api.cricall.online/api/organizations/roots`
   - `https://api.cricall.online/api/organizations/tree`
   - `https://api.cricall.online/api/organizations/<id>/children`
   - `https://api.cricall.online/api/organizations/<id>/chain`
4. Kisi team page par club ka naam **link** ho aur sahi `/club/<slug>` khole. Club private karein: team page aur Teams list par link gayab, `/club/<slug>` 404.
5. Admin app (login) mein Organizations aur team form ka organization picker pehle jaisa chale.

## 6. Release se pehle
- [ ] CI teeno hare
- [ ] Backup abhi ka
- [ ] 06 ka koi surkh bug khula nahi
- [ ] Match ka din nahi
- [ ] Wapsi (revert) ka tareeqa PR mein likha
