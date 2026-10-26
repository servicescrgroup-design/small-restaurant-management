import type { AppState, ItemKind, Purchase, PurchaseType } from './types';
import { receiveStock } from './inventory';
import { uid } from './utils';

/**
 * What a shop spends money on. Stock types add what was bought to Inventory (a new batch per line);
 * the rest are running costs and investments, recorded for the money side only.
 */
export const PURCHASE_TYPES: { id: PurchaseType; icon: string; stock?: { kind: ItemKind; category: RegExp } }[] = [
  { id: 'ingredients', icon: '🥬', stock: { kind: 'raw', category: /ingredient|produce|meat|veg|วัตถุดิบ|เนื้อ|ผัก/i } },
  { id: 'prepacked', icon: '🍱', stock: { kind: 'prep', category: /ready|packed|prepack|prep|สำเร็จ|พร้อม|ของเตรียม/i } },
  { id: 'drinks', icon: '🥤', stock: { kind: 'raw', category: /drink|beverage|เครื่องดื่ม/i } },
  { id: 'packaging', icon: '📦', stock: { kind: 'raw', category: /pack|disposable|supplies|บรรจุ|สิ้นเปลือง/i } },
  { id: 'supplies', icon: '🧽' },
  { id: 'equipment', icon: '🍳' },
  { id: 'investment', icon: '🏗️' },
  { id: 'repairs', icon: '🔧' },
  { id: 'rent', icon: '🏠' },
  { id: 'utilities', icon: '💡' },
  { id: 'wages', icon: '👥' },
  { id: 'marketing', icon: '📣' },
  { id: 'fees', icon: '🧾' },
  { id: 'other', icon: '➕' },
];

export const typeInfo = (id: PurchaseType) => PURCHASE_TYPES.find((p) => p.id === id) ?? PURCHASE_TYPES[PURCHASE_TYPES.length - 1];
export const isStockType = (id: PurchaseType) => !!typeInfo(id).stock;

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Save a purchase. For stock types, each line finds its inventory item by name (or creates it),
 * receives the stock as a batch, and — for prepacked food — links the dish that sells it (the one
 * chosen, a new dish, or else a same-named dish with no recipe), so selling the dish takes one from stock.
 * A line with menuItemId '' was set to "not on the menu".
 */
export function savePurchase(d: AppState, p: Purchase, newItemCategory: string) {
  const info = typeInfo(p.type);
  if (info.stock) {
    for (const line of p.lines) {
      const qty = line.qty ?? 0;
      if (!line.description.trim() || qty <= 0) continue;
      let item = (line.itemId && d.items.find((i) => i.id === line.itemId)) || d.items.find((i) => norm(i.name) === norm(line.description));
      if (!item) {
        const category = d.settings.inventoryCategories.find((c) => info.stock!.category.test(c)) ?? newItemCategory;
        if (!d.settings.inventoryCategories.includes(category)) d.settings.inventoryCategories.push(category);
        item = {
          id: uid(), name: line.description.trim(), kind: info.stock.kind, unit: line.unit?.trim() || 'pcs', category,
          location: d.settings.storageLocations[0] ?? '', parLevel: 0, shelfLifeDays: 0, defaultCost: line.amount / qty,
          ...(info.stock.kind === 'prep' ? { yieldQty: 1 } : {}),
        };
        d.items.push(item);
      }
      line.itemId = item.id;
      line.unit = item.unit;
      receiveStock(d, { itemId: item.id, qty, unitCost: line.amount / qty, receivedAt: p.date, expiresAt: line.expiresAt || undefined, note: p.supplier ? `${p.supplier}` : undefined });
      if (p.type === 'prepacked') {
        const sells = [{ itemId: item.id, qty: 1 }];
        const chosen = line.menuItemId && d.menu.find((m) => m.id === line.menuItemId);
        if (chosen) chosen.recipe = sells;
        else if (line.newDish) {
          const dish = {
            id: uid(), name: item.name, tab: d.settings.categoryTabs?.[line.newDish.category] ?? d.settings.menuTabs[0],
            category: line.newDish.category, price: line.newDish.price, active: true, recipe: sells,
          };
          if (!d.settings.menuCategories.includes(dish.category)) d.settings.menuCategories.push(dish.category);
          d.menu.push(dish);
          line.menuItemId = dish.id;
        } else if (line.menuItemId === undefined) {
          const dish = dishToLink(d, item.name);
          if (dish) { dish.recipe = sells; line.menuItemId = dish.id; }
        }
        delete line.newDish;
        if (!line.menuItemId) delete line.menuItemId;
      }
    }
  }
  p.total = Math.round(p.lines.reduce((a, l) => a + (l.amount || 0), 0) * 100) / 100;
  d.purchases = [...(d.purchases ?? []), p];
}

/** Dishes that would be linked to this prepacked item name (same name, no recipe yet). */
export const dishToLink = (s: AppState, name: string) =>
  s.menu.find((m) => !m.recipe.length && name.trim() && (norm(m.name) === norm(name) || (m.nameEn && norm(m.nameEn) === norm(name))));
