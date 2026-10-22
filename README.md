# Mise — POS & back office for small restaurants

A point-of-sale, inventory and costing app that runs in the browser on a laptop or tablet.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. To use it from a tablet on the same Wi-Fi, open `http://<this-computer's-IP>:5173`.

For a production build: `npm run build` (output in `dist/`, which can be hosted as static files).

## What's inside

| Page | What it does |
| --- | --- |
| **Dashboard** | Net sales, orders, average ticket, food cost %, gross profit, waste, inventory value, daily sales & busiest hours, expiring stock, low stock, dishes over target, item performance |
| **Point of Sale** | Tap-to-add menu, dine-in/takeout/delivery, notes, discounts, tax, tips, cash change, printable receipts, "x left" / 86'd badges from live stock |
| **Orders** | History by date range, payment totals, receipts, voids |
| **Inventory** | Ingredients and prep items, batches with lot #, cost and expiration, receive deliveries, make prep batches (yield N servings), counts, waste/expired log |
| **Menu** | Dishes with recipes linked to inventory, plate cost, food cost %, profit per plate, how many you can make |
| **Calculators** | Plate cost & pricing (with Q-factor, packaging, target food cost, add straight to menu), yield & true cost, recipe scaler, margin vs. markup, break-even |
| **Store Setup** | Setup checklist, store info, tax, target food cost, categories, storage locations, payment methods, backup/restore, reset |

## Tables, language and appearance

- **Tables:** the POS opens on a floor plan. Tap a table to start or continue its check; every check is saved as you go, so switching tables (or reloading) never loses an order. Occupied tables show their total, item count and how long they've been seated. Use the **Open checks** strip to hop between tables, **Move table** to move a party, and **+ Takeout / + Delivery** for orders without a table. Owners can rename tables, set seats and group them into areas with **Edit tables**.
- **English / ไทย:** switch language from the sidebar or the lock screen (remembered per device). English is the default. Starting a fresh store while in Thai sets THB, 7% VAT and Thai category names.
- **Menu tabs, choices and notes:** dishes sit in a tab (Food / Drinks / Desserts) and a category. Dishes can have choice groups — noodle type, soup, protein, size, add-ons — each with its own price change, ingredients and portion size; every item on a check can carry a kitchen note.
- **Ingredients:** recipe editors use a searchable picker, and **+ Create** adds a new ingredient in a pop-up without leaving the recipe.
- **Light / dark:** ☀ light, ◐ match the device, ☾ dark — also in the sidebar and on the lock screen.
- **Adding UI text:** put every new string in `src/i18n/<page>.ts` with both English and Thai — the build fails if a Thai translation is missing.

## Staff & PINs

- Everyone signs in on the lock screen with their own 4–6 digit PIN. The first launch on a blank store asks you to create the owner account.
- **Staff** can use the POS, Orders, Inventory and Calculators. **Owners** also get the Dashboard, Menu and Store Setup.
- Voiding an order needs an owner PIN; the receipt shows who rang it up and who approved the void.
- The screen auto-locks after 5 idle minutes (change it in Store Setup → Store & tax). Use **Lock / switch user** at the bottom of the sidebar when changing hands.
- Manage people in **Store Setup → Staff & PINs**. Deactivate staff who leave rather than deleting them.
- Demo PINs: owner `1234`, Somchai `1111`, Ploy `2222`.

PINs are stored hashed, not in plain text. They keep honest people out of owner screens; they are not strong protection against someone with full access to the device.

## How inventory works

- Each **inventory item** has a unit (lb, each, oz…), a par level and a default shelf life.
- Each delivery is a **batch** with its own cost and expiration date. Stock is always used **first-expired, first-out**.
- **Prep items** (chili, sauces, dough) have a batch recipe and a yield. Making a batch pulls the raw ingredients from stock and adds the servings as a new batch with its own use-by date.
- Each **menu item** has a recipe. Every POS sale deducts it from stock and records the real ingredient cost on the order.

## Data

Data is stored in the browser (IndexedDB) on the device you use. Export a backup regularly from **Store Setup → Data & backup**. The app starts with a demo Thai noodle shop (priced in baht, names in whichever language is selected when the demo loads); use **Start fresh** there when you're ready to enter your own store.

Card payments are recorded, not processed — run cards on your existing terminal and tap the matching payment button.
