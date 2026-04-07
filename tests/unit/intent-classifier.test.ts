import { describe, it, expect } from 'vitest'

// Reproduces the brain's intent regexes so we can unit-test them in isolation.
// MUST stay in sync with lib/services/customer-brain.service.ts
//
// CRITICAL: this file exists because regexes were placing orders the customer
// did not approve ("can you do cheaper" / "ok let me think" / "no rush" all
// fired the wrong intent). Every regex below has BOTH positive cases (the
// real intent) AND negative cases (false positives we caught in production).
// If you change a regex in the brain, change it here too.

function classify(body: string) {
  const lower = (body || "").toLowerCase()
  const trimmedLower = lower.trim()

  const isBareYes = /^(yes|yeah|yep|yup|si|dale|sounds good|perfect|works|absolutely|definitely)[.!?]?$/i.test(trimmedLower)
  const isBareNo = /^(no|nah|nope|pass)[.!?]?$/i.test(trimmedLower)
  const isYes = isBareYes
    || /\b(lets do it|let's do it|go ahead|book it|schedule it|set it up|do it|im down|i'm down|im in|i'm in|lets go|let's go|sure thing|sounds great|sounds perfect|that works|works for me|go for it|lock it in|lock me in|lock it|im ready|i'm ready|ready to (book|schedule|go|order|move|do)|ready to move forward|move forward|ill take it|i'll take it|sign me up|count me in|im sold|i'm sold|ok lets do|ok let's do|ok book|ok schedule|ok lets go|ok let's go|ok do it|yes please|yes lets|yes let's|yes book|yes schedule|yes do)\b/i.test(lower)
  const isNo = isBareNo
    || /\b(too much|too expensive|way too much|too high|cant afford|can't afford|out of my budget|too pricey|hard pass|no way|no thanks|no thank you|nah im good|nah i'm good|not right now|not interested|maybe later|ill pass|i'll pass|cancel that|forget it|nevermind|never mind|dont want|don't want|dont need|don't need|not gonna|im out|i'm out)\b/i.test(lower)
  const isCancel = /\b(i want to cancel|cancel (my|the|this) (order|delivery)|please cancel|need to cancel|cancel it|cancel everything|refund my (order|delivery|payment)|i need a refund|want a refund|money back please|give me my money back)\b/i.test(lower)
  const isNegotiating = /\b(cheaper|cheap|discount|lower price|lower the price|come down|knock off|knock down|too high|too expensive|deal|price match|haggle|reduce|sale|coupon)\b/i.test(lower)
  const isAskingWhen = (/\b(when (can|will|do|would|are|could)|how soon|how long|how fast|how quick|whats the eta|what.?s the eta|whats the timeline|what.?s the timeline|when.s delivery|when is delivery|how much time|what.?s the timeframe|whats the timeframe|when do you|when would you|how many days)\b/i.test(lower))
    && !isYes && !isNo
  const wantsNewOrder = /\b(need more|want more|order more|another (load|delivery|order)|new (order|delivery|load)|more dirt|more fill|more topsoil|more sand|need (dirt|fill|topsoil|sand)|want (dirt|fill|topsoil|sand)|order again|same thing|same order|reorder|do it again|book another|need to (order|book|schedule)|can i (order|get|book))\b/i.test(lower)
  return { isYes, isNo, isCancel, isNegotiating, isAskingWhen, wantsNewOrder }
}

describe('isYes — positive cases (must place order)', () => {
  it('"yes"', () => expect(classify('yes').isYes).toBe(true))
  it('"yes please"', () => expect(classify('yes please').isYes).toBe(true))
  it('"yes lets do it"', () => expect(classify('yes lets do it').isYes).toBe(true))
  it('"lets do it"', () => expect(classify('lets do it').isYes).toBe(true))
  it('"let\'s go"', () => expect(classify("let's go").isYes).toBe(true))
  it('"book it"', () => expect(classify('book it').isYes).toBe(true))
  it('"schedule it"', () => expect(classify('schedule it').isYes).toBe(true))
  it('"sounds good"', () => expect(classify('sounds good').isYes).toBe(true))
  it('"that works"', () => expect(classify('that works').isYes).toBe(true))
  it('"perfect"', () => expect(classify('perfect').isYes).toBe(true))
  it('"works for me"', () => expect(classify('works for me').isYes).toBe(true))
  it('"sign me up"', () => expect(classify('sign me up').isYes).toBe(true))
  it('"im in"', () => expect(classify('im in').isYes).toBe(true))
  it('"lock it in"', () => expect(classify('lock it in').isYes).toBe(true))
  it('"ready to book"', () => expect(classify('ready to book').isYes).toBe(true))
  it('"ill take it"', () => expect(classify('ill take it').isYes).toBe(true))
})

