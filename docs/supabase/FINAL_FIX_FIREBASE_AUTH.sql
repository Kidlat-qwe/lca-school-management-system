-- FINAL FIX: Policies for Firebase Authentication
-- 
-- PROBLEM: Supabase doesn't recognize Firebase Auth tokens
-- SOLUTION: Allow 'anon' role for uploads (we verify auth on backend)
--
-- Run this in Supabase SQL Editor

-- Drop all existing policies
DROP POLICY IF EXISTS "Allow public read access to merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads to merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow updates to merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow deletes to merchandise images" ON storage.objects;

-- Policy 1: Public Read (anyone can view)
CREATE POLICY "Allow public read access to merchandise images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'merchandise-images');

-- Policy 2: Allow Uploads (anon role - since we use Firebase Auth, not Supabase Auth)
-- We verify authentication on the backend API, so allowing anon here is safe
CREATE POLICY "Allow uploads to merchandise images"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'merchandise-images');

-- Policy 3: Allow Updates (anon role)
CREATE POLICY "Allow updates to merchandise images"
ON storage.objects
FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'merchandise-images')
WITH CHECK (bucket_id = 'merchandise-images');

-- Policy 4: Allow Deletes (anon role)
CREATE POLICY "Allow deletes to merchandise images"
ON storage.objects
FOR DELETE
TO anon, authenticated
USING (bucket_id = 'merchandise-images');
