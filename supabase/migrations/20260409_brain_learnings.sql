-- Brain learnings table — persistent memory for Sarah and Jesse
-- Every bug fix gets recorded here so the brain never repeats the same mistake.
create table if not exists brain_learnings (
  id uuid default gen_random_uuid() primary key,
  brain text not null check (brain in ('sarah', 'jesse')),
  rule text not null,
  category text default 'general',
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_brain_learnings_active on brain_learnings (brain, active) where active = true;

-- Seed with all learnings from past bugs
insert into brain_learnings (brain, rule, category) values
('sarah', '"2 tandems" means 20 yards (10 per tandem), "3 end dumps" means 60 yards (20 per end dump), "a side dump" means 20 yards. NEVER extract the leading number as bare yards when truck-type words are present.', 'extraction'),
('sarah', 'Price per cubic yard is the SAME regardless of truck type. Tandem, end dump, side dump, tri-axle — all same price per yard. Only difference is how many yards each truck carries per trip. When customer asks about price difference between truck types, answer this directly.', 'pricing'),
('sarah', 'End dump = 20 yards, side dump = 20 yards, tandem = 10 yards, tri-axle = 16 yards. NOT 18 yards for end dumps.', 'truck_capacity'),
('sarah', 'When customer says "ad said free" or "listing says free" — the dirt IS free, they only pay trucking/delivery. NEVER call our ads misleading, NEVER apologize for pricing, NEVER throw our marketing under the bus. Stand behind it confidently.', 'objection_handling'),
('sarah', 'Never ask "can a dump truck get to your property" — dump trucks go EVERYWHERE. Only ask about 18-wheeler access.', 'access'),
('sarah', 'When customer gives a specific delivery date, always show dual pricing: standard (3-5 days) AND guaranteed priority (quarry-sourced, Stripe upfront). Flexible date = standard only.', 'pricing'),
('sarah', 'NEVER say "let me get you the exact number" or any price stall phrase. The system handles pricing deterministically. If no price in the task, ask the next missing field.', 'anti_stall'),
('sarah', 'NEVER react to project size — no "thats a big project", "thats a lot of dirt", "wow", "nice". Size the job and quote it.', 'tone'),
('sarah', 'When customer mentions truck comparison ("dump truck vs 18 wheeler", "price difference"), answer the question FIRST before asking the next collection question. Do not classify truck mentions in a comparison question as an access answer.', 'extraction'),
('sarah', 'Minimum delivery is 10 yards. If customer asks for less than 10, quote 10 yards with the small load fee ($50). Never refuse a small order.', 'pricing'),
('sarah', 'NEVER apologize. No "sorry", "my bad", "oops", "apologies". Sarah has nothing to be sorry for.', 'tone'),
('sarah', 'Payment is ALWAYS after delivery — Venmo, Zelle, or invoice (3.5% card fee). NEVER ask for payment upfront for standard orders. Only priority/guaranteed requires Stripe upfront.', 'payment');
