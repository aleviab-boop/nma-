-- ============================================================================
-- 001_seed_baseline_items.sql
--
-- Seeds the items table with the 47 baseline garments from the legacy in-app
-- BASELINE array. Idempotent: re-running is a no-op (UNIQUE constraint on sku
-- + ON CONFLICT DO NOTHING).
--
-- Run once in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).
-- ============================================================================

-- 1) Make sku unique so this seed is idempotent
ALTER TABLE public.items
  ADD CONSTRAINT items_sku_unique UNIQUE (sku);

-- 2) Enable Realtime on items + item_photos (no-op if already enabled)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='item_photos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.item_photos;
  END IF;
END $$;

-- 3) Insert 47 baseline pieces. created_at offsets mirror _daysAgo(N) from the legacy code.
INSERT INTO public.items (sku, name, designer, category, status, created_at) VALUES
  ('M001', 'Maroon Raw Silk Saree',          'Sabyasachi',           'saree',    'in-wardrobe', NOW() - INTERVAL  '120 days'),
  ('M002', 'Champagne Pearl Saree',          'Manish Malhotra',      'saree',    'in-wardrobe', NOW() - INTERVAL   '90 days'),
  ('M003', 'Teal Chiffon Anarkali',          'Tarun Tahiliani',      'anarkali', 'in-wardrobe', NOW() - INTERVAL  '180 days'),
  ('M004', 'Banarasi Mashru Silk',           'Raw Mango',            'saree',    'in-wardrobe', NOW() - INTERVAL   '45 days'),
  ('M005', 'Indigo Linen Saree',             'Anavila',              'saree',    'in-wardrobe', NOW() - INTERVAL   '60 days'),
  ('M006', 'Navy Bridal Lehenga',            'Sabyasachi',           'lehenga',  'in-wardrobe', NOW() - INTERVAL  '220 days'),
  ('M007', 'Emerald Tulle Lehenga',          'Tarun Tahiliani',      'lehenga',  'in-wardrobe', NOW() - INTERVAL  '150 days'),
  ('M008', 'Sequin Evening Gown',            'Manish Malhotra',      'gown',     'in-wardrobe', NOW() - INTERVAL   '95 days'),
  ('M009', 'Hazoorilal Polki Choker',        'Hazoorilal',           'jewelry',  'in-wardrobe', NOW() - INTERVAL  '400 days'),
  ('M010', 'Gold Mojari',                    'Sabyasachi',           'shoe',     'in-wardrobe', NOW() - INTERVAL   '80 days'),
  ('M011', 'Champagne Pumps',                'Jimmy Choo',           'shoe',     'in-wardrobe', NOW() - INTERVAL   '40 days'),
  ('M012', 'Birkin 30 Niloticus',            'Hermès',               'bag',      'in-wardrobe', NOW() - INTERVAL  '700 days'),
  ('M013', 'Chanel Classic Flap',            'Chanel',               'bag',      'in-wardrobe', NOW() - INTERVAL  '500 days'),
  ('M014', 'Ivory Chikankari Anarkali',      'Abu Jani Sandeep',     'anarkali', 'in-wardrobe', NOW() - INTERVAL   '70 days'),
  ('M015', 'Black Velvet Saree',             'Sabyasachi',           'saree',    'in-wardrobe', NOW() - INTERVAL  '110 days'),
  ('M016', 'Coral Paithani',                 'Raw Mango',            'saree',    'in-wardrobe', NOW() - INTERVAL   '85 days'),
  ('M017', 'Pearl Embroidered Sharara',      'Anita Dongre',         'anarkali', 'in-wardrobe', NOW() - INTERVAL   '55 days'),
  ('M018', 'Schiaparelli Black Tuxedo',      'Schiaparelli',         'gown',     'in-wardrobe', NOW() - INTERVAL   '30 days'),
  ('M019', 'Dior Atelier Saree-Gown',        'Dior',                 'gown',     'in-wardrobe', NOW() - INTERVAL  '180 days'),
  ('M020', 'Boucheron Diamond Suite',        'Boucheron',            'jewelry',  'in-wardrobe', NOW() - INTERVAL  '900 days'),
  ('M021', 'Cartier Tennis Bracelet',        'Cartier',              'jewelry',  'in-wardrobe', NOW() - INTERVAL  '600 days'),
  ('M022', 'Bottega Pouch',                  'Bottega Veneta',       'bag',      'in-wardrobe', NOW() - INTERVAL  '160 days'),
  ('M023', 'Loewe Puzzle',                   'Loewe',                'bag',      'in-wardrobe', NOW() - INTERVAL  '140 days'),
  ('M024', 'Tarun Pre-Drape Lehenga',        'Tarun Tahiliani',      'lehenga',  'in-wardrobe', NOW() - INTERVAL   '48 days'),
  ('M025', 'Vintage Kanjeevaram',            'Inherited',            'saree',    'in-wardrobe', NOW() - INTERVAL '1200 days'),
  ('M026', 'Patola Saree',                   'Inherited',            'saree',    'in-wardrobe', NOW() - INTERVAL '1500 days'),
  ('M027', 'Bandhej Saree',                  'Inherited',            'saree',    'in-wardrobe', NOW() - INTERVAL  '800 days'),
  ('M028', 'Manolo Hangisi (Blue)',          'Manolo Blahnik',       'shoe',     'in-wardrobe', NOW() - INTERVAL  '220 days'),
  ('M029', 'Roger Vivier Flats',             'Roger Vivier',         'shoe',     'in-wardrobe', NOW() - INTERVAL  '170 days'),
  ('M030', 'Falguni Shane Peacock Lehenga',  'Falguni Shane',        'lehenga',  'in-wardrobe', NOW() - INTERVAL   '75 days'),
  ('M031', 'Anamika Khanna Anarkali',        'Anamika Khanna',       'anarkali', 'in-wardrobe', NOW() - INTERVAL   '90 days'),
  ('M032', 'Rohit Bal Sherwani Saree',       'Rohit Bal',            'saree',    'in-wardrobe', NOW() - INTERVAL  '125 days'),
  ('M033', 'Masaba Saree',                   'Masaba',               'saree',    'in-wardrobe', NOW() - INTERVAL   '50 days'),
  ('M034', 'Ritu Kumar Block Print',         'Ritu Kumar',           'saree',    'in-wardrobe', NOW() - INTERVAL  '200 days'),
  ('M035', 'Chanel Pearl Choker',            'Chanel',               'jewelry',  'in-wardrobe', NOW() - INTERVAL  '300 days'),
  ('M036', 'Amrapali Kundan Set',            'Amrapali',             'jewelry',  'in-wardrobe', NOW() - INTERVAL  '450 days'),
  ('M037', 'Bvlgari Serpenti',               'Bvlgari',              'jewelry',  'in-wardrobe', NOW() - INTERVAL  '550 days'),
  ('M038', 'Aprajita Toor Jutti',            'Aprajita Toor',        'shoe',     'in-wardrobe', NOW() - INTERVAL  '190 days'),
  ('M039', 'Saint Laurent Pumps',            'Saint Laurent',        'shoe',     'in-wardrobe', NOW() - INTERVAL   '95 days'),
  ('M040', 'Goyard Tote',                    'Goyard',               'bag',      'in-wardrobe', NOW() - INTERVAL  '280 days'),
  ('M041', 'Dior Saddle Bag',                'Dior',                 'bag',      'in-wardrobe', NOW() - INTERVAL  '310 days'),
  ('M042', 'Anita Dongre Saree',             'Anita Dongre',         'saree',    'in-wardrobe', NOW() - INTERVAL   '65 days'),
  ('M043', 'Elie Saab Beaded Gown',          'Elie Saab',            'gown',     'in-wardrobe', NOW() - INTERVAL  '380 days'),
  ('M044', 'Valentino Couture',              'Valentino',            'gown',     'in-wardrobe', NOW() - INTERVAL  '420 days'),
  ('M045', 'Burmese Ruby Kanthi',            'Inherited',            'jewelry',  'in-wardrobe', NOW() - INTERVAL '2000 days'),
  ('M046', 'Sabya Heritage Lehenga',         'Sabyasachi',           'lehenga',  'cleaning',    NOW() - INTERVAL  '260 days'),
  ('M047', 'Manish Malhotra Sharara',        'Manish Malhotra',      'anarkali', 'in-wardrobe', NOW() - INTERVAL   '20 days')
ON CONFLICT (sku) DO NOTHING;

-- 4) Verify
SELECT 'Seeded items: ' || COUNT(*)::text AS result FROM public.items;
