#!/usr/bin/env python3
"""
FIX SARAH BUGS — Two surgical fixes:
1. ACCESS QUESTION: Dump truck is STANDARD. Only ask about 18-wheelers.
2. PRICING FLOW: When customer gives specific date → dual quote immediately.

Run: python3 fix_sarah_bugs.py
"""
import re
import sys

PATH = "lib/services/customer-brain.service.ts"

try:
    with open(PATH, "r") as f:
        code = f.read()
except FileNotFoundError:
    print(f"ERROR: {PATH} not found. Run from ~/dumpsite-io/")
    sys.exit(1)

original = code
fixes = 0

# ═══════════════════════════════════════════════════════════
# FIX 1: ACCESS QUESTION — every single instance
# ═══════════════════════════════════════════════════════════

# Fix 1a: The main access question instruction in COLLECTING
old = 'instruction = "Ask one simple question: can bigger trucks like 18 wheelers get to their property, or should we stick with regular dump trucks. Keep it short, dont explain truck types or sizes"'
new = 'instruction = "Ask if an 18-wheeler can access their property or if we should use standard dump trucks. Standard dump trucks, triaxles, and quad axles can get pretty much anywhere. 18-wheelers need a wider road and room to turn around. Just ask real quick can an 18-wheeler get in or should we stick with regular dump trucks"'
if old in code:
    code = code.replace(old, new)
    fixes += 1
    print("  ✓ Fixed main access question instruction")

# Fix 1b: All "ask if their property has access for dump trucks and 18 wheelers, or just dump trucks"
# These appear after dimension calculations and yard collection
old_pattern = "Now ask if their property has access for dump trucks and 18 wheelers, or just dump trucks"
new_pattern = "Now ask real quick, can an 18-wheeler get to their property or should we use standard dump trucks"
count = code.count(old_pattern)
if count > 0:
    code = code.replace(old_pattern, new_pattern)
    fixes += count
    print(f"  ✓ Fixed {count} post-calculation access questions")

# Fix 1c: The NEW customer instruction "ask if big trucks can get to their property"
old = '"ask if an 18-wheeler can access their property or just standard dump trucks"'
new = '"ask if an 18-wheeler can access their property or just standard dump trucks"'
if old in code:
    # Already correct from our earlier fix, but let's check for the original version too
    pass

# Fix 1d: In the access_type handling section where yes/no triggers
# "They have room for big trucks" → fix language
old = '"They have room for big trucks. Now ask about their timeline'
new = '"Got it, 18-wheelers can get in. Now ask about their timeline'
if old in code:
    code = code.replace(old, new)
    fixes += 1
    print("  ✓ Fixed 'room for big trucks' instruction")

# Fix 1e: "Got it, dump trucks only" → already correct but let's make it clearer
old = '"Got it, dump trucks only. Now ask about their timeline'
new = '"Got it, standard dump trucks only, no 18-wheelers. Now ask about their timeline'
if old in code:
    code = code.replace(old, new)
    fixes += 1
    print("  ✓ Fixed 'dump trucks only' instruction")

# Fix 1f: Update the SARAH_SYSTEM prompt to educate Sonnet about truck types
old_system_section = """WHAT YOU KNOW ABOUT DIRT:
- Fill Dirt: clean, general purpose."""
new_system_section = """TRUCK ACCESS — CRITICAL:
- A standard dump truck (tandem, triaxle, quad axle, super dump) can get ANYWHERE a regular vehicle can go. These are your standard delivery trucks.
- An 18-wheeler (end dump, semi) is much bigger and needs a wider road and room to turn around. NOT every property can fit one.
- When asking about access, you are ONLY asking about 18-wheelers. Never ask "can a dump truck get to your property" because dump trucks go everywhere.
- The correct question is: "can an 18-wheeler get to your property or should we use standard dump trucks"

WHAT YOU KNOW ABOUT DIRT:
- Fill Dirt: clean, general purpose."""
if old_system_section in code:
    code = code.replace(old_system_section, new_system_section)
    fixes += 1
    print("  ✓ Added truck access knowledge to SARAH_SYSTEM prompt")

# ═══════════════════════════════════════════════════════════
# FIX 2: PRICING FLOW — specific date → dual quote trigger
# ═══════════════════════════════════════════════════════════

# Fix 2a: Update the delivery date instruction to mention dual pricing
old_date = 'instruction = "Ask about their timeline. Do they need it by a specific date or are they flexible on delivery"'
new_date = 'instruction = "Ask about their timeline. Do they need it by a specific date or are they flexible. If they give a specific date we can offer guaranteed delivery for that date at a premium price, or standard 3-5 business day delivery at a lower price"'
if old_date in code:
    code = code.replace(old_date, new_date)
    fixes += 1
    print("  ✓ Fixed delivery date instruction to mention dual pricing")

# Fix 2e: Detect specific date vs flexible and change quote presentation
# Find the "ALL INFO COLLECTED" section and add date detection
old_quote_section = '''    // ALL INFO COLLECTED — get dual quote (standard + priority from quarries)
    const dualQuote = (merged.delivery_lat && merged.delivery_lng)
      ? await getDualQuote('''
new_quote_section = '''    // ALL INFO COLLECTED — get dual quote (standard + priority from quarries)
    // Detect if customer gave a SPECIFIC date vs "flexible/whenever"
    const isFlexibleDate = /flexible|whenever|no rush|no hurry|not urgent|no specific|any.?time|doesn.?t matter|don.?t care/i.test(merged.delivery_date || "")
    const isSpecificDate = !isFlexibleDate && has(merged.delivery_date)
    const dualQuote = (merged.delivery_lat && merged.delivery_lng)
      ? await getDualQuote('''
