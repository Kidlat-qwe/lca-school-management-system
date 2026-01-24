import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase configuration for Physical School Management System
const firebaseConfig = {
  apiKey: "AIzaSyByiYHn3uHuYLqAbf5Xrfb9NsIBfUz3fyE",
  authDomain: "psms-b9ca7.firebaseapp.com",
  projectId: "psms-b9ca7",
  storageBucket: "psms-b9ca7.firebasestorage.app",
  messagingSenderId: "404235449908",
  appId: "1:404235449908:web:b5574f8799177ed4d0bc61"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Verify Firebase is initialized correctly (development only)
if (process.env.NODE_ENV === 'development') {
  console.log('🔥 Firebase initialized:', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
  });
}

export default app;

