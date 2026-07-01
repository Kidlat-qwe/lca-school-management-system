# Merchandise Images Bucket Setup Guide

This guide explains how to set up the `merchandise-images` storage bucket in Supabase with proper security policies.

## Overview

The merchandise images bucket stores product images for the merchandise management system. You can configure it as either:
- **Public Bucket** (Recommended for merchandise): Images are publicly accessible via direct URLs
- **Private Bucket**: Images require signed URLs (more secure but requires URL generation)

## Setup Steps

### Option 1: Public Bucket (Recommended)

**Best for:** Merchandise images that should be visible to all users

#### Step 1: Create the Bucket

1. Go to your Supabase Dashboard
2. Navigate to **Storage** → **Buckets**
3. Click **New Bucket**
4. Configure:
   - **Name**: `merchandise-images`
   - **Public bucket**: ✅ **Enable** (check this box)
   - **File size limit**: 5 MB (or your preferred limit)
   - **Allowed MIME types**: `image/jpeg, image/png, image/webp, image/gif`

#### Step 2: Set Up RLS Policies (Row Level Security)

Even though the bucket is public, you should still set up RLS policies to control who can upload/delete files.

Go to **Storage** → **Policies** → Select `merchandise-images` bucket, then add these policies:

**Policy 1: Allow Authenticated Users to Upload**
```sql
-- Policy Name: Allow authenticated users to upload merchandise images
-- Operation: INSERT

CREATE POLICY "Allow authenticated users to upload merchandise images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

**Policy 2: Allow Authenticated Users to Update**
```sql
-- Policy Name: Allow authenticated users to update merchandise images
-- Operation: UPDATE

CREATE POLICY "Allow authenticated users to update merchandise images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

**Policy 3: Allow Authenticated Users to Delete**
```sql
-- Policy Name: Allow authenticated users to delete merchandise images
-- Operation: DELETE

CREATE POLICY "Allow authenticated users to delete merchandise images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

**Policy 4: Allow Public Read Access**
```sql
-- Policy Name: Allow public read access to merchandise images
-- Operation: SELECT

CREATE POLICY "Allow public read access to merchandise images"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

### Option 2: Private Bucket (More Secure)

**Best for:** When you want stricter control over image access

#### Step 1: Create the Bucket

1. Go to your Supabase Dashboard
2. Navigate to **Storage** → **Buckets**
3. Click **New Bucket**
4. Configure:
   - **Name**: `merchandise-images`
   - **Public bucket**: ❌ **Disable** (leave unchecked)
   - **File size limit**: 5 MB
   - **Allowed MIME types**: `image/jpeg, image/png, image/webp, image/gif`

#### Step 2: Set Up RLS Policies

**Policy 1: Allow Authenticated Users to Upload**
```sql
CREATE POLICY "Allow authenticated users to upload merchandise images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

**Policy 2: Allow Authenticated Users to Update**
```sql
CREATE POLICY "Allow authenticated users to update merchandise images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

**Policy 3: Allow Authenticated Users to Delete**
```sql
CREATE POLICY "Allow authenticated users to delete merchandise images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

**Policy 4: Allow Authenticated Users to Read**
```sql
CREATE POLICY "Allow authenticated users to read merchandise images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

**Note:** With a private bucket, the frontend will automatically use signed URLs (valid for 1 year) as configured in `MerchandiseImageUpload.jsx`.

## Role-Based Access Control (Optional - More Granular)

If you want to restrict uploads to only Superadmin and Admin roles, you can use more specific policies:

```sql
-- Only allow Superadmin and Admin to upload
CREATE POLICY "Allow Superadmin and Admin to upload merchandise images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise' AND
  EXISTS (
    SELECT 1 FROM userstbl 
    WHERE userstbl.email = auth.jwt() ->> 'email' 
    AND userstbl.user_type IN ('Superadmin', 'Admin')
  )
);
```

**Note:** This requires your Firebase JWT to include the user's email, and you'll need to verify the user's role from your `userstbl` table.

## ⚠️ Important: How to Apply Policies

**Storage policies cannot be run via regular database migrations!** They require elevated permissions.

You have two options:

### Option A: Supabase Dashboard (Recommended - Easiest)
See: `docs/supabase/merchandise-images-bucket-policies-manual-setup.md` for step-by-step visual guide.

### Option B: Supabase SQL Editor
The SQL Editor in Supabase Dashboard has elevated permissions. Use this script:

```sql
-- Create bucket (if not exists via UI first, then run policies)

-- Enable RLS on storage.objects (usually enabled by default)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy 1: Public Read Access
CREATE POLICY "Allow public read access to merchandise images"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);

-- Policy 2: Authenticated Upload
CREATE POLICY "Allow authenticated users to upload merchandise images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);

-- Policy 3: Authenticated Update
CREATE POLICY "Allow authenticated users to update merchandise images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);

-- Policy 4: Authenticated Delete
CREATE POLICY "Allow authenticated users to delete merchandise images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'merchandise-images' AND
  (storage.foldername(name))[1] = 'merchandise'
);
```

## Verification

After setting up the bucket and policies:

1. **Test Upload**: Try uploading an image through the Merchandise page
2. **Check Access**: Verify the image URL is accessible
3. **Test Permissions**: Try accessing the image without authentication (if public) or with authentication (if private)

## Troubleshooting

### Error: "Bucket not found"
- Make sure the bucket name is exactly `merchandise-images` (case-sensitive)
- Verify the bucket exists in Supabase Storage

### Error: "new row violates row-level security policy"
- Check that RLS policies are correctly set up
- Verify the user is authenticated
- Ensure the file path matches the policy pattern (`merchandise/...`)

### Error: "Cannot create accessible URL"
- For public buckets: Check that the "Public bucket" setting is enabled
- For private buckets: Verify signed URL policies are working
- Check that the file was successfully uploaded

### Images not displaying
- Verify the bucket is set to public (if using public URLs)
- Check browser console for CORS errors
- Verify the image URL format is correct

## Security Best Practices

1. **File Size Limits**: Set appropriate limits (5MB recommended for images)
2. **MIME Type Restrictions**: Only allow image types
3. **Path Validation**: Policies check that files are in the `merchandise/` folder
4. **Authentication Required**: Only authenticated users can upload/delete
5. **Regular Cleanup**: Consider implementing cleanup for orphaned images

## File Naming Convention

The system uses this naming pattern:
```
merchandise/{sanitized_name}_{merchandise_id}_{timestamp}.{extension}
```

Example:
```
merchandise/lca_uniform_123_1699123456789.jpg
```

This ensures:
- Files are organized in the `merchandise/` folder
- Unique filenames prevent conflicts
- Easy identification of merchandise type and ID

