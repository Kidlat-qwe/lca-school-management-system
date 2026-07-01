-- Setup RLS Policies for merchandise-images Storage Bucket
-- 
-- ⚠️  IMPORTANT: This SQL file cannot be run directly via regular database migrations!
-- 
-- Storage policies in Supabase must be created through one of these methods:
-- 
-- METHOD 1: Supabase Dashboard (RECOMMENDED - Easiest)
--   1. Go to Supabase Dashboard → Storage → Buckets
--   2. Create bucket 'merchandise-images' (if not exists)
--   3. Go to Storage → Policies → Select 'merchandise-images' bucket
--   4. Click "New Policy" and add each policy below manually
-- 
-- METHOD 2: Supabase SQL Editor with Service Role
--   1. Go to Supabase Dashboard → SQL Editor
--   2. Use the SQL Editor (it has elevated permissions)
--   3. Copy and paste the policies below
-- 
-- METHOD 3: Supabase CLI or API (Advanced)
--   Use Supabase CLI or Management API with service role key
-- 
-- ============================================================================
-- POLICIES TO CREATE (Copy these to Supabase Dashboard → Storage → Policies)
-- ============================================================================

-- ============================================================================
-- ⚠️  DO NOT RUN THIS FILE DIRECTLY VIA DATABASE MIGRATIONS!
-- ============================================================================
-- 
-- This file contains the SQL policies for reference only.
-- Storage policies require elevated permissions and must be created through:
--   1. Supabase Dashboard → Storage → Policies (RECOMMENDED)
--   2. Supabase SQL Editor (has elevated permissions)
--   3. Supabase CLI/API with service role key
-- 
-- See: docs/supabase/merchandise-images-bucket-policies-manual-setup.md
-- 
-- ============================================================================
-- COPY THE POLICIES BELOW TO SUPABASE DASHBOARD → STORAGE → POLICIES
-- ============================================================================

-- Policy 1: Allow Public Read Access (for public bucket)
-- Operation: SELECT | Role: public
CREATE POLICY "Allow public read access to merchandise images"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);

-- Policy 2: Allow Authenticated Users to Upload
-- Operation: INSERT | Role: authenticated | Use: WITH CHECK
CREATE POLICY "Allow authenticated users to upload merchandise images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);

-- Policy 3: Allow Authenticated Users to Update
-- Operation: UPDATE | Role: authenticated | Use: USING
CREATE POLICY "Allow authenticated users to update merchandise images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);

-- Policy 4: Allow Authenticated Users to Delete
-- Operation: DELETE | Role: authenticated | Use: USING
CREATE POLICY "Allow authenticated users to delete merchandise images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);

