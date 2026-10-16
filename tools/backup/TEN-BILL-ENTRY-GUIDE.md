# MandiBook — 10 mixed bills ki exact entry guide

Plan: `MB-QA-20261015-v1`. Ye synthetic manual-entry data hai, import file nahi. Local calculator check: 16 October 2026 — 10/10 cases passed. Actual app entry, order linking, payment saving, PDF, mobile aur saved backup verification abhi user ke saath karna baaki hai.

## 0. Start karne se pehle

- Ye dummy data sirf isolated test database/emulator mein add karo. `127.0.0.1` / localhost se bhi live Firebase connect ho sakta hai. Sirf TEST/QA naam likhne se reports, balances, counters ya audit history se record exclude nahi hota.
- Agar app abhi live business database se connected hai, yahin rukna: is guide ko dekh sakte ho, lekin dummy records save mat karna. Separate test environment confirm karna pehla step hai.
- Real data delete, restore, existing opening balance change, approval policy disable ya Firebase paid features enable nahi karne.
- WhatsApp/send/share actions se test messages mat bhejna. Financial details aur private backup Git mein commit mat karna.
- Date har bill, order, farmer payment aur broker payout mein **15/10/2026** rakho. Ye fixed test date hai, aaj ki date nahi.

## 1. Master data — ye pehle banao

### 5 parties

Party Master mein type `Kisan (Farmer)`, opening balance `0`, credit limit `0`. Optional bank/address/alternate-mobile fields blank reh sakte hain. Party ko bill mein dropdown se select karo.

- QA15 FARMER A — village: QA15 VILLAGE A; is party par QA15-B01 aur QA15-B02 banenge.
- QA15 FARMER B — village: QA15 VILLAGE B; is party par QA15-B03 aur QA15-B04 banenge.
- QA15 FARMER C — village: QA15 VILLAGE C; is party par QA15-B05 aur QA15-B06 banenge.
- QA15 FARMER D — village: QA15 VILLAGE D; is party par QA15-B07 aur QA15-B08 banenge.
- QA15 FARMER E — village: QA15 VILLAGE E; is party par QA15-B09 aur QA15-B10 banenge.

Mobile field app mein required aur unique hai. Har party par apne control/permission wala alag valid number use karo; kisi aur ke random number nahi. **Sirf ye 5 numbers aapko dene hain; baaki data neeche exact diya hai.** Test environment confirm hone se pehle real personal contact details wahan bhi mat daalna.

### Products / templates

- `QA15 WHEAT` — bill series prefix `QW`, price unit `20kg`, extra deductions none.
- `QA15 MAIZE` — bill series prefix `QM`, price unit `20kg`, extra deductions none.
- Varieties: `QA STANDARD` aur `QA PREMIUM`.
- Orders ke product selector mein bhi same product names use karo. Naye test records banao; existing production template/rate mat badlo.

### Broker

`QA15 BROKER` banao, default commission `0`. Sirf B08/B10 mein bill ke commission field par `10` manually enter karna: current bill calculation mein ye **₹10 per 100 kg** hai, per bag nahi.

## 2. Har bill ka common setup

- Bill ka bhav **₹ per 20 kg** hai. Neeche @500 ka matlab ₹500/20kg, ₹500 per bag nahi.
- Supply type radio: `કંતાન લૂઝ` (stored value `લૂઝ`). Loose Supply toggle: Loose bills mein ON, Bag bills mein OFF.
- **Kasar, Kantan weight deduction, Plastic weight deduction, Utrai, Vakal moisture aur extra-template deductions sab OFF.** Bag counts bharne ke bawajood bag-weight deduction OFF rahega.
- Weighbridge moisture bhi OFF, **sirf B09 mein ON, 2%**.
- Product/order select karne ke baad saare switches dobara check karo. Existing Core Settings globally change mat karo.
- Empty bag counts hamesha `0`; unused/inactive vakal rows `0`. Unless explicitly mentioned: expenses `0`, freight `0`, broker blank, broker commission OFF/0.
- Bill number app khud generate karega. `QA15-B01` etc **Remarks** mein likho, auto bill number replace mat karo. Generated number note karna zaroori hai.
- Har bill save hone par usko dobara open karke final amount check karo. Fir neeche payment instructions follow karo.

