# Backend Scripts

This directory contains utility scripts for managing and maintaining the Physical School Management System backend.

## Available Scripts

### `listFirebaseUsers.js`

Lists all users registered in Firebase Authentication.

**Usage:**
```bash
# List all users (default: table format, max 1000 users)
node scripts/listFirebaseUsers.js

# List with custom limit
node scripts/listFirebaseUsers.js --limit 500

# Output in JSON format
node scripts/listFirebaseUsers.js --format json

# Filter by email (partial match, case-insensitive)
node scripts/listFirebaseUsers.js --email "@gmail.com"

# Get specific user by UID
node scripts/listFirebaseUsers.js --uid "abc123xyz"

# Show help
node scripts/listFirebaseUsers.js --help
```

**Options:**
- `--limit <number>`: Maximum number of users to retrieve (default: 1000)
- `--format <json|table>`: Output format (default: table)
- `--email <email>`: Filter by email (partial match, case-insensitive)
- `--uid <uid>`: Get specific user by UID
- `--help, -h`: Show help message

**Output Information:**
- User UID
- Email address
- Email verification status
- Display name
- Phone number
- Account status (disabled/enabled)
- Creation timestamp
- Last sign-in timestamp
- Authentication providers
- Custom claims (if any)

**Notes:**
- The script uses Firebase Admin SDK, so it requires proper Firebase Admin credentials to be configured
- Firebase Admin SDK has a limit of 1000 users per page, so pagination is handled automatically
- The script respects the `--limit` option but may retrieve more users if pagination is needed

## Adding New Scripts

When adding new scripts to this directory:

1. Follow the ES module syntax (import/export)
2. Include proper error handling
3. Add command-line argument parsing if needed
4. Include a `--help` option
5. Update this README with script documentation
6. Use descriptive console output with emojis for better readability

