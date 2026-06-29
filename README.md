# MandiBook — Agricultural Purchase Billing System

A professional web-based billing system for agricultural commodity purchases.

## Project Structure

```
MandiBook/
├── assets/
│   └── logo.jpg                  # Company logo
│
├── css/
│   ├── main.css                  # Global styles (renamed from html.css)
│   ├── dashboard.css             # Dashboard & ledger styles
│   ├── print.css                 # Bill print styles
│   ├── print-ledger.css          # Ledger print styles
│   └── settings.css              # Settings page styles
│
├── js/
│   ├── core/
│   │   ├── firebase-init.js      # Firebase initialization
│   │   └── utils.js              # Shared utilities & bill HTML generator
│   │
│   └── features/
│       ├── bill-form.js          # Bill creation & edit logic
│       ├── bill-list.js          # Bill list, search, export
│       ├── bill-view.js          # Bill detail view & PDF download
│       ├── dashboard.js          # Analytics dashboard
│       ├── ledger.js             # Customer ledger & payments
│       └── settings.js           # Core settings management
│
├── config/
│   ├── firebase.json             # Firebase hosting config
│   ├── firestore.rules           # Firestore security rules
│   ├── firestore_indexes.json    # Firestore indexes
│   └── robots.txt                # Search engine rules
│
├── index.html                    # Main page (bill creation + bill list)
├── final.html                    # Bill view (internal)
├── download.html                 # Bill download (public link)
├── dashboard.html                # Business dashboard
├── ledger.html                   # Customer ledger
├── core_settings.html            # Deduction settings
├── 404.html                      # Error page
└── README.md                     # This file
```

## Tech Stack
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Database**: Firebase Firestore
- **Hosting**: Firebase Hosting
- **PDF**: jsPDF + html2canvas
- **Excel**: SheetJS (XLSX)
- **Alerts**: SweetAlert2

## Firebase Project
- Project ID: `ganesh-agri-new`
- Hosting: `ganesh-agri-new.web.app`

## Deployment
```bash
firebase deploy
```