## 3. Teen orders pehle banao

Order date `15/10/2026`, supplier/village exact party ke hisab se. Notes mein neeche reference likho; actual order number auto-generated rahega. Har row Unit `Bag`, Price Per `20kg`, Delivered So Far `0`. Baaki extra fields blank/default.

### QA15 O03 → QA15-B03

- Supplier: QA15 FARMER B; village: QA15 VILLAGE B; product: QA15 WHEAT.
- Row 1: QA STANDARD, quantity 10 Bag, rate ₹600.00 per 20kg.
- Broker: blank. Notes: QA15 O03.

### QA15 O05 → QA15-B05

- Supplier: QA15 FARMER C; village: QA15 VILLAGE C; product: QA15 WHEAT.
- Row 1: QA STANDARD, quantity 12 Bag, rate ₹500.00 per 20kg.
- Row 2: QA PREMIUM, quantity 8 Bag, rate ₹600.00 per 20kg.
- Broker: blank. Notes: QA15 O05.

### QA15 O10 → QA15-B10

- Supplier: QA15 FARMER E; village: QA15 VILLAGE E; product: QA15 MAIZE.
- Row 1: QA STANDARD, quantity 10 Bag, rate ₹500.00 per 20kg.
- Row 2: QA PREMIUM, quantity 6 Bag, rate ₹600.00 per 20kg.
- Broker: QA15 BROKER. Notes: QA15 O10.

New Bill mein corresponding saved order select karke uske saare vakals import karo. Weight/bags/deduction switches phir neeche ke bill se match karo. Order amount aur bill final freight/expense/commission ki wajah se alag ho sakte hain. Order-linked bill ko direct entry se dobara mat banao.

## 4. Exact bill entries — B01 se B10

### QA15-B01 — Unpaid

- Party: **QA15 FARMER A**; village: QA15 VILLAGE A.
- Product/template: QA15 WHEAT; mode: **Loose**; vehicle: QA15-VEH-01 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B01; order: none — Direct Bill.
- Weighbridge weight: **200 kg**.
- Loose price: **₹500.00 per 20 kg**. All filled/empty bag counts 0, unused vakals 0.
- Weighbridge moisture: OFF.
- Expense: 0; truck freight: ₹0.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 200 kg. Expected final: ₹5,000.00.**

Payment:

- Koi payment entry nahi. Zero-amount payment bhi nahi banana.

Final check: credit **₹0.00**, remaining due **₹5,000.00**, status **Unpaid**.

### QA15-B02 — Partial

- Party: **QA15 FARMER A**; village: QA15 VILLAGE A.
- Product/template: QA15 WHEAT; mode: **Loose**; vehicle: QA15-VEH-02 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B02; order: none — Direct Bill.
- Weighbridge weight: **300 kg**.
- Loose price: **₹500.00 per 20 kg**. All filled/empty bag counts 0, unused vakals 0.
- Weighbridge moisture: OFF.
- Expense: 0; truck freight: ₹0.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 300 kg. Expected final: ₹7,500.00.**

Payment:

- Save payment 1: date 15/10/2026, method Cash, amount **₹2,500.00**, deduction **₹0.00**. Remarks: QA15-B02-P1. Is save ke baad expected due **₹5,000.00**.

Final check: credit **₹2,500.00**, remaining due **₹5,000.00**, status **Partial**.

### QA15-B03 — Paid

- Party: **QA15 FARMER B**; village: QA15 VILLAGE B.
- Product/template: QA15 WHEAT; mode: **Bag**; vehicle: QA15-VEH-03 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B03; order: QA15 O03.
- Weighbridge weight: **500 kg**.
- Kantan filled bags: 10; Plastic filled bags: 0; both empty counts: 0.
- Vakal 1: QA STANDARD, **10 bags @ ₹600.00 per 20 kg**.
- Weighbridge moisture: OFF.
- Expense: 0; truck freight: ₹0.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 500 kg. Expected final: ₹15,000.00.**

Payment:

