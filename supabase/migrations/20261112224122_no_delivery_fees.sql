-- No delivery fee and no next-day fee (Matt, Nov 12, 2026). Both were $50 an order from Nov 10.
--
-- Orders still copy both fees when they are placed, so a fee can come back by changing this row.
-- The site shows a fee of $0 as "Free". Orders already placed keep the fees they copied.
-- The margin is not touched here.

update public.pricing set delivery_fee = 0, next_day_fee = 0 where id;
