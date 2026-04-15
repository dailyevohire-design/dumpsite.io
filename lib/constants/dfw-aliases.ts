/**
 * Phase 3 — DFW city/alias map for geocoding resilience.
 *
 * Drivers text "ftw", "mcknney", "downtown" — this map resolves those to canonical
 * "Fort Worth, TX", "McKinney, TX", "Downtown Dallas, TX" so Google Geocoding gets a
 * clean input. Covers the DFW metro + ring cities Jesse dispatches to.
 */

export const DFW_ALIASES: Record<string, string> = {
  // Fort Worth variants
  "ft worth": "Fort Worth, TX",
  "ftw": "Fort Worth, TX",
  "ft. worth": "Fort Worth, TX",
  "fworth": "Fort Worth, TX",
  "fort worth": "Fort Worth, TX",
  // Dallas variants
  "dtown": "Downtown Dallas, TX",
  "downtown": "Downtown Dallas, TX",
  "dal": "Dallas, TX",
  "dalls": "Dallas, TX",
  "dallass": "Dallas, TX",
  "dallas": "Dallas, TX",
  // McKinney variants
  "mcknney": "McKinney, TX",
  "mckiney": "McKinney, TX",
  "mckinny": "McKinney, TX",
  "mkinney": "McKinney, TX",
  "mckinney": "McKinney, TX",
  // North/East suburbs
  "frisco": "Frisco, TX",
  "plano": "Plano, TX",
  "arlington": "Arlington, TX",
  "arlinton": "Arlington, TX",
  "irving": "Irving, TX",
  "garland": "Garland, TX",
  "mesquite": "Mesquite, TX",
  "richardson": "Richardson, TX",
  "carrollton": "Carrollton, TX",
  "lewisville": "Lewisville, TX",
  "lewisvile": "Lewisville, TX",
  "lewsiville": "Lewisville, TX",
  "denton": "Denton, TX",
  "flower mound": "Flower Mound, TX",
  "grapevine": "Grapevine, TX",
  "grapvine": "Grapevine, TX",
  "gravevine": "Grapevine, TX",
  "keller": "Keller, TX",
  "southlake": "Southlake, TX",
  "colleyville": "Colleyville, TX",
  "collyville": "Colleyville, TX",
  "euless": "Euless, TX",
  "bedford": "Bedford, TX",
  "hurst": "Hurst, TX",
  "mansfield": "Mansfield, TX",
  "grand prairie": "Grand Prairie, TX",
  "cedar hill": "Cedar Hill, TX",
  "desoto": "DeSoto, TX",
  "duncanville": "Duncanville, TX",
  "lancaster": "Lancaster, TX",
  "waxahachie": "Waxahachie, TX",
  "waxa": "Waxahachie, TX",
  "waxahatchie": "Waxahachie, TX",
  "waxahachee": "Waxahachie, TX",
  "midlothian": "Midlothian, TX",
  "midlothain": "Midlothian, TX",
  "midlothien": "Midlothian, TX",
  "weatherford": "Weatherford, TX",
  "cleburne": "Cleburne, TX",
  "burleson": "Burleson, TX",
  "crowley": "Crowley, TX",
  "benbrook": "Benbrook, TX",
  "wylie": "Wylie, TX",
  "allen": "Allen, TX",
  "prosper": "Prosper, TX",
  "celina": "Celina, TX",
  "anna": "Anna, TX",
  "princeton": "Princeton, TX",
  "forney": "Forney, TX",
  "terrell": "Terrell, TX",
  "rockwall": "Rockwall, TX",
  "rowlett": "Rowlett, TX",
  "sachse": "Sachse, TX",
  "murphy": "Murphy, TX",
  "the colony": "The Colony, TX",
  "little elm": "Little Elm, TX",
  "corinth": "Corinth, TX",
  "highland village": "Highland Village, TX",
  "coppell": "Coppell, TX",
  "farmers branch": "Farmers Branch, TX",
  "addison": "Addison, TX",
  "university park": "University Park, TX",
  "highland park": "Highland Park, TX",
  "haslet": "Haslet, TX",
  "saginaw": "Saginaw, TX",
  "lake worth": "Lake Worth, TX",
  "azle": "Azle, TX",
  "white settlement": "White Settlement, TX",
  "north richland hills": "North Richland Hills, TX",
  "nrh": "North Richland Hills, TX",
  "heb": "Hurst, TX",
  "trophy club": "Trophy Club, TX",
  "roanoke": "Roanoke, TX",
  "justin": "Justin, TX",
  "argyle": "Argyle, TX",
  "ponder": "Ponder, TX",
  "aubrey": "Aubrey, TX",
  "pilot point": "Pilot Point, TX",
  "sherman": "Sherman, TX",
  "denison": "Denison, TX",
  "dennison": "Denison, TX",
  "denisson": "Denison, TX",
  "gainesville": "Gainesville, TX",
  "decatur": "Decatur, TX",
  "mineral wells": "Mineral Wells, TX",
  "granbury": "Granbury, TX",
  "stephenville": "Stephenville, TX",
  "hillsboro": "Hillsboro, TX",
  "corsicana": "Corsicana, TX",
  "ennis": "Ennis, TX",
  "kaufman": "Kaufman, TX",
  "greenville": "Greenville, TX",
  "sulphur springs": "Sulphur Springs, TX",
  "sunnyvale": "Sunnyvale, TX",
  "heath": "Heath, TX",
  "fate": "Fate, TX",
  "royse city": "Royse City, TX",
  "lavon": "Lavon, TX",
  "nevada": "Nevada, TX",
  "lucas": "Lucas, TX",
  "fairview": "Fairview, TX",
  "lowry crossing": "Lowry Crossing, TX",
  "parker": "Parker, TX",
  "st paul": "St. Paul, TX",
}

export function resolveDFWAlias(input: string): string | null {
  const normalized = input.toLowerCase().trim()
  return DFW_ALIASES[normalized] || null
}

/**
 * Substring-contains fallback for inputs like "coming from mckinney area" or
 * "loading in fort worth today". Requires alias key ≥4 chars to avoid false
 * positives on short common words.
 */
export function fuzzyMatchDFWCity(input: string): string | null {
  const lower = input.toLowerCase()
  let bestMatch: { key: string; value: string } | null = null
  for (const [alias, full] of Object.entries(DFW_ALIASES)) {
    if (alias.length >= 4 && lower.includes(alias)) {
      // Prefer longest match (so "fort worth" beats "worth" if both present)
      if (!bestMatch || alias.length > bestMatch.key.length) {
        bestMatch = { key: alias, value: full }
      }
    }
  }
  return bestMatch?.value || null
}