- Save payment 1: date 15/10/2026, method Cash, amount **₹15,000.00**, deduction **₹0.00**. Remarks: QA15-B03-P1. Is save ke baad expected due **₹0.00**.

Final check: credit **₹15,000.00**, remaining due **₹0.00**, status **Paid**.

### QA15-B04 — Paid

- Party: **QA15 FARMER B**; village: QA15 VILLAGE B.
- Product/template: QA15 WHEAT; mode: **Bag**; vehicle: QA15-VEH-04 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B04; order: none — Direct Bill.
- Weighbridge weight: **400 kg**.
- Kantan filled bags: 0; Plastic filled bags: 8; both empty counts: 0.
- Vakal 1: QA STANDARD, **8 bags @ ₹550.00 per 20 kg**.
- Weighbridge moisture: OFF.
- Expense: 0; truck freight: ₹0.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 400 kg. Expected final: ₹11,000.00.**

Payment:

- Save payment 1: date 15/10/2026, method Cash, amount **₹4,000.00**, deduction **₹0.00**. Remarks: QA15-B04-P1. Is save ke baad expected due **₹7,000.00**.
- Save payment 2: date 15/10/2026, method Cash, amount **₹7,000.00**, deduction **₹0.00**. Remarks: QA15-B04-P2. Is save ke baad expected due **₹0.00**.

Final check: credit **₹11,000.00**, remaining due **₹0.00**, status **Paid**.

### QA15-B05 — Partial

- Party: **QA15 FARMER C**; village: QA15 VILLAGE C.
- Product/template: QA15 WHEAT; mode: **Bag**; vehicle: QA15-VEH-05 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B05; order: QA15 O05.
- Weighbridge weight: **1000 kg**.
- Kantan filled bags: 20; Plastic filled bags: 0; both empty counts: 0.
- Vakal 1: QA STANDARD, **12 bags @ ₹500.00 per 20 kg**.
- Vakal 2: QA PREMIUM, **8 bags @ ₹600.00 per 20 kg**.
- Weighbridge moisture: OFF.
- Expense: 0; truck freight: ₹0.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 1000 kg. Expected final: ₹27,000.00.**

Payment:

- Save payment 1: date 15/10/2026, method Cash, amount **₹10,000.00**, deduction **₹500.00**, reason: `QA15 agreed test deduction`. Remarks: QA15-B05-P1. Is save ke baad expected due **₹16,500.00**.

Final check: credit **₹10,500.00**, remaining due **₹16,500.00**, status **Partial**.

### QA15-B06 — Unpaid

- Party: **QA15 FARMER C**; village: QA15 VILLAGE C.
- Product/template: QA15 WHEAT; mode: **Loose**; vehicle: QA15-VEH-06 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B06; order: none — Direct Bill.
- Weighbridge weight: **250 kg**.
- Loose price: **₹400.00 per 20 kg**. All filled/empty bag counts 0, unused vakals 0.
- Weighbridge moisture: OFF.
- Expense: QA15 Loading = ₹150.00; truck freight: ₹200.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 250 kg. Expected final: ₹5,050.00.**

Payment:

- Koi payment entry nahi. Zero-amount payment bhi nahi banana.

Final check: credit **₹0.00**, remaining due **₹5,050.00**, status **Unpaid**.

### QA15-B07 — Partial

- Party: **QA15 FARMER D**; village: QA15 VILLAGE D.
- Product/template: QA15 MAIZE; mode: **Loose**; vehicle: QA15-VEH-07 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B07; order: none — Direct Bill.
- Weighbridge weight: **200 kg**.
- Loose price: **₹525.50 per 20 kg**. All filled/empty bag counts 0, unused vakals 0.
- Weighbridge moisture: OFF.
- Expense: 0; truck freight: ₹0.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 200 kg. Expected final: ₹5,255.00.**

Payment:

- Save payment 1: date 15/10/2026, method Cash, amount **₹1,255.50**, deduction **₹0.00**. Remarks: QA15-B07-P1. Is save ke baad expected due **₹3,999.50**.

Final check: credit **₹1,255.50**, remaining due **₹3,999.50**, status **Partial**.

### QA15-B08 — Paid

