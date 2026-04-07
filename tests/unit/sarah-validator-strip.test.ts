import { describe, it, expect } from 'vitest'

// Reproduces the validator's strip logic so we can unit-test the regexes
// without booting the customer-brain service (which loads Anthropic at
// module-import time). Keep this in sync with the validate() function in
// lib/services/customer-brain.service.ts.
function stripRoboticOpeners(r: string): string {
  r = r.replace(/^(ha|haha|hehe|lol|oops|sorry|my bad|apologies)\b\s*,?\s*/i, "").trim()
  r = r.replace(/\b(sorry about that|my apologies|I apologize|sorry for)\b/gi, "").replace(/\s{2,}/g, " ").trim()
  r = r.replace(/^(hey|hi|hello)?\s*[,!]?\s*(thanks for (reaching out|getting in touch|texting|your message|contacting us|messaging)|thank you for (reaching out|getting in touch|texting|your message|contacting us|messaging)|glad you (reached out|texted|got in touch|messaged)|happy to help( you)?( with that)?|great to hear from you|appreciate you (reaching out|texting|contacting us)|i'?d (be )?(happy|glad|love) to (help|assist)( you)?( with that)?)\s*[,.!]?\s*/i, "").trim()
  r = r.replace(/^(of course|absolutely|certainly|no problem|for sure)\s*[,!.]?\s*/i, "").trim()
  return r
}

function stripZipAsks(r: string): string {
  r = r.split(/(?<=[.?!])\s+|\n+/)
    .filter(sentence => !/\b(zip\s*code|zipcode|postal\s*code|what.?s your zip|whats your zip|need your zip|need a zip|whats the zip|what.s the zip|cross street|nearest cross|landmark|neighborhood)\b/i.test(sentence))
    .join(" ")
    .trim()
  if (r.length < 3) r = "Let me get you the exact number, one sec"
  return r
}

describe('Sarah validator robotic opener strip', () => {
  it('strips "Hey, glad you reached out!"', () => {
    expect(stripRoboticOpeners("Hey, glad you reached out! Whats the address")).toBe("Whats the address")
  })

  it('strips "Thanks for reaching out"', () => {
    expect(stripRoboticOpeners("Thanks for reaching out. What are you using the dirt for")).toBe("What are you using the dirt for")
  })

  it('strips "Happy to help"', () => {
    expect(stripRoboticOpeners("Happy to help! How many yards do you need")).toBe("How many yards do you need")
  })

  it('strips "Of course"', () => {
    expect(stripRoboticOpeners("Of course, the price is $1500")).toBe("the price is $1500")
  })

  it('strips "Absolutely"', () => {
    expect(stripRoboticOpeners("Absolutely. Whats the delivery date")).toBe("Whats the delivery date")
  })

  it('strips "I\'d be happy to help with that"', () => {
    expect(stripRoboticOpeners("I'd be happy to help with that, whats the address")).toBe("whats the address")
  })

  it('strips "Hi! Thanks for getting in touch"', () => {
    expect(stripRoboticOpeners("Hi! Thanks for getting in touch, whats your name")).toBe("whats your name")
  })

  it('strips "Great to hear from you"', () => {
    expect(stripRoboticOpeners("Great to hear from you. We can do that")).toBe("We can do that")
  })

  it('leaves a direct response untouched', () => {
    expect(stripRoboticOpeners("got it, whats the address")).toBe("got it, whats the address")
  })

  it('leaves "yeah we cover that area" untouched', () => {
    expect(stripRoboticOpeners("yeah we cover that area, what are you using it for")).toBe("yeah we cover that area, what are you using it for")
  })

  it('strips "whats your zip code" sentence — keeps the rest', () => {
    expect(stripZipAsks("Got the address. Whats your zip code? I need it for pricing.")).toBe("Got the address. I need it for pricing.")
  })
  it('strips "I need your zip" sentence', () => {
    expect(stripZipAsks("Got it. I need your zip to confirm. Thanks!")).toBe("Got it. Thanks!")
  })
  it('strips "what zipcode" (no space)', () => {
    expect(stripZipAsks("ok and what zipcode is that?")).toBe("Let me get you the exact number, one sec")
  })
  it('strips "postal code" sentence', () => {
    expect(stripZipAsks("Got the street. Whats the postal code?")).toBe("Got the street.")
  })
  it('strips "cross street" sentence', () => {
    expect(stripZipAsks("Thanks. Whats the nearest cross street?")).toBe("Thanks.")
  })
  it('leaves a clean reply alone', () => {
    expect(stripZipAsks("Got the address, what are you using the dirt for")).toBe("Got the address, what are you using the dirt for")
  })
  it('replaces empty result with safe fallback', () => {
    expect(stripZipAsks("whats your zip code")).toBe("Let me get you the exact number, one sec")
  })

  it('strips "Sorry" opener (laughter rule catches it before the apology rule)', () => {
    // "Sorry" hits the leading-laughter strip first ("ha|sorry|...") and gets
    // peeled off, leaving "for the delay...". The downstream apology rule
    // (`sorry for`) then has nothing to match. Documenting current behavior.
    expect(stripRoboticOpeners("Sorry for the delay, the price is $1500")).toBe("for the delay, the price is $1500")
  })
})
