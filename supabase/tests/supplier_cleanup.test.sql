-- Check after supabase/data/20261118_supplier_cleanup.sql. Reads only.
-- Every row should read passed = true.

with merged as (
  select id from public.suppliers
  where lower(btrim(name)) in ('ааксон', 'аксом', 'зейн фарма', 'zein pharma', 'nature''s plus', 'рааб',
                               'cubo', 'родосорб')
)

select 'C1 every product of the listed categories has a supplier' as test,
       count(*) = 0 as passed,
       coalesce(string_agg(distinct c.name, ', '), '') as detail
from public.products p
join public.categories c on c.id = p.category_id
where p.supplier_id is null
  and lower(btrim(c.name)) in ('арома', 'витамаг', 'панацея', 'зонафарм', 'корейска козметика', 'чай',
                               'зеолитни продукти', 'durex/ bilka', 'лабораторни консумативи', 'медицински изделия')

union all
select 'C2 the merged names are hidden',
       count(*) = 0,
       coalesce(string_agg(name, ', '), '')
from public.suppliers
where is_active
  and lower(btrim(name)) in ('ааксон', 'аксом', 'зейн фарма', 'zein pharma', 'nature''s plus', 'рааб',
                             'cubo', 'родосорб')

union all
select 'C3 nothing points at a merged name any more',
       (select count(*) from public.products p join merged s on s.id = p.supplier_id)
     + (select count(*) from public.delivery_items d join merged s on s.id = d.supplier_id)
     + (select count(*) from public.supplier_orders o join merged s on s.id = o.supplier_id) = 0,
       ''

union all
select 'C4 Източник shows the supplier''s name',
       count(*) = 0,
       count(*)::text || ' different'
from public.products p join public.suppliers s on s.id = p.supplier_id
where p.source is distinct from s.name

union all
select 'C5 the new suppliers exist (Ана, Farer, Cudo)',
       count(*) = 3,
       string_agg(name, ', ')
from public.suppliers
where is_active and lower(btrim(name)) in ('ана', 'farer', 'cudo');