- Party: **QA15 FARMER D**; village: QA15 VILLAGE D.
- Product/template: QA15 MAIZE; mode: **Bag**; vehicle: QA15-VEH-08 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B08; order: none — Direct Bill.
- Weighbridge weight: **600 kg**.
- Kantan filled bags: 12; Plastic filled bags: 0; both empty counts: 0.
- Vakal 1: QA STANDARD, **12 bags @ ₹500.00 per 20 kg**.
- Weighbridge moisture: OFF.
- Expense: 0; truck freight: ₹0.00.
- Broker: QA15 BROKER, commission ON, rate ₹10.00/100kg; calculated commission ₹60.00.
- **Expected net weight: 600 kg. Expected final: ₹14,940.00.**

Payment:

- Save payment 1: date 15/10/2026, method Cash, amount **₹14,940.00**, deduction **₹0.00**. Remarks: QA15-B08-P1. Is save ke baad expected due **₹0.00**.

Final check: credit **₹14,940.00**, remaining due **₹0.00**, status **Paid**.

### QA15-B09 — Unpaid

- Party: **QA15 FARMER E**; village: QA15 VILLAGE E.
- Product/template: QA15 MAIZE; mode: **Loose**; vehicle: QA15-VEH-09 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B09; order: none — Direct Bill.
- Weighbridge weight: **500 kg**.
- Loose price: **₹400.00 per 20 kg**. All filled/empty bag counts 0, unused vakals 0.
- Weighbridge moisture: ON, 2% — 10 kg cut.
- Expense: 0; truck freight: ₹0.00.
- Broker: blank; commission OFF/0.
- **Expected net weight: 490 kg. Expected final: ₹9,800.00.**

Payment:

- Koi payment entry nahi. Zero-amount payment bhi nahi banana.

Final check: credit **₹0.00**, remaining due **₹9,800.00**, status **Unpaid**.

### QA15-B10 — Paid

- Party: **QA15 FARMER E**; village: QA15 VILLAGE E.
- Product/template: QA15 MAIZE; mode: **Bag**; vehicle: QA15-VEH-10 (synthetic label).
- Date: 15/10/2026; Remarks: QA15-B10; order: QA15 O10.
- Weighbridge weight: **800 kg**.
- Kantan filled bags: 16; Plastic filled bags: 0; both empty counts: 0.
- Vakal 1: QA STANDARD, **10 bags @ ₹500.00 per 20 kg**.
- Vakal 2: QA PREMIUM, **6 bags @ ₹600.00 per 20 kg**.
- Weighbridge moisture: OFF.
- Expense: QA15 Loading = ₹100.00; truck freight: ₹300.00.
- Broker: QA15 BROKER, commission ON, rate ₹10.00/100kg; calculated commission ₹80.00.
- **Expected net weight: 800 kg. Expected final: ₹21,620.00.**

Payment:

- Save payment 1: date 15/10/2026, method Cash, amount **₹20,000.00**, deduction **₹1,620.00**, reason: `QA15 agreed test deduction`. Remarks: QA15-B10-P1. Is save ke baad expected due **₹0.00**.

Final check: credit **₹21,620.00**, remaining due **₹0.00**, status **Paid**.

## 5. Payment save karte waqt

- Accounts → Ledger → exact QA15 party aur generated bill number select karo. Ek hi party ke doosre unpaid bill par allocation mat hone dena.
- Approval required ho to authorized workflow se bill approve karo; policy disable nahi karni.
- B04 ke ₹4,000 aur ₹7,000 **do alag payment saves** hain.
- B05/B10 ka deduction cash payment nahi: cash + deduction se total credit banta hai. Deduction ko extra payment bana kar dobara count mat karo.
- Current code expenses minus aur truck freight plus karta hai. B06: 5,000 − 150 + 200 = 5,050. B10: 21,500 − 100 + 300 − 80 = 21,620.
- Baseline matched hone se pehle bills edit/archive/delete mat karo. Mismatch aaye to expected amount fit karne ke liye input mat badlo.

## 6. Broker payout

