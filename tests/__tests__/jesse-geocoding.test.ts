/**
 * Phase 12C — DFW aliases (Phase 3) tests.
 */
import { describe, it, expect } from "vitest"
import { resolveDFWAlias, fuzzyMatchDFWCity, DFW_ALIASES } from "@/lib/constants/dfw-aliases"

describe("resolveDFWAlias() — exact lookups", () => {
  it.each([
    ["ft worth", "Fort Worth, TX"],
    ["FTW", "Fort Worth, TX"],
    ["fortworth", null], // no key "fortworth" — only "fort worth"
    ["mcknney", "McKinney, TX"],
    ["mckiney", "McKinney, TX"],
    ["mckinny", "McKinney, TX"],
    ["frisco", "Frisco, TX"],
    ["plano", "Plano, TX"],
    ["waxa", "Waxahachie, TX"],
    ["waxahatchie", "Waxahachie, TX"],
    ["dalls", "Dallas, TX"],
    ["NRH", "North Richland Hills, TX"],
    ["heb", "Hurst, TX"],
    ["st paul", "St. Paul, TX"],
  ])("'%s' → %s", (input, expected) => {
    expect(resolveDFWAlias(input)).toBe(expected)
  })

  it("case-insensitive + whitespace-trimmed", () => {
    expect(resolveDFWAlias("  FT WORTH  ")).toBe("Fort Worth, TX")
  })

  it("unknown city → null (not crash)", () => {
    expect(resolveDFWAlias("atlantis")).toBeNull()
  })
})

describe("fuzzyMatchDFWCity() — substring contains", () => {
  it("matches within a phrase", () => {
    expect(fuzzyMatchDFWCity("coming from mckinney area")).toBe("McKinney, TX")
  })

  it("prefers longest match", () => {
    // Both "arlington" and "fort worth" — longest wins
    expect(fuzzyMatchDFWCity("fort worth or arlington today")).toBe("Fort Worth, TX")
  })

  it("ignores aliases shorter than 4 chars", () => {
    // "dal" is 3 chars — should be ignored by fuzzy match
    expect(fuzzyMatchDFWCity("pedal to the metal")).toBeNull()
  })

  it("no match → null", () => {
    expect(fuzzyMatchDFWCity("somewhere weird")).toBeNull()
  })

  it("case-insensitive", () => {
    expect(fuzzyMatchDFWCity("PICKING UP IN MCKINNEY")).toBe("McKinney, TX")
  })
})

describe("Alias map integrity", () => {
  it("all values end with ', TX'", () => {
    for (const [, v] of Object.entries(DFW_ALIASES)) {
      expect(v).toMatch(/, TX$/)
    }
  })

  it("map has 100+ entries", () => {
    expect(Object.keys(DFW_ALIASES).length).toBeGreaterThanOrEqual(100)
  })
})
