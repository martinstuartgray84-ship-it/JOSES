import { describe, expect, it } from "vitest";
import {
  guessCategoryDefaults,
  parseAllergens,
  parseCourse,
  parseDelimited,
  parseMenuImport,
  parseModifiers,
  parseMoney,
} from "./import";

describe("parseDelimited", () => {
  it("handles quotes, embedded commas, doubled quotes and newlines", () => {
    const rows = parseDelimited('a,b,c\n"x, y","say ""hi""","line1\nline2"\n\n1,2,3\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["1", "2", "3"],
    ]);
  });

  it("detects tab-separated paste from a spreadsheet", () => {
    expect(parseDelimited("name\tprice\nSoup, of the day\t6")).toEqual([
      ["name", "price"],
      ["Soup, of the day", "6"],
    ]);
  });
});

describe("field parsers", () => {
  it("parses money in the ways people write it", () => {
    expect(parseMoney("£12.50")).toBe(1250);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney(" 9 ")).toBe(900);
    expect(parseMoney("1,250.00")).toBe(125000);
    expect(parseMoney("+1.5")).toBe(150);
    expect(parseMoney("-2")).toBe(-200);
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("free")).toBeNull();
  });

  it("parses courses by name or number", () => {
    expect(parseCourse("Mains")).toBe(2);
    expect(parseCourse("starter")).toBe(1);
    expect(parseCourse("Drinks")).toBe(0);
    expect(parseCourse("3")).toBe(3);
    expect(parseCourse("")).toBeNull();
    expect(parseCourse("brunch")).toBeNull();
  });

  it("maps common allergen words onto the UK 14", () => {
    expect(parseAllergens("Dairy; wheat, Tree nuts / egg")).toEqual({
      allergens: ["eggs", "gluten", "milk", "nuts"],
      unknown: [],
    });
    expect(parseAllergens("garlic, none").unknown).toEqual(["garlic"]);
  });

  it("parses modifier groups with required, max and prices", () => {
    const { groups, errors } = parseModifiers(
      "Temperature*: Rare | Medium | Well done; Extras (max 2): Bacon +1.50 | Cheese +£1 | Egg; Size: Small -1 | Large",
    );
    expect(errors).toEqual([]);
    expect(groups).toEqual([
      {
        name: "Temperature",
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: "Rare", priceDelta: 0 },
          { name: "Medium", priceDelta: 0 },
          { name: "Well done", priceDelta: 0 },
        ],
      },
      {
        name: "Extras",
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: "Bacon", priceDelta: 150 },
          { name: "Cheese", priceDelta: 100 },
          { name: "Egg", priceDelta: 0 },
        ],
      },
      {
        name: "Size",
        minSelect: 0,
        maxSelect: 1,
        options: [
          { name: "Small", priceDelta: -100 },
          { name: "Large", priceDelta: 0 },
        ],
      },
    ]);
    expect(parseModifiers("Broken").errors).toHaveLength(1);
  });

  it("guesses sensible category defaults", () => {
    expect(guessCategoryDefaults("Red Wine")).toEqual({ course: 0, station: "bar" });
    expect(guessCategoryDefaults("Cocktails")).toEqual({ course: 0, station: "bar" });
    expect(guessCategoryDefaults("Small Plates")).toEqual({ course: 1, station: "kitchen" });
    expect(guessCategoryDefaults("Puddings")).toEqual({ course: 3, station: "kitchen" });
    expect(guessCategoryDefaults("From the grill")).toEqual({ course: 2, station: "kitchen" });
  });
});

describe("parseMenuImport", () => {
  const csv = [
    "Category,Name,Price,Description,Course,Station,Prep,Allergens,Cost,Modifiers,Colour",
    'Mains,Ribeye,£28,"28-day aged, chips",mains,grill,14,milk,9.80,"Temperature*: Rare | Medium | Well"',
    "Mains,Burger,15.5,,,,,\"gluten, milk, egg\",,",
    "Drinks,House red,7,,drinks,bar,1,sulphites,,",
    "Mains,,9,,,,,,,",
    "Mains,Fish,lots,,,,,,,",
    "Mains,Ribeye,30,,,,,,,",
    "Desserts,Tart,8,,,,,garlic,,",
  ].join("\n");

  it("imports good rows and reports each bad row with a reason", () => {
    const r = parseMenuImport(csv);
    expect(r.ignoredColumns).toEqual(["Colour"]);
    expect(r.items.map((i) => i.name)).toEqual(["Ribeye", "Burger", "House red"]);
    expect(r.items[0]).toMatchObject({
      row: 2,
      category: "Mains",
      price: 2800,
      description: "28-day aged, chips",
      course: 2,
      station: "grill",
      prepMinutes: 14,
      allergens: ["milk"],
      cost: 980,
      modifiers: [{ name: "Temperature", minSelect: 1 }],
    });
    expect(r.items[1]).toMatchObject({ price: 1550, course: null, station: null, allergens: ["eggs", "gluten", "milk"] });
    expect(r.problems).toEqual([
      { row: 5, message: "name is empty" },
      { row: 6, message: 'price "lots" isn\'t a price' },
      { row: 7, message: '"Ribeye" appears twice in Mains' },
      { row: 8, message: "unknown allergen: garlic" },
    ]);
  });

  it("refuses a file without the required columns", () => {
    const r = parseMenuImport("dish,cost\nSoup,2");
    expect(r.items).toEqual([]);
    expect(r.problems.map((p) => p.message)).toEqual(['Missing a "category" column', 'Missing a "price" column']);
  });
});