if old_quote_section in code:
    code = code.replace(old_quote_section, new_quote_section)
    fixes += 1
    print("  ✓ Added specific date detection before quote generation")

# Now update the instruction that presents the quote to handle specific vs flexible dates
old_present = '''      // Sarah presents the formatted dual quote exactly as the pricing engine wrote it
      instruction = `Present this quote to the customer exactly as written (rephrase naturally but keep the numbers exact): ${dualQuote.formatted}`'''
new_present = '''      // Sarah presents the formatted dual quote exactly as the pricing engine wrote it
      if (isSpecificDate && dualQuote.priority) {
        // Customer gave specific date — MUST present both options clearly
        instruction = `Customer needs it by ${merged.delivery_date}. Present BOTH options clearly:

Option 1 - Standard delivery: ${fmt$(dualQuote.standard.totalCents)} (${fmt$(dualQuote.standard.perYardCents)}/yard), 3-5 business days, sometimes sooner if we get a cancellation

Option 2 - Guaranteed by ${merged.delivery_date}: ${fmt$(dualQuote.priority.totalCents)} (${fmt$(dualQuote.priority.perYardCents)}/yard), locked in delivery date, payment upfront to secure the date

Ask which works better for them. Keep it natural, two short lines for the options then ask which one`
      } else if (isFlexibleDate || !dualQuote.priority) {
        // Flexible date or no priority available — just show standard
        instruction = `Present the standard quote: ${dualQuote.standard.billableYards} yards of ${fmtMaterial(merged.material_type||"")} to ${merged.delivery_city||""} comes to ${fmt$(dualQuote.standard.totalCents)} (${fmt$(dualQuote.standard.perYardCents)}/yard), delivery in 3-5 business days. Ask if they want to get that scheduled`
      } else {
        // Has priority but date wasn't clearly specific — show both but lead with standard
        instruction = `Present this quote to the customer exactly as written (rephrase naturally but keep the numbers exact): ${dualQuote.formatted}`
      }'''
if old_present in code:
    code = code.replace(old_present, new_present)
    fixes += 1
    print("  ✓ Fixed quote presentation to show dual pricing on specific dates")

# Do the same for the __GENERATE_QUOTE__ section
old_generate = '''      if (dualQuote) {
        updates.price_per_yard_cents = dualQuote.standard.perYardCents
        updates.total_price_cents = dualQuote.standard.totalCents
        updates.zone = dualQuote.standard.zone
        updates.state = "QUOTING"
        if (dualQuote.priority) {
          updates._priority_total_cents = dualQuote.priority.totalCents
          updates._priority_guaranteed_date = dualQuote.priority.guaranteedDate
          updates._priority_quarry_name = dualQuote.priority.quarryName
        }
        instruction = `Present this quote to the customer exactly as written (rephrase naturally but keep the numbers exact): ${dualQuote.formatted}`
      } else {'''

# Only replace the SECOND occurrence (in __GENERATE_QUOTE__ block)
first_idx = code.find(old_generate)
if first_idx != -1:
    second_idx = code.find(old_generate, first_idx + len(old_generate))
    if second_idx != -1:
        new_generate = '''      if (dualQuote) {
        updates.price_per_yard_cents = dualQuote.standard.perYardCents
        updates.total_price_cents = dualQuote.standard.totalCents
        updates.zone = dualQuote.standard.zone
        updates.state = "QUOTING"
        if (dualQuote.priority) {
          updates._priority_total_cents = dualQuote.priority.totalCents
          updates._priority_guaranteed_date = dualQuote.priority.guaranteedDate
          updates._priority_quarry_name = dualQuote.priority.quarryName
        }
        const qIsFlexible = /flexible|whenever|no rush|no hurry/i.test(qMerged.delivery_date || "")
        const qIsSpecific = !qIsFlexible && (qMerged.delivery_date || "").length > 0
        if (qIsSpecific && dualQuote.priority) {
          instruction = `Customer needs it by ${qMerged.delivery_date}. Present BOTH options: Standard at ${fmt$(dualQuote.standard.totalCents)} (3-5 business days) or Guaranteed by ${qMerged.delivery_date} at ${fmt$(dualQuote.priority.totalCents)} (payment upfront). Ask which works better`
        } else {
          instruction = `Present this quote: ${dualQuote.formatted}`
        }
      } else {'''
        code = code[:second_idx] + new_generate + code[second_idx + len(old_generate):]
        fixes += 1
        print("  ✓ Fixed __GENERATE_QUOTE__ block for specific date dual pricing")

# ═══════════════════════════════════════════════════════════
# VERIFY & SAVE
# ═══════════════════════════════════════════════════════════

if code == original:
    print("\n⚠ NO CHANGES MADE — strings may have already been patched or don't match exactly")
    print("  Check the file manually for the access question and pricing flow")
    sys.exit(1)

with open(PATH, "w") as f:
    f.write(code)

print(f"\n✓ {fixes} fixes applied to {PATH}")
print()
print("WHAT CHANGED:")
print("  1. Access question now correctly asks about 18-WHEELERS only")
print("     (dump trucks, triaxles, quad axles go everywhere)")
print("  2. SARAH_SYSTEM prompt now educates Sonnet about truck types")
print("  3. When customer gives specific date → dual pricing presented")
print("     Standard (3-5 days) vs Guaranteed (upfront payment)")
print("  4. Flexible dates → standard pricing only")
print()
print("NEXT: npm run build && git add -A && git commit -m 'fix: access question + dual pricing on specific dates' && git push origin main")
