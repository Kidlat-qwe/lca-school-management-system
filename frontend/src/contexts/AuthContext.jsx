import { createContext, useContext, useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { auth } from '../config/firebase';
import { apiRequest } from '../config/api';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [originalUserInfo, setOriginalUserInfo] = useState(null);

  // Signup function
  const signup = async (email, password, userData, isCurrentUser = true) => {
    let firebaseUser = null;
    
    try {
      // If creating a user while already logged in (e.g., superadmin creating personnel),
      // use the backend endpoint that creates users without signing them in
      if (!isCurrentUser) {
        console.log('💼 Superadmin creating personnel via Admin SDK...', { email, user_type: userData.user_type });
        
        // Use the backend endpoint that creates users without signing them in
        const response = await apiRequest('/auth/create-user', {
          method: 'POST',
          body: JSON.stringify({
            email: email,
            password: password,
            full_name: userData.full_name,
            user_type: userData.user_type || 'Student',
            branch_id: userData.branch_id || null,
            gender: userData.gender || null,
            date_of_birth: userData.date_of_birth || null,
            phone_number: userData.phone_number || null,
            level_tag: userData.level_tag || null,
          }),
        });
        
        console.log('✅ Personnel created successfully:', response.user);
        return { success: true, user: response.user };
      }
      
      // Step 1: Create user in Firebase (Firebase handles password storage and encryption)
      // Note: This will automatically sign in the new user
      console.log('🔐 Creating user in Firebase...', { 
        email, 
        user_type: userData.user_type,
        projectId: auth.app.options.projectId,
        authDomain: auth.app.options.authDomain
      });
      
      // Verify auth is properly configured before attempting signup
      if (!auth.app.options.projectId || !auth.app.options.apiKey) {
        throw new Error('Firebase Authentication is not properly initialized. Please check your Firebase configuration.');
      }
      
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      firebaseUser = userCredential.user;
      console.log('✅ User created in Firebase:', firebaseUser.uid);
      
      // Step 2: Get Firebase token for the new user (needed for sync)
      const newUserToken = await firebaseUser.getIdToken();
      
      // Step 3: Sync user with PostgreSQL database
      // Use the new user's token for the sync request
      console.log('💾 Syncing user with PostgreSQL database...', { 
        firebase_uid: firebaseUser.uid, 
        email, 
        full_name: userData.full_name,
        user_type: userData.user_type,
        branch_id: userData.branch_id,
        level_tag: userData.level_tag 
      });
      const syncData = {
        firebase_uid: firebaseUser.uid,
        email: email,
        full_name: userData.full_name,
        user_type: userData.user_type || 'Student',
        branch_id: userData.branch_id || null,
        gender: userData.gender || null,
        date_of_birth: userData.date_of_birth || null,
        phone_number: userData.phone_number || null,
        level_tag: userData.level_tag || null,
      };
      
      // Temporarily set the new user's token for the API request
      localStorage.setItem('firebase_token', newUserToken);
      
      const response = await apiRequest('/auth/sync-user', {
        method: 'POST',
        body: JSON.stringify(syncData),
      });
      
      console.log('✅ User synced with PostgreSQL:', response.user);
      
      // This is the user signing themselves up, keep them signed in
      localStorage.setItem('firebase_token', newUserToken);
      const userInfoData = {
        ...response.user,
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        emailVerified: firebaseUser.emailVerified,
      };
      setUserInfo(userInfoData);
      return { success: true, user: userInfoData };
    } catch (error) {
      console.error('❌ Signup error:', error);
      
      // Handle Firebase-specific errors
      if (error.code === 'auth/email-already-in-use' || error.message?.includes('already registered')) {
        throw new Error('This email is already registered. Please use a different email.');
      } else if (error.code === 'auth/weak-password') {
        throw new Error('Password is too weak. Please use a stronger password.');
      } else if (error.code === 'auth/invalid-email') {
        throw new Error('Invalid email address. Please check and try again.');
      }
      
      throw error;
    }
  };

  // Login function
  const login = async (email, password) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      
      // Store token
      localStorage.setItem('firebase_token', token);
      
      // Verify token and get user info from backend (POST request as per backend route)
      try {
        const response = await apiRequest('/auth/verify', {
          method: 'POST',
        });
        if (response && response.user) {
          setUserInfo(response.user);
          return { success: true, user: response.user };
        }
      } catch (verifyError) {
        console.warn('Verify endpoint failed, user may not be in database yet:', verifyError);
        // Return minimal user info from Firebase
        const minimalUser = {
          uid: userCredential.user.uid,
          email: userCredential.user.email,
          emailVerified: userCredential.user.emailVerified,
        };
        setUserInfo(minimalUser);
        return { success: true, user: minimalUser };
      }
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  // Logout function
  const logout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('firebase_token');
      setCurrentUser(null);
      setUserInfo(null);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  };

  // Get current user token
  const getToken = async () => {
    if (currentUser) {
      return await currentUser.getIdToken();
    }
    return null;
  };

  // Refresh user info from backend
  const refreshUserInfo = async () => {
    if (!currentUser) return;
    
    try {
      const response = await apiRequest('/auth/verify', {
        method: 'POST',
      });
      if (response && response.user) {
        // Normalize user data to include both camelCase and snake_case for compatibility
        const normalizedUser = {
          ...response.user,
          user_id: response.user.userId || response.user.user_id,
          full_name: response.user.fullName || response.user.full_name,
          user_type: response.user.userType || response.user.user_type,
          branch_id: response.user.branchId || response.user.branch_id,
          profile_picture_url: response.user.profile_picture_url || null,
        };
        console.log('Refreshing user info:', normalizedUser);
        setUserInfo(normalizedUser);
        return normalizedUser;
      }
    } catch (error) {
      console.error('Error refreshing user info:', error);
      throw error;
    }
  };

  // Listen for auth state changes
  useEffect(() => {
    let isMounted = true;
    let skipVerify = false; // Flag to skip verify if userInfo was just set by signup/login
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;
      
      setCurrentUser(user);
      
      if (user) {
        try {
          // Force refresh token so backend always gets a valid one (avoids 401 from expired token)
          const token = await user.getIdToken(true);
          localStorage.setItem('firebase_token', token);
          
          // If we're creating a user (superadmin creating personnel), don't update userInfo
          // The signup function will handle restoring the original session
          if (isCreatingUser) {
            console.log('⏸️ Skipping userInfo update - creating user in progress');
            return;
          }
          
          // Only try to verify if we don't have complete user info
          // Skip verify if it was just set by signup/login (they handle it themselves)
          const currentUserInfo = userInfo;
          if (!currentUserInfo || !currentUserInfo.userId) {
            try {
              // Pass the fresh token so verify never uses a stale one from localStorage
              const response = await apiRequest('/auth/verify', { method: 'POST' }, token);
              if (response && response.user && isMounted) {
                setUserInfo(response.user);
              }
            } catch (error) {
              const is401 = error.response?.status === 401 || error.message?.includes('Invalid or expired token');
              if (is401 && isMounted) {
                // Backend rejected the token (expired or server config). Sign out so user gets a clean login and can try again.
                localStorage.removeItem('firebase_token');
                signOut(auth).catch(() => {});
                setUserInfo(null);
              }
              if (error.message && !error.message.includes('404') && !is401) {
                console.warn('Could not verify user with backend:', error.message);
              }
            }
          }
        } catch (error) {
          console.error('Error in auth state change:', error);
          if (isMounted && !userInfo && !isCreatingUser) {
            setUserInfo(null);
          }
        }
      } else {
        // User signed out
        localStorage.removeItem('firebase_token');
        if (isMounted) {
          // If we're creating a user, don't clear userInfo - it will be restored by signup function
          if (!isCreatingUser) {
            setUserInfo(null);
          }
        }
      }
      
      if (isMounted) {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isCreatingUser, userInfo]); // Include isCreatingUser and userInfo in deps

  const value = {
    currentUser,
    userInfo,
    signup,
    login,
    logout,
    getToken,
    refreshUserInfo,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

