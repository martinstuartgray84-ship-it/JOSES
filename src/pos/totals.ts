// Bill maths. All amounts are integer pence. UK menu prices include VAT, so VAT
// is extracted from the price rather than added on. A discretionary service
// charge is outside the scope of VAT and is added after any discount.

export interface BillLine {
  id?: string;
  unitPrice: number;
  modifiersTotal?: number;
  quantity: number;
  vatRate: number;
  comped?: boolean;
  voided?: boolean;
  seat?: number | null;
}

export interface Discount {
  kind: "percent" | "amount";
  value: number;
}

export interface Payment {
  amount: number;
  tip?: number;
}

export interface VatBand {
  rate: number;
  gross: number;
  net: number;
  vat: number;
}

export interface BillTotals {
  /** Sum of chargeable lines before discount. */
  itemsTotal: number;
  /** Value given away as comps (not charged). */
  compsTotal: number;
  discount: number;
  /** Items after discount: what VAT is calculated on. */
  goodsTotal: number;
  serviceCharge: number;
  /** What the guest owes, before tips. */
  total: number;
  vat: VatBand[];
  vatTotal: number;
  paid: number;
  tips: number;
  /** Still to pay; negative means change is due. */
  balance: number;
}

export const lineGross = (l: BillLine) => (l.unitPrice + (l.modifiersTotal ?? 0)) * l.quantity;

const chargeable = (l: BillLine) => !l.voided && !l.comped;

/**
 * Split `total` into integer parts proportional to `weights`, using the largest
 * remainder so the parts always add up exactly. Zero weights get zero, unless
 * every weight is zero, in which case the total is shared equally.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (!Number.isInteger(total)) throw new Error("allocate needs an integer total");
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum === 0 ? weights.map(() => 1) : weights;
  const wSum = sum === 0 ? weights.length : sum;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = w.map((x) => (abs * x) / wSum);
  const parts = exact.map(Math.floor);
  let left = abs - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left--;
  }
  return parts.map((p) => p * sign);
}

export function discountAmount(itemsTotal: number, discount?: Discount | null): number {
  if (!discount || discount.value <= 0) return 0;
  if (discount.kind === "percent") return Math.round((itemsTotal * Math.min(discount.value, 100)) / 100);
  return Math.min(discount.value, itemsTotal);
}

export function computeBill(input: {
  lines: BillLine[];
  discount?: Discount | null;
  serviceChargePct?: number;
  payments?: Payment[];
}): BillTotals {
  const lines = input.lines.filter((l) => !l.voided);
  const charged = lines.filter(chargeable);
  const itemsTotal = charged.reduce((n, l) => n + lineGross(l), 0);
  const compsTotal = lines.filter((l) => l.comped).reduce((n, l) => n + lineGross(l), 0);
  const discount = discountAmount(itemsTotal, input.discount);
  const goodsTotal = itemsTotal - discount;
  const serviceCharge = Math.round((goodsTotal * (input.serviceChargePct ?? 0)) / 100);
  const total = goodsTotal + serviceCharge;

  // Spread the discount across VAT bands in proportion to their value.
  const byRate = new Map<number, number>();
  for (const l of charged) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + lineGross(l));
  const rates = [...byRate.keys()].sort((a, b) => b - a);
  const bandDiscounts = allocate(discount, rates.map((r) => byRate.get(r)!));
  const vat: VatBand[] = rates.map((rate, i) => {
    const gross = byRate.get(rate)! - bandDiscounts[i]!;
    const vatPart = Math.round((gross * rate) / (100 + rate));
    return { rate, gross, net: gross - vatPart, vat: vatPart };
  });

  const paid = (input.payments ?? []).reduce((n, p) => n + p.amount, 0);
  const tips = (input.payments ?? []).reduce((n, p) => n + (p.tip ?? 0), 0);
  return {
    itemsTotal,
    compsTotal,
    discount,
    goodsTotal,
    serviceCharge,
    total,
    vat,
    vatTotal: vat.reduce((n, b) => n + b.vat, 0),
    paid,
    tips,
    balance: total - paid,
  };
}

/** Equal split of what's left to pay; the first shares absorb any odd pennies. */
export function splitEqually(amount: number, ways: number): number[] {
  if (!Number.isInteger(ways) || ways < 1) throw new Error("Split needs at least one way");
  return allocate(amount, Array(ways).fill(1));
}

/**
 * Split the bill by seat. Items on a seat go to that seat; shared items (no seat)
 * are shared equally by every seat. Discount and service charge follow each
 * seat's share of the goods. The parts always add up to the bill total.
 */
export function splitBySeat(input: {
  lines: BillLine[];
  seats: number[];
  discount?: Discount | null;
  serviceChargePct?: number;
}): { seat: number; amount: number }[] {
  const seats = [...new Set(input.seats)].sort((a, b) => a - b);
  if (seats.length === 0) throw new Error("No seats to split between");
  const bill = computeBill(input);
  const own = new Map(seats.map((s) => [s, 0]));
  let shared = 0;
  for (const l of input.lines.filter(chargeable)) {
    if (l.seat != null && own.has(l.seat)) own.set(l.seat, own.get(l.seat)! + lineGross(l));
    else shared += lineGross(l);
  }
  const sharedParts = allocate(shared, seats.map(() => 1));
  const goodsWeights = seats.map((s, i) => own.get(s)! + sharedParts[i]!);
  const amounts = allocate(bill.total, goodsWeights);
  return seats.map((seat, i) => ({ seat, amount: amounts[i]! }));
}

export const formatMoney = (pence: number) => {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};
