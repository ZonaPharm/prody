-- Storage RLS policies for products bucket
-- Fixes "new row violates row-level security policy for table 'objects'" when uploading images

-- Allow admins to upload to products bucket
create policy "Admins can upload product images" on storage.objects
  for insert with check (
    bucket_id = 'products' and is_admin()
  );

-- Allow admins to update product images
create policy "Admins can update product images" on storage.objects
  for update using (
    bucket_id = 'products' and is_admin()
  );

-- Allow admins to delete product images
create policy "Admins can delete product images" on storage.objects
  for delete using (
    bucket_id = 'products' and is_admin()
  );

-- Allow public read access to products bucket
create policy "Public read products bucket" on storage.objects
  for select using (
    bucket_id = 'products'
  );
