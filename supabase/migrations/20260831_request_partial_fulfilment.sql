-- Record how much of a request actually shipped, and let a request be closed
-- when the goods are not there.
--
-- Until now /ship only moved the status to in_transit. A request for 20 units
-- of which 12 were sent looked identical to one fully satisfied, and a product
-- held nowhere had no closing move at all: once accepted, the only action left
-- was "transfer and send", which cannot be done without stock. That is why 32
-- requests have sat in accepted for an average of 82 days.

ALTER TABLE public.stock_requests
  ADD COLUMN IF NOT EXISTS shipped_qty integer;

COMMENT ON COLUMN public.stock_requests.shipped_qty IS
  'Units actually transferred when the request was shipped. NULL until it ships; below requested_qty means partially fulfilled.';

-- 'partial' is already permitted by stock_requests_status_check, so the status
-- constraint needs no change.
