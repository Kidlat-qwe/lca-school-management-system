# SMTP Email Configuration Guide

This guide will help you set up SMTP email service for sending invoice emails to students when they make payments.

## Step-by-Step Setup for Gmail

### Step 1: Enable 2-Factor Authentication (2FA) on Your Gmail Account

1. Go to your Google Account: https://myaccount.google.com/
2. Click on **Security** in the left sidebar
3. Under "Signing in to Google", find **2-Step Verification**
4. Click on it and follow the prompts to enable 2FA
   - You'll need to verify your phone number
   - Google will send you a verification code

### Step 2: Generate an App Password

1. After enabling 2FA, go back to **Security** settings
2. Under "Signing in to Google", you should now see **App passwords** (this only appears after 2FA is enabled)
3. Click on **App passwords**
4. You may need to sign in again
5. Select **Mail** as the app type
6. Select **Other (Custom name)** as the device type
7. Enter a name like "School Management System" or "PSMS Email Service"
8. Click **Generate**
9. **IMPORTANT**: Copy the 16-character password that appears (it will look like: `abcd efgh ijkl mnop`)
   - This password will only be shown once, so save it securely
   - Remove any spaces when using it (it should be 16 characters without spaces)

### Step 3: Configure Your .env File

1. Open `backend/.env` file in your project
2. Find the SMTP configuration section (should be at the bottom)
3. Update the following values:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-actual-email@gmail.com
SMTP_PASSWORD=your-16-character-app-password
SMTP_FROM=your-actual-email@gmail.com
```

**Example:**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=littlechampions@gmail.com
SMTP_PASSWORD=abcdefghijklmnop
SMTP_FROM=littlechampions@gmail.com
```

**Important Notes:**
- Replace `your-actual-email@gmail.com` with your actual Gmail address
- Replace `your-16-character-app-password` with the App Password you generated in Step 2
- Make sure there are NO spaces in the App Password
- The `SMTP_FROM` should be the same as `SMTP_USER` (your Gmail address)

### Step 4: Save and Restart Your Server

1. Save the `.env` file
2. Restart your backend server:
   ```bash
   # Stop the current server (Ctrl+C if running)
   # Then start it again
   npm run dev
   # or
   npm start
   ```

### Step 5: Test the Configuration

1. Make a test payment in your system
2. Check the server console logs for email status:
   - ✅ Success: `Invoice email sent successfully to student@email.com for invoice 123`
   - ❌ Error: `Error sending invoice email to student@email.com: [error message]`
3. Check the student's email inbox (and spam folder) for the invoice email

## Alternative Email Providers

### Outlook/Hotmail

```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASSWORD=your-password
SMTP_FROM=your-email@outlook.com
```

### Yahoo Mail

```env
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@yahoo.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=your-email@yahoo.com
```

### SpaceMail / Hosting Email Service

If you're using SpaceMail or similar hosting email service (cPanel, Plesk, etc.):

**Option 1: Using Port 587 (TLS - Recommended)**
```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@yourdomain.com
SMTP_PASSWORD=your-email-password
SMTP_FROM=your-email@yourdomain.com
```

**Option 2: Using Port 465 (SSL)**
```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@yourdomain.com
SMTP_PASSWORD=your-email-password
SMTP_FROM=your-email@yourdomain.com
```

**Option 3: Using Port 25 (if 587/465 are blocked)**
```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=25
SMTP_SECURE=false
SMTP_USER=your-email@yourdomain.com
SMTP_PASSWORD=your-email-password
SMTP_FROM=your-email@yourdomain.com
```

**Common SpaceMail/Hosting SMTP Settings:**
- **SMTP Host**: Usually `mail.yourdomain.com` or `smtp.yourdomain.com`
- **Port**: 587 (TLS) or 465 (SSL) - check with your hosting provider
- **Username**: Your full email address (e.g., `noreply@yourdomain.com`)
- **Password**: Your email account password (the one you use to login to webmail)
- **From Address**: Can be the same email or any alias you've set up

**To find your SpaceMail SMTP settings:**
1. Log into your hosting control panel (cPanel, Plesk, etc.)
2. Go to Email Accounts section
3. Look for "Email Client Configuration" or "SMTP Settings"
4. You'll find the SMTP server, port, and authentication details there

### Custom SMTP Server

If you have a custom email server (like from your hosting provider):

```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@yourdomain.com
```

For SSL/TLS (port 465):
```env
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@yourdomain.com
```

## Troubleshooting

### Error: "Invalid login credentials"
- **Solution**: Make sure you're using an App Password (not your regular Gmail password)
- Verify 2FA is enabled on your Gmail account
- Check that there are no spaces in the App Password

### Error: "Connection timeout"
- **Solution**: Check your firewall settings
- Verify the SMTP_HOST and SMTP_PORT are correct
- Try using port 465 with SMTP_SECURE=true

### Error: "SMTP configuration is incomplete"
- **Solution**: Make sure all SMTP variables are set in your `.env` file
- Check for typos in variable names
- Restart your server after changing `.env`

### Emails going to spam
- **Solution**: 
  - Use a professional email address (not a personal Gmail if possible)
  - Add SPF and DKIM records to your domain (if using custom domain)
  - Ask recipients to mark emails as "Not Spam"

### Email not sending but no error
- **Solution**: 
  - Check server console logs for detailed error messages
  - Verify the student has an email address in the database
  - Check that the email sending is happening asynchronously (it won't block the payment response)

## Security Best Practices

1. **Never commit `.env` file to Git**
   - Make sure `.env` is in your `.gitignore` file
   
2. **Use App Passwords, not regular passwords**
   - Regular passwords are less secure and may not work with SMTP

3. **Rotate App Passwords regularly**
   - Generate new App Passwords periodically for better security

4. **Use environment-specific configurations**
   - Different SMTP settings for development and production

## Verification

To verify your SMTP connection is working, you can check the server logs when it starts. The email service will attempt to verify the connection. Look for:
- ✅ `SMTP server is ready to send emails` - Connection successful
- ❌ `SMTP connection error: [error]` - Connection failed, check your settings

## Need Help?

If you encounter issues:
1. Check the server console logs for detailed error messages
2. Verify all SMTP settings in `.env` are correct
3. Test with a simple email client (like Outlook or Thunderbird) using the same SMTP settings
4. Contact your email provider's support if issues persist

