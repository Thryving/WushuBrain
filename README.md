# Brain Optimisation & Wushu — website + Admin Centre

## What's in here
| File | What it is |
|---|---|
| `index.html` | Public bilingual landing page + registration form |
| `admin.html` | Admin Centre (open at `yoursite/admin`) |
| `thank-you.html` | Shown after someone registers |
| `schedule.html` | Full 3-day schedule page (linked from the main page) |
| `netlify/functions/` | Small backend: live pricing, discount codes, admin login, saving registrations, invoices & receipts |
| `netlify/lib/docs.js` | Builds the invoice / receipt PDFs and emails them |
| `netlify/assets/` | Logo, SGQR and Chinese font used inside the PDFs |
| `img/` | Poster, trainer photo, SGQR |

## Deploy (one-time, ~15 minutes)
The Admin Centre and discount codes need Netlify's backend functions, which **don't run with drag-and-drop deploys**. Use GitHub instead (free, all in the browser):

1. Create a free account at github.com → **New repository** → name it e.g. `xjtt-brain-wushu` → Private → Create.
2. On the new repo page click **uploading an existing file**, drag in **everything inside this folder** (keep the `netlify` and `img` folders), then **Commit changes**.
3. In Netlify: **Add new site → Import an existing project → GitHub** → pick the repo → leave build settings as they are → **Deploy**.
4. Netlify → **Site configuration → Environment variables → Add a variable**, add these three:
   - `ADMIN_USER` = your admin username
   - `ADMIN_PASSWORD` = your admin password
   - `ADMIN_SECRET` = any long random text (e.g. mash the keyboard for 40 characters)
5. **Deploys → Trigger deploy → Deploy site** (so the variables take effect).
6. **Forms**: Site configuration → Forms → make sure form detection is **enabled**, then redeploy once more.
7. **Email alerts**: Forms → Form notifications → Add notification → Email notification → form `registration` → your email.
8. **Custom domain (later)**: Domain management → Add a domain → follow the DNS steps shown.

To change the website later, edit the file on GitHub (pencil icon) → Commit. Netlify redeploys automatically.

## Email for invoices & receipts (Zoho)
The admin centre emails invoices/receipts from your Zoho mailbox.
1. Zoho Mail → profile picture → **My Account → Security → App Passwords** → **Generate New Password** (name it "Netlify"). Copy the password shown.
2. Netlify → Site configuration → Environment variables → add (Production value):
   - `SMTP_USER` = jasmine@thryving.sg
   - `SMTP_PASS` = the Zoho app password
3. Deploys → Trigger deploy.
(Optional: `SMTP_HOST` defaults to `smtppro.zoho.com`; only change it if Zoho tells you a different server.)
Every email also BCCs your own mailbox, so you keep a copy.

## Is Netlify Forms free?
Yes. On Netlify's current free plan (credit-based), form submissions are free and unlimited. The backend functions and storage used by the Admin Centre also run on the free plan; a small course site like this uses very few of the 300 monthly free credits. (Older “legacy” free accounts were limited to 100 submissions per month — check Netlify → Usage if your account is older.)

## Where registrations go
- **Netlify → Forms → registration**: every submission, with the payment screenshot. Email alert per submission (step 7).
- **Admin Centre → Registrations**: one row per registration with every participant, certificate choices, discount code, amount, flags (wrong amount / reused code), status (pending → paid / cancelled) and your notes.
- **CSV export** (per participant or per registration) — opens in Excel or Google Sheets (File → Import).

## Admin Centre
- **Discount codes**: create ranges (NSA1–NSA10) or single codes, set % off standard price, max uses, expiry, notes; edit, deactivate, reset or delete any time.
- **Pricing & settings**: prices, early-bird end date, certification fee, seat capacity — changes are live instantly, no redeploy.
- **Break-even table** and progress towards S$9,500.
- **Invoices & receipts**: per registration — *Make invoice / Make receipt* (opens the PDF), *Send* (emails it to the registrant), and *Invoice sent / Receipt sent* tick boxes. Numbers (BW26-0001, RC-BW26-0001…) and the invoice due date are set under Pricing & settings.

## Before going live
- Scan the PayNow QR on the page with your banking app and check it shows **THRYVING PTE. LTD.** and the right amount.
- Delete any test registrations in the Admin Centre.
