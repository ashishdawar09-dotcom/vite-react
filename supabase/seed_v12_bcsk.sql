-- =============================================================================
-- seed_v12_bcsk.sql
--
-- REFERENCE seed for the BC Super Kings Apr 2026 tournament after schema_v12
-- ships. Run this from the Supabase SQL editor after verifying the numbers
-- with Ashish. Replace <TOURNAMENT_ID> with the actual tournament UUID.
--
-- This is NOT auto-applied during deploy — it's a copy-paste checklist that
-- captures what the public registration form needs to render for BCSK.
-- =============================================================================

-- ---------- TOURNAMENT METADATA ----------
UPDATE public.tournaments
SET
  venue_name            = 'Surrey Badminton Club',
  venue_address         = '19025 52 Ave, Surrey, BC V3S 8E5',
  venue_map_url         = 'https://maps.app.goo.gl/JHmUv6eNkXHfr63J9',
  event_time            = '09:00:00',
  registration_deadline = '2026-04-24 23:59:00-07',  -- PDT (UTC-7)
  contact_info          = E'Email: sports@bcsuperkings.ca\nPrem: 778-952-1586\nSivakumar: 604-841-0088\nGanesan: 778-325-3117\nMohan: 604-306-7776\nShobana: 778-927-8847\nSaji: 778-241-8042\nYuvaraj: 778-712-2112',
  e_transfer_email      = 'sports@bcsuperkings.ca',
  fees                  = '{
    "kid":   { "member": 12, "non_member": 15 },
    "teen":  { "member": 15, "non_member": 20 },
    "adult": { "member": 20, "non_member": 25 }
  }'::jsonb,
  registration_open     = true,
  terms_text            = E'Each participant for each category needs to submit this form separately.\n\nEach participant cannot play in more than 3 categories.\n\nIndividual registrations are welcome for the Men''s and Women''s Super Doubles categories. Players who do not have a partner may still register, and a partner will be arranged for them.\n\nSTRICTLY NON-MARKING SHOES ONLY ALLOWED AT THE VENUE.\n\nMinimum of 6 pairs/players required to conduct a category. If we don''t receive enough participants for any category, we reserve rights to remove it from the competition with full refund.\n\nPlease complete your e-Transfer payment BEFORE submitting this form, and enter the reference number below to complete the registration.'
WHERE id = '<TOURNAMENT_ID>';

-- ---------- CATEGORY TAGS ----------
-- Adjust the name matchers as needed; this assumes the categories were
-- created with the BCSK names listed in the source form.

-- Kids (8–12 yrs)
UPDATE public.categories SET age_band='kid'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Boys SINGLES%8%12%';
UPDATE public.categories SET age_band='kid'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Girls SINGLES%8%12%';

-- Teens (13–17 yrs)
UPDATE public.categories SET age_band='teen'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Boys SINGLES%13%17%';
UPDATE public.categories SET age_band='teen'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Girls SINGLES%13%17%';
UPDATE public.categories SET age_band='teen'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Youth DOUBLES%';

-- Adults (18+)
UPDATE public.categories SET age_band='adult'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Men''s SINGLES%18%';
UPDATE public.categories SET age_band='adult'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Men''s DOUBLES%18%';
UPDATE public.categories SET age_band='adult'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Women''s DOUBLES%18%';
UPDATE public.categories SET age_band='adult'
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Mixed DOUBLES%';

-- Super Doubles (45+/35+) — allow solo signup so the club can pair partners
UPDATE public.categories
   SET age_band='adult', allow_solo_signup=true
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Men''s SUPER DOUBLES%';
UPDATE public.categories
   SET age_band='adult', allow_solo_signup=true
 WHERE tournament_id='<TOURNAMENT_ID>' AND name ILIKE 'Women''s SUPER DOUBLES%';

-- ---------- VERIFY ----------
-- After running, double-check no categories were missed:
--   SELECT name, age_band, allow_solo_signup
--     FROM public.categories
--    WHERE tournament_id='<TOURNAMENT_ID>'
--    ORDER BY sort_order;
