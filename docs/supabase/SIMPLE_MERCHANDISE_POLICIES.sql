-- Simple Merchandise Images Policies (Same pattern as user-avatars)
-- Run this in Supabase SQL Editor

-- Drop all existing policies
DROP POLICY IF EXISTS "Allow public read access to merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update merchandise images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete merchandise images" ON storage.objects;

-- Policy 1: Public Read (simplified - just check bucket)
CREATE POLICY "Allow public read access to merchandise images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'merchandise-images');

-- Policy 2: Authenticated Upload (simplified - just check bucket)
CREATE POLICY "Allow authenticated users to upload merchandise images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'merchandise-images');

-- Policy 3: Authenticated Update (simplified - just check bucket)
CREATE POLICY "Allow authenticated users to update merchandise images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'merchandise-images')
WITH CHECK (bucket_id = 'merchandise-images');

-- Policy 4: Authenticated Delete (simplified - just check bucket)
CREATE POLICY "Allow authenticated users to delete merchandise images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'merchandise-images');

