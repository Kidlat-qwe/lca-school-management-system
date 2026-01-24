# Physical School Management System - Frontend

## Overview

This is the frontend application for the Physical School Management System, built with React, Tailwind CSS, and Firebase Authentication.

## Technology Stack

- **Framework**: React 19
- **Styling**: Tailwind CSS
- **Routing**: React Router DOM
- **Authentication**: Firebase Auth
- **Build Tool**: Vite

## Project Structure

```
frontend/
├── src/
│   ├── components/          # Reusable components
│   │   └── ProtectedRoute.jsx
│   ├── config/              # Configuration files
│   │   ├── firebase.js      # Firebase client config
│   │   └── api.js           # API configuration
│   ├── contexts/            # React contexts
│   │   └── AuthContext.jsx  # Authentication context
│   ├── pages/               # Page components
│   │   ├── Login.jsx        # Login page
│   │   ├── superadmin/      # Superadmin pages
│   │   ├── admin/           # Admin pages
│   │   ├── finance/         # Finance pages
│   │   ├── teacher/         # Teacher pages
│   │   └── student/         # Student pages
│   ├── App.jsx              # Main app component
│   ├── main.jsx             # Entry point
│   └── index.css            # Global styles
├── public/                  # Static assets
├── tailwind.config.js       # Tailwind configuration
├── postcss.config.js        # PostCSS configuration
└── vite.config.js           # Vite configuration
```

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. **Install dependencies**

```bash
npm install
```

2. **Set up environment variables**

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your Firebase configuration:

```env
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id

VITE_API_BASE_URL=http://localhost:3000/api/v1
```

3. **Get Firebase Configuration**

- Go to [Firebase Console](https://console.firebase.google.com)
- Select your project
- Go to Project Settings > General
- Scroll down to "Your apps" section
- Click on the Web icon (`</>`) to add a web app
- Copy the configuration values to your `.env` file

### Running the Application

**Development mode:**

```bash
npm run dev
```

The application will start on `http://localhost:5173` (or the next available port).

**Build for production:**

```bash
npm run build
```

**Preview production build:**

```bash
npm run preview
```

## Features

### Authentication

- Firebase Authentication integration
- Email/password login
- Protected routes based on user roles
- Automatic token management
- Session persistence

### Responsive Design

- Mobile-first approach
- Fully responsive on all screen sizes
- Tailwind CSS utility classes
- Modern, clean UI

### User Roles

The system supports multiple user roles:
- **Superadmin**: Full system access
- **Admin**: Branch-level access
- **Finance**: Financial data access
- **Teacher**: Class and student management
- **Student**: Personal profile and classes

## Usage

### Login Flow

1. User enters email and password
2. Firebase authenticates the user
3. Backend API verifies the token
4. User is redirected to their role-specific dashboard

### Protected Routes

Routes are protected using the `ProtectedRoute` component:

```jsx
<ProtectedRoute allowedRoles={['Superadmin', 'Admin']}>
  <YourComponent />
</ProtectedRoute>
```

### Using Authentication Context

```jsx
import { useAuth } from '../contexts/AuthContext';

function MyComponent() {
  const { userInfo, login, logout } = useAuth();
  
  // Access user info
  console.log(userInfo.userType);
  
  // Logout
  const handleLogout = () => {
    logout();
  };
}
```

### Making API Requests

```jsx
import { apiRequest } from '../config/api';

// GET request
const users = await apiRequest('/users');

// POST request
const newUser = await apiRequest('/users', {
  method: 'POST',
  body: JSON.stringify({ name: 'John' }),
});
```

## Styling

### Tailwind CSS

The project uses Tailwind CSS for styling. Custom utility classes are defined in `src/index.css`:

- `.btn-primary` - Primary button style
- `.btn-secondary` - Secondary button style
- `.input-field` - Input field style
- `.label-field` - Label style

### Custom Colors

Primary color palette is defined in `tailwind.config.js` and can be customized.

## Development

### Code Style

- Use functional components with hooks
- Follow React best practices
- Use meaningful component and variable names
- Keep components small and focused

### Adding New Pages

1. Create a new component in the appropriate folder under `src/pages/`
2. Add the route in `src/App.jsx`
3. Use `ProtectedRoute` if authentication is required

### Adding New Components

Create reusable components in `src/components/` and import them where needed.

## Troubleshooting

### Firebase Configuration Issues

- Verify all environment variables are set correctly
- Check that Firebase project has Authentication enabled
- Ensure email/password authentication is enabled in Firebase Console

### API Connection Issues

- Verify backend server is running
- Check `VITE_API_BASE_URL` in `.env`
- Check browser console for CORS errors

### Build Issues

- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Clear Vite cache: `rm -rf node_modules/.vite`

## License

ISC
