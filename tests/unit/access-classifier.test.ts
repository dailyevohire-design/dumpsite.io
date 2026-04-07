import { describe, it, expect } from 'vitest'
import { classifyAccess } from '../../lib/services/access-classifier'

const ACCESS_Q = "can an 18-wheeler get in or should we stick with regular dump trucks"

describe('classifyAccess — the bug that started this', () => {
  it('classifies "dump trucks" as dump_truck_only (THE original failure)', () => {
    expect(classifyAccess('dump trucks', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "just dump trucks" as dump_truck_only', () => {
    expect(classifyAccess('just dump trucks', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "regular dump trucks" as dump_truck_only', () => {
    expect(classifyAccess('regular dump trucks please', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "tandem" as dump_truck_only', () => {
    expect(classifyAccess('tandem', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "triaxle" as dump_truck_only', () => {
    expect(classifyAccess('triaxle is fine', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "small ones" as dump_truck_only', () => {
    expect(classifyAccess('small ones', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "regular ones" as dump_truck_only', () => {
    expect(classifyAccess('regular ones', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "the smaller trucks" as dump_truck_only', () => {
    expect(classifyAccess('the smaller trucks please', ACCESS_Q)).toBe('dump_truck_only')
  })
})

describe('classifyAccess — affirmative for 18-wheeler', () => {
  it('classifies "yes" as dump_truck_and_18wheeler', () => {
    expect(classifyAccess('yes', ACCESS_Q)).toBe('dump_truck_and_18wheeler')
  })
  it('classifies "yeah an 18-wheeler can fit" as dump_truck_and_18wheeler', () => {
    expect(classifyAccess('yeah an 18-wheeler can fit', ACCESS_Q)).toBe('dump_truck_and_18wheeler')
  })
  it('classifies "semi can come in no problem"', () => {
    expect(classifyAccess('semi can come in no problem', ACCESS_Q)).toBe('dump_truck_and_18wheeler')
  })
  it('classifies "long open road big rig fits no problem" as dump_truck_and_18wheeler', () => {
    // No conflicting "driveway" / "narrow" signals here, so this should
    // resolve cleanly to 18-wheeler-allowed.
    expect(classifyAccess('long open road big rig fits no problem', ACCESS_Q)).toBe('dump_truck_and_18wheeler')
  })
})

describe('classifyAccess — negative for 18-wheeler', () => {
  it('classifies "no" as dump_truck_only', () => {
    expect(classifyAccess('no', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "nope, road is too narrow" as dump_truck_only', () => {
    expect(classifyAccess('nope, road is too narrow', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "no a semi cant fit" as dump_truck_only', () => {
    expect(classifyAccess("no a semi cant fit", ACCESS_Q)).toBe('dump_truck_only')
  })
  it('classifies "tight residential street" as dump_truck_only', () => {
    expect(classifyAccess('tight residential street', ACCESS_Q)).toBe('dump_truck_only')
  })
})

describe('classifyAccess — never-stuck guarantee', () => {
  it('returns dump_truck_only for ANY response when access was just asked', () => {
    // Catchall: when we asked the question and the customer said something
    // we cant parse, default to dump_truck_only and move on. NEVER return null
    // when we just asked.
    expect(classifyAccess('idk', ACCESS_Q)).toBe('dump_truck_only')
    expect(classifyAccess('whatever you think is best', ACCESS_Q)).toBe('dump_truck_only')
    expect(classifyAccess('what does that mean', ACCESS_Q)).toBe('dump_truck_only')
    expect(classifyAccess('hmm', ACCESS_Q)).toBe('dump_truck_only')
  })
  it('returns null when access was NOT just asked and message is unrelated', () => {
    expect(classifyAccess('hello there', 'what was your name')).toBeNull()
  })
})