describe('isYes — NEGATIVE cases (must NOT place order)', () => {
  // The class of bugs that started this file
  it('"ok let me think" must NOT be yes', () => {
    expect(classify('ok let me think').isYes).toBe(false)
  })
  it('"ok thanks" must NOT be yes', () => {
    expect(classify('ok thanks').isYes).toBe(false)
  })
  it('"sure what are my options" must NOT be yes', () => {
    expect(classify('sure what are my options').isYes).toBe(false)
  })
  it('"ready for the price" must NOT be yes', () => {
    expect(classify('ready for the price').isYes).toBe(false)
  })
  it('"ready when you are" must NOT be yes', () => {
    expect(classify('ready when you are').isYes).toBe(false)
  })
  it('"okay i understand" must NOT be yes', () => {
    expect(classify('okay i understand').isYes).toBe(false)
  })
  it('"ok hold on" must NOT be yes', () => {
    expect(classify('ok hold on').isYes).toBe(false)
  })
  it('"absolutely not" must NOT be yes', () => {
    // false positive avoided because we removed bare "absolutely" from non-anchored set
    // (it's only matched standalone or in confirmation phrases)
    expect(classify('absolutely not').isYes).toBe(false)
  })
})

describe('isNo — positive cases', () => {
  it('"no"', () => expect(classify('no').isNo).toBe(true))
  it('"nope"', () => expect(classify('nope').isNo).toBe(true))
  it('"too expensive"', () => expect(classify('too expensive').isNo).toBe(true))
  it('"not interested"', () => expect(classify('not interested').isNo).toBe(true))
  it('"hard pass"', () => expect(classify('hard pass').isNo).toBe(true))
  it('"maybe later"', () => expect(classify('maybe later').isNo).toBe(true))
  it('"i\'ll pass"', () => expect(classify("i'll pass").isNo).toBe(true))
  it('"forget it"', () => expect(classify('forget it').isNo).toBe(true))
  it('"dont need it"', () => expect(classify('dont need it').isNo).toBe(true))
})

describe('isNo — NEGATIVE cases (must NOT reject order)', () => {
  it('"no rush" must NOT be no', () => {
    expect(classify('no rush').isNo).toBe(false)
  })
  it('"no problem" must NOT be no', () => {
    expect(classify('no problem').isNo).toBe(false)
  })
  it('"no tax right" must NOT be no', () => {
    expect(classify('no tax right').isNo).toBe(false)
  })
  it('"no big deal" must NOT be no', () => {
    expect(classify('no big deal').isNo).toBe(false)
  })
  it('"no specific date" must NOT be no', () => {
    expect(classify('no specific date').isNo).toBe(false)
  })
})

describe('isCancel — positive', () => {
  it('"cancel my order"', () => expect(classify('cancel my order').isCancel).toBe(true))
  it('"please cancel"', () => expect(classify('please cancel').isCancel).toBe(true))
  it('"i need a refund"', () => expect(classify('i need a refund').isCancel).toBe(true))
})

describe('isCancel — NEGATIVE (must NOT cancel)', () => {
  it('"i want my money\'s worth" must NOT cancel', () => {
    expect(classify("i want my money's worth").isCancel).toBe(false)
  })
  it('"is there a money back guarantee" must NOT cancel', () => {
    expect(classify('is there a money back guarantee').isCancel).toBe(false)
  })
})

describe('isNegotiating — positive', () => {
  it('"can you do cheaper"', () => expect(classify('can you do cheaper').isNegotiating).toBe(true))
  it('"any discount"', () => expect(classify('any discount').isNegotiating).toBe(true))
  it('"lower price"', () => expect(classify('lower price').isNegotiating).toBe(true))
  it('"too expensive"', () => expect(classify('too expensive').isNegotiating).toBe(true))
})

describe('isAskingWhen — positive', () => {
  it('"when can you deliver"', () => expect(classify('when can you deliver').isAskingWhen).toBe(true))
  it('"how soon can you come"', () => expect(classify('how soon can you come').isAskingWhen).toBe(true))
  it('"how long does it take"', () => expect(classify('how long does it take').isAskingWhen).toBe(true))
  it('"whats the eta"', () => expect(classify('whats the eta').isAskingWhen).toBe(true))
})

describe('isAskingWhen — NEGATIVE (must NOT intercept confirmations)', () => {
  it('"yes please schedule it" must NOT be askingWhen', () => {
    // isYes guard kicks in
    expect(classify('yes please schedule it').isAskingWhen).toBe(false)
  })
  it('"the delivery sounds good" must NOT be askingWhen', () => {
    // isYes wins via "sounds good"
    expect(classify('the delivery sounds good').isAskingWhen).toBe(false)
  })
  it('"yes book it" must NOT be askingWhen', () => {
    expect(classify('yes book it').isAskingWhen).toBe(false)
  })
})

describe('wantsNewOrder — positive', () => {
  it('"i need more dirt"', () => expect(classify('i need more dirt').wantsNewOrder).toBe(true))
  it('"can i order another load"', () => expect(classify('can i order another load').wantsNewOrder).toBe(true))
  it('"need to schedule a new delivery"', () => expect(classify('need to schedule a new delivery').wantsNewOrder).toBe(true))
  it('"book another one"', () => expect(classify('book another one').wantsNewOrder).toBe(true))
})

describe('wantsNewOrder — NEGATIVE (must NOT reset state on positive feedback)', () => {
  it('"the delivery was fine thanks" must NOT trigger new order', () => {
    expect(classify('the delivery was fine thanks').wantsNewOrder).toBe(false)
  })
  it('"the delivery was great" must NOT trigger new order', () => {
    expect(classify('the delivery was great').wantsNewOrder).toBe(false)
  })
  it('"thanks for the delivery" must NOT trigger new order', () => {
    expect(classify('thanks for the delivery').wantsNewOrder).toBe(false)
  })
})
