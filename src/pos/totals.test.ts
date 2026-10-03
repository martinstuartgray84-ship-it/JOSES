import { describe, expect, it } from "vitest";
import { allocate, computeBill, discountAmount, formatMoney, splitBySeat, splitEqually, type BillLine } from "./totals";

const food = (unitPrice: number, extra: Partial<BillLine> = {}): BillLine => ({ unitPrice, quantity: 1, vatRate: 20, ...extra });

describe("allocate", () => {
  it("always adds up and hands odd pennies to the largest remainders", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1001, [3, 1])).toEqual([751, 250]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
  });

  it("shares equally when every weight is zero", () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
  });

  it("adds up for many random cases", () => {
    for (let i = 0; i < 500; i++) {
      const total = Math.floor(Math.random() * 100_000);
      const weights = Array.from({ length: 1 + Math.floor(Math.random() * 8) }, () => Math.floor(Math.random() * 5000));
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
});

describe("computeBill", () => {
  it("extracts VAT from inclusive prices", () => {
    const bill = computeBill({ lines: [food(1200), food(600, { quantity: 2 })] });
    expect(bill.itemsTotal).toBe(2400);
    expect(bill.total).toBe(2400);
    expect(bill.vat).toEqual([{ rate: 20, gross: 2400, net: 2000, vat: 400 }]);
  });

  it("includes modifiers, excludes voids, and reports comps separately", () => {
    const bill = computeBill({
      lines: [
        food(1800, { modifiersTotal: 250 }),
        food(900, { voided: true }),
        food(700, { comped: true }),
      ],
    });
    expect(bill.itemsTotal).toBe(2050);
    expect(bill.compsTotal).toBe(700);
    expect(bill.total).toBe(2050);
  });

  it("applies a discount before service charge, and service charge is VAT-free", () => {
    const bill = computeBill({
      lines: [food(5000)],
      discount: { kind: "percent", value: 10 },
      serviceChargePct: 12.5,
    });
    expect(bill.discount).toBe(500);
    expect(bill.goodsTotal).toBe(4500);
    expect(bill.serviceCharge).toBe(563); // 12.5% of 45.00, rounded
    expect(bill.total).toBe(5063);
    expect(bill.vatTotal).toBe(750); // VAT on 45.00 only
  });

  it("spreads a discount across VAT bands", () => {
    const bill = computeBill({
      lines: [food(3000), food(1000, { vatRate: 0 })],
      discount: { kind: "amount", value: 1000 },
    });
    expect(bill.vat).toEqual([
      { rate: 20, gross: 2250, net: 1875, vat: 375 },
      { rate: 0, gross: 750, net: 750, vat: 0 },
    ]);
  });

  it("caps discounts at the bill", () => {
    expect(discountAmount(1000, { kind: "amount", value: 5000 })).toBe(1000);
    expect(discountAmount(1000, { kind: "percent", value: 150 })).toBe(1000);
    expect(discountAmount(1000, null)).toBe(0);
  });

  it("tracks payments, tips and change due", () => {
    const bill = computeBill({
      lines: [food(2550)],
      payments: [{ amount: 1000, tip: 200 }, { amount: 2000 }],
    });
    expect(bill.paid).toBe(3000);
    expect(bill.tips).toBe(200);
    expect(bill.balance).toBe(-450);
  });
});

describe("splits", () => {
  it("splits equally with odd pennies first", () => {
    expect(splitEqually(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(() => splitEqually(100, 0)).toThrow();
  });

  it("splits by seat with shared items shared equally, adding up to the total", () => {
    const lines = [
      food(2000, { seat: 1 }),
      food(1000, { seat: 2 }),
      food(600), // shared bread
      food(400, { seat: 2, comped: true }),
    ];
    const parts = splitBySeat({ lines, seats: [1, 2], serviceChargePct: 10 });
    const total = computeBill({ lines, serviceChargePct: 10 }).total;
    expect(parts.reduce((n, p) => n + p.amount, 0)).toBe(total);
    // Seat 1: 20 + 3 shared = 23 of 36 goods.
    expect(parts).toEqual([
      { seat: 1, amount: 2530 },
      { seat: 2, amount: 1430 },
    ]);
  });

  it("gives a seat with nothing on it a share of the shared items only", () => {
    const parts = splitBySeat({ lines: [food(900)], seats: [1, 2, 3] });
    expect(parts.map((p) => p.amount)).toEqual([300, 300, 300]);
  });
});

it("formats money", () => {
  expect(formatMoney(123456)).toBe("£1234.56");
  expect(formatMoney(5)).toBe("£0.05");
  expect(formatMoney(-250)).toBe("-£2.50");
});