Accounts → Brokers → QA15 BROKER: B08 commission ₹60 + B10 commission ₹80 = **₹140**. Date 15/10/2026, amount **₹50**, remarks `QA15 BROKER PAYOUT` se ek test payout save karo. Expected paid ₹50, balance **₹90**. Ye farmer payments/credit mein include nahi hota.

## 7. Final expected totals — sirf is test dataset ke

- 10 bills, 3 orders, 5 farmer parties, 1 broker.
- 8 farmer-payment records + 1 separate broker payout.
- 3 Unpaid, 3 Partial, 4 Paid.
- Gross weighbridge weight: **4,750 kg**; net weight: **4,740 kg**.
- Bill Final Total: **₹1,22,165.00**.
- Cash payment amount: **₹74,695.50**.
- Payment deductions: **₹2,120.00**.
- Total credit (cash + deductions): **₹76,815.50**.
- Remaining due: **₹45,349.50**.

Party balances after all payments:

- QA15 FARMER A: bill final ₹12,500.00, credit ₹2,500.00, due **₹10,000.00**.
- QA15 FARMER B: bill final ₹26,000.00, credit ₹26,000.00, due **₹0.00**.
- QA15 FARMER C: bill final ₹32,050.00, credit ₹10,500.00, due **₹21,550.00**.
- QA15 FARMER D: bill final ₹20,195.00, credit ₹16,195.50, due **₹3,999.50**.
- QA15 FARMER E: bill final ₹31,420.00, credit ₹21,620.00, due **₹9,800.00**.

Reports/Dashboard/Daily Closing mein same date aur filters compare karo. Existing data ho to poore database ka total in numbers se match nahi karega; QA15 records/IDs ka subtotal match karo. Purane records ko delete karke totals match nahi karne. Page par cash-only metric ko cash+deduction credit se compare mat karna.

## 8. Print, mobile aur backup check

1. Har saved bill dobara open karo; party, product, bag/vakal details, deductions aur Final Total match karo. Order-linked bills par correct order link dekho.
2. B05, B07 aur B10 ka Print/PDF preview dekho: mixed vakals, decimals, expense/broker fields cut nahi hone chahiye. Kisi real contact ko share mat karo.
3. Desktop aur phone par same account/database aur date range se records compare karo. Stuck loader, duplicate save, missing row ya wrong total ko actual bill number ke saath note karo.
4. Entries sync ho jayein tab ALL devices par writes pause karo.
5. Admin → Settings → Backup: `Prepare recovery backup` → `Save JSON recovery file` → `Choose a saved recovery file` se wahi downloaded file verify karo. Optional password lagao to secure jagah sambhalo; mujhe password mat bhejna.
6. Downloaded file ko device par locate karke reopen/verify karo. Doosri independent protected copy rakho. Excel report full database backup nahi hai.
7. Backup mein QA15 references aur original IDs check karenge. Existing/archived records ki wajah se total bill count 10 se zyada ho sakta hai.
8. Live database mein restore ya destructive cleanup mat karo. Mobile download verification aur isolated restore drill alag checks hain; calculator pass ko complete recovery proof mat samjho.

## 9. Koi difference aaye to mujhe ye bhejna

- QA15-Bxx reference + app ka actual generated bill number.
- Input screen ka screenshot (weight, bags, bhav, toggle settings).
- Saved bill ka Final Total aur payment/deduction/due screenshot.
- Kaunsa step fail hua: save, reopen, order link, payment, PDF, mobile ya backup verify.
- Backup inspect karwana ho to local file path do; private backup Git mein mat daalna.

## Verification scope

`node tools/backup/check-entry-plan.cjs` local source ka actual calculateBillData/customRound chalata hai; expected final/net/commission values se compare karta hai. Installment arithmetic, party balances aur aggregate targets bhi assert hote hain. Ye Firebase writes, actual payment-save implementation, authentication, UI order import ya browser downloads ka end-to-end test nahi hai.

Ye baseline intentionally Kasar/Utrai/bag-weight/template deductions OFF rakhta hai. In sab configurable rules, rounding edge cases aur partial order fulfillment ko alag scenarios mein test karna baaki hai. B07 decimal payment/due test hai; current bill calculator line amounts whole rupees mein round karta hai.

