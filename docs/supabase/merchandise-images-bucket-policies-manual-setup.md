# Manual Setup: Merchandise Images Bucket Policies

Since storage policies require elevated permissions, you need to set them up manually through the Supabase Dashboard.

## Quick Setup (5 minutes)

### Step 1: Create the Bucket

1. Go to **Supabase Dashboard** → **Storage** → **Buckets**
2. Click **"New Bucket"**
3. Configure:
   - **Name**: `merchandise-images`
   - **Public bucket**: ✅ **Enable** (check this)
   - **File size limit**: `5242880` (5 MB in bytes)
   - **Allowed MIME types**: `image/jpeg,image/png,image/webp,image/gif`
4. Click **"Create bucket"**

### Step 2: Add Policies via Dashboard

1. Go to **Storage** → **Policies**
2. Select the **`merchandise-images`** bucket from the dropdown
3. Click **"New Policy"** for each policy below

#### Policy 1: Public Read Access

- **Policy name**: `Allow public read access to merchandise images`
- **Allowed operation**: `SELECT`
- **Target roles**: `public`
- **Policy definition** (USING expression):
```sql
bucket_id = 'merchandise-images' AND
(storage.foldername(name))[1] = 'merchandise'
```

#### Policy 2: Authenticated Upload

- **Policy name**: `Allow authenticated users to upload merchandise images`
- **Allowed operation**: `INSERT`
- **Target roles**: `authenticated`
- **Policy definition** (WITH CHECK expression):
```sql
bucket_id = 'merchandise-images' AND
(storage.foldername(name))[1] = 'merchandise'
```

#### Policy 3: Authenticated Update

- **Policy name**: `Allow authenticated users to update merchandise images`
- **Allowed operation**: `UPDATE`
- **Target roles**: `authenticated`
- **Policy definition** (USING expression):
```sql
bucket_id = 'merchandise-images' AND
(storage.foldername(name))[1] = 'merchandise'
```

#### Policy 4: Authenticated Delete

- **Policy name**: `Allow authenticated users to delete merchandise images`
- **Allowed operation**: `DELETE`
- **Target roles**: `authenticated`
- **Policy definition** (USING expression):
```sql
bucket_id = 'merchandise-images' AND
(storage.foldername(name))[1] = 'merchandise'
```

## Alternative: Using Supabase SQL Editor

If you prefer SQL, you can use the Supabase SQL Editor (which has elevated permissions):

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Click **"New Query"**
3. Paste the following SQL:

```sql
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

4. Click **"Run"**

## Verification

After setting up the policies:

1. **Test Upload**: Try uploading an image through the Merchandise page
2. **Check Console**: Open browser DevTools → Console, look for any errors
3. **Verify Access**: The uploaded image should be accessible via its public URL

## Troubleshooting

### Error: "Bucket not found"
- Make sure the bucket name is exactly `merchandise-images` (case-sensitive)
- Verify the bucket exists in Storage → Buckets

### Error: "new row violates row-level security policy"
- Check that all 4 policies are created
- Verify you're authenticated when testing
- Ensure the file path starts with `merchandise/`

### Images not displaying
- Check that "Public bucket" is enabled in bucket settings
- Verify the public read policy is active
- Check browser console for CORS or 403 errors

## Visual Guide

### Creating Policies in Dashboard

1. **Navigate to Policies**:
   ```
   Dashboard → Storage → Policies → Select "merchandise-images"
   ```

2. **For each policy, click "New Policy"**:
   - Fill in the policy name
   - Select the operation (SELECT, INSERT, UPDATE, DELETE)
   - Select target role (public or authenticated)
   - Paste the policy definition in the appropriate field:
     - **USING** for SELECT, UPDATE, DELETE
     - **WITH CHECK** for INSERT

3. **Save the policy**

That's it! Your bucket is now configured with proper security policies.

