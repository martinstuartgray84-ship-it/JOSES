import { describe, expect, it } from "vitest";
import { describeSegment, PRESETS, segmentSchema } from "./segments";
import { fill, renderEmail, unknownPlaceholders } from "./template";

const data = { first_name: "Ana", company: "Jose's", site: "Site One", book_url: "https://book.example.com/book" };

describe("segments", () => {
  it("validates presets and rejects nonsense", () => {
    for (const p of PRESETS) expect(segmentSchema.safeParse(p.segment).success).toBe(true);
    expect(segmentSchema.safeParse({ minVisits: 5, maxVisits: 2 }).success).toBe(false);
    expect(segmentSchema.safeParse({ lastVisitDaysAgoMin: 90, lastVisitDaysAgoMax: 30 }).success).toBe(false);
    expect(segmentSchema.safeParse({ dropTable: true }).success).toBe(false);
  });

  it("describes segments in plain English", () => {
    expect(describeSegment({})).toBe("All guests");
    expect(describeSegment({ minVisits: 3, lastVisitDaysAgoMin: 45 })).toBe("Guests with 3+ visits, not seen for 45+ days");
    expect(describeSegment({ minVisits: 1, maxVisits: 1, lastVisitDaysAgoMax: 60 })).toBe(
      "Guests with exactly 1 visit, seen in the last 60 days",
    );
    expect(describeSegment({ minSpend: 30000, siteId: "00000000-0000-4000-8000-000000000000" }, () => "Site Two")).toBe(
      "Guests with £300+ spent, visited Site Two",
    );
  });
});

describe("templates", () => {
  it("fills placeholders and falls back for a missing first name", () => {
    expect(fill("Hi {{first_name}}, see you at {{ site }}", data)).toBe("Hi Ana, see you at Site One");
    expect(fill("Hi {{first_name}}", { ...data, first_name: "" })).toBe("Hi there");
    expect(fill("{{nope}}", data)).toBe("{{nope}}");
    expect(unknownPlaceholders("{{first_name}} {{nope}} {{ also }}")).toEqual(["nope", "also"]);
  });

  it("renders paragraphs, bold and links, and escapes everything else", () => {
    const e = renderEmail({
      subject: "For {{first_name}}\nline",
      body: "Hi {{first_name}},\n\n**Half price** wine: https://x.com/a.\n\n<script>alert(1)</script>",
      data: { ...data, first_name: "<b>Eve</b>" },
      unsubscribeUrl: "https://app/u/tok",
      openPixelUrl: "https://app/o/t",
      footer: "Jose's, 1 High St",
    });
    expect(e.subject).toBe("For <b>Eve</b> line");
    expect(e.html).toContain("Hi &lt;b&gt;Eve&lt;/b&gt;,");
    expect(e.html).toContain("<strong>Half price</strong>");
    expect(e.html).toContain('<a href="https://x.com/a">https://x.com/a</a>.');
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain('href="https://app/u/tok"');
    expect(e.html).toContain('src="https://app/o/t"');
    expect(e.text).toContain("Half price wine");
    expect(e.text).toContain("Unsubscribe: https://app/u/tok");
  });
});
