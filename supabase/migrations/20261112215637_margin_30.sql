-- Margin 30% for everyone (Matt, Nov 12, 2026). It was 25% from Nov 10.
--
-- price = cost / (1 - margin), rounded to cents: a $10.00 case now sells for $14.29 (it was $13.33).
-- Prices are worked out when they are read (my_prices, place_order, save_usual_order), so the new margin
-- reaches the site, the list and new orders at once. Orders already placed keep the prices they copied.
-- Fees are not touched here.

update public.pricing set margin = 0.30 where id;
