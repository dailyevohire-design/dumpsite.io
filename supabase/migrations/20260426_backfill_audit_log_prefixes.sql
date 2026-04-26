-- Backfill audit-log prefixes from rescue/cron handlers.
-- Affected: rescue-stuck (2), stale-orders (4), payment-watchdog (3) = 9 historical writes.
-- DO NOT include CONVERSATION in the regex alternation. The [CONVERSATION RESET]
-- sentinel in brain.service.ts:266 is read by brain.service.ts:286 as a history-walk
-- boundary. Stripping it would cause the brain to walk into stale pre-reset context.

UPDATE sms_logs
  SET body = regexp_replace(body, '^\[(RESCUE|NO-SHOW|APPROVAL|STRANDED|PAYMENT) [A-Z0-9_ ]+\]\s*', '')
  WHERE body ~ '^\[(RESCUE|NO-SHOW|APPROVAL|STRANDED|PAYMENT) '
    AND body <> '[CONVERSATION RESET]';

UPDATE customer_sms_logs
  SET body = regexp_replace(body, '^\[(RESCUE|NO-SHOW|APPROVAL|STRANDED|PAYMENT) [A-Z0-9_ ]+\]\s*', '')
  WHERE body ~ '^\[(RESCUE|NO-SHOW|APPROVAL|STRANDED|PAYMENT) '
    AND body <> '[CONVERSATION RESET]';
