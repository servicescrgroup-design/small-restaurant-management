import type { DeliverySettings, MenuItem, Settings } from './types';

/**
 * Delivery-app pricing (Grab, LINE MAN, ShopeeFood, Robinhood). The app keeps a GP (commission,
 * usually 30%) of the delivery price and charges 7% VAT on that GP, so a 30% GP really costs
 * 30% × 1.07 = 32.1% and the shop keeps 67.9%.
 *
 * The recommended delivery price earns the same profit as selling the dish in the shop, after the
 * app's cut and the packaging: (in-store price + packaging) ÷ (1 − cut), rounded up.
 */
export const DEFAULT_DELIVERY: DeliverySettings = { gpPct: 30, vatPct: 7, packaging: 0, roundTo: 5 };

export const deliveryOf = (s: Settings): DeliverySettings => ({ ...DEFAULT_DELIVERY, ...s.delivery });

/** Share of the delivery price the app takes (GP + VAT on the GP). */
export const appCut = (d: DeliverySettings) => (d.gpPct / 100) * (1 + d.vatPct / 100);

export const roundUpTo = (n: number, step: number) => (step > 0 ? Math.ceil(n / step - 1e-9) * step : Math.ceil(n * 100 - 1e-9) / 100);

/** The next whole price at or above n that ends in this digit: 315.17 with 9 → 319, 320 with 9 → 329. */
export const roundUpToEnding = (n: number, digit: number) => {
  const whole = Math.ceil(n - 1e-9);
  return whole + ((digit - (whole % 10)) + 10) % 10;
};

/** Apply the shop's rounding choice to a suggested price. */
export const roundPrice = (n: number, d: DeliverySettings) =>
  d.endsIn != null && d.endsIn >= 0 && d.endsIn <= 9 ? roundUpToEnding(n, d.endsIn) : roundUpTo(n, d.roundTo);

export const packagingOf = (m: MenuItem, d: DeliverySettings) => m.packagingCost ?? d.packaging;

export interface ChannelNumbers { price: number; foodCost: number; packaging: number; appFee: number; received: number; profit: number; margin: number }

/** Money in and out for one plate, in the shop and through a delivery app. */
export function priceDish(price: number, foodCost: number, m: MenuItem, d: DeliverySettings) {
  const cut = appCut(d);
  const packaging = packagingOf(m, d);
  const recommended = cut < 1 ? roundPrice((price + packaging) / (1 - cut), d) : 0;
  const channel = (p: number, pack: number, fee: number): ChannelNumbers => {
    const received = p - fee;
    const profit = received - foodCost - pack;
    return { price: p, foodCost, packaging: pack, appFee: fee, received, profit, margin: p > 0 ? profit / p : 0 };
  };
  const inStore = channel(price, 0, 0);
  const deliveryPrice = m.deliveryPrice;
  const delivery = deliveryPrice ? channel(deliveryPrice, packaging, deliveryPrice * cut) : null;
  const atRecommended = channel(recommended, packaging, recommended * cut);
  return { cut, packaging, recommended, inStore, delivery, atRecommended };
}
