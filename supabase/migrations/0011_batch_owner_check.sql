-- 0011 · batches from the tools site get their owner right after insert; drop the insert-time check
alter table public.listing_batches drop constraint if exists listing_batches_owner;
