import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut, 
  onAuthStateChanged,
  signInWithCustomToken,
  fetchSignInMethodsForEmail
} from 'firebase/auth';
import { auth } from '../config/firebase';
import { apiRequest } from '../config/api';
import { clearAllApiCache, setApiCacheUserScope } from '../utils/apiCache/apiCache';
import { warmupReferenceCache } from '../utils/apiCache/warmupReferenceCache';

const applyUserSessionCache = (user) => {
  const userId = user?.user_id ?? user?.userId ?? user?.uid ?? 'anonymous';
  setApiCacheUserScope(userId);
  warmupReferenceCache(user);
};

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
  const isCreatingUserRef = useRef(false);
  const userInfoRef = useRef(null);
  const loginInProgressRef = useRef(false);

  const setUserInfoAndRef = (nextUserInfo) => {
    userInfoRef.current = nextUserInfo;
    setUserInfo(nextUserInfo);
  };

  useEffect(() => {
    isCreatingUserRef.current = isCreatingUser;
  }, [isCreatingUser]);

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
            lrn: userData.lrn !== undefined && userData.lrn !== null && String(userData.lrn).trim()
              ? String(userData.lrn).trim().slice(0, 50)
              : null,
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
      setUserInfoAndRef(userInfoData);
      applyUserSessionCache(userInfoData);
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
    loginInProgressRef.current = true;
    try {
      const emailTrim = String(email || '').trim();
      const passwordValue = String(password || '');

      const userCredential = await signInWithEmailAndPassword(auth, emailTrim, passwordValue);
      const token = await userCredential.user.getIdToken();

      localStorage.setItem('firebase_token', token);

      const response = await apiRequest('/auth/verify', { method: 'POST' }, token);
      if (response?.user) {
        const normalizedUser = {
          ...response.user,
          user_id: response.user.userId || response.user.user_id,
          userId: response.user.userId || response.user.user_id,
          full_name: response.user.fullName || response.user.full_name,
          fullName: response.user.fullName || response.user.full_name,
          user_type: response.user.userType || response.user.user_type,
          userType: response.user.userType || response.user.user_type,
          branch_id: response.user.branchId ?? response.user.branch_id,
          branchId: response.user.branchId ?? response.user.branch_id,
        };
        setUserInfoAndRef(normalizedUser);
        applyUserSessionCache(normalizedUser);
        return { success: true, user: normalizedUser };
      }

      throw new Error('Could not load your account profile. Please try again.');
    } catch (error) {
      console.error('Login error:', error);

      const code = error?.code || '';
      if (code === 'auth/invalid-email') {
        throw new Error('Invalid email address.');
      }
      if (code === 'auth/user-disabled') {
        throw new Error('This account has been disabled. Please contact your administrator.');
      }
      if (code === 'auth/user-not-found') {
        throw new Error('User does not exist.');
      }
      if (code === 'auth/wrong-password') {
        throw new Error('Wrong password.');
      }
      if (code === 'auth/quota-exceeded') {
        throw new Error(
          'Authentication service is temporarily busy. Please wait a minute and try again.'
        );
      }

      // Newer Firebase SDKs may return `auth/invalid-credential` for wrong password OR unknown email.
      if (code === 'auth/invalid-credential') {
        try {
          const methods = await fetchSignInMethodsForEmail(auth, String(email || '').trim());
          if (!methods || methods.length === 0) {
            try {
              const existsRes = await apiRequest('/auth/check-email', {
                method: 'POST',
                body: { email: String(email || '').trim() },
              });
              if (existsRes?.exists) throw new Error('Wrong password.');
              throw new Error('User does not exist.');
            } catch (dbErr) {
              if (dbErr instanceof Error) throw dbErr;
            }
          } else {
            throw new Error('Wrong password.');
          }
        } catch (methodsErr) {
          if (methodsErr instanceof Error) throw methodsErr;
        }
      }

      if (error.response?.status === 401) {
        localStorage.removeItem('firebase_token');
        await signOut(auth).catch(() => {});
        throw new Error('Session could not be verified. Please try signing in again.');
      }

      if (error instanceof Error && error.message) {
        throw error;
      }

      throw new Error('Failed to login. Please check your credentials.');
    } finally {
      loginInProgressRef.current = false;
    }
  };

  // Logout function
  const logout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('firebase_token');
      clearAllApiCache();
      setCurrentUser(null);
      setUserInfoAndRef(null);
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
        setUserInfoAndRef(normalizedUser);
        applyUserSessionCache(normalizedUser);
        return normalizedUser;
      }
    } catch (error) {
      console.error('Error refreshing user info:', error);
      throw error;
    }
  };

  // Listen for auth state changes (subscribe once — avoid re-subscribe loops that hammer token refresh).
  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      setCurrentUser(user);

      if (user) {
        try {
          if (loginInProgressRef.current) {
            if (isMounted) setLoading(false);
            return;
          }

          // Use the SDK cache; only refresh when the token is expired or near expiry.
          // Forcing refresh on every auth callback can trigger auth/quota-exceeded.
          let token;
          try {
            token = await user.getIdToken();
          } catch (tokenError) {
            if (tokenError?.code === 'auth/quota-exceeded') {
              token = localStorage.getItem('firebase_token');
              if (!token) throw tokenError;
              console.warn(
                'Firebase token refresh quota exceeded; continuing with the last stored token.'
              );
            } else {
              throw tokenError;
            }
          }
          localStorage.setItem('firebase_token', token);

          if (isCreatingUserRef.current) {
            console.log('⏸️ Skipping userInfo update - creating user in progress');
            return;
          }

          const currentUserInfo = userInfoRef.current;
          const hasEstablishedSession = (info) =>
            Boolean(
              info &&
                (info.userId || info.user_id) &&
                (info.userType || info.user_type)
            );

          if (!hasEstablishedSession(currentUserInfo)) {
            try {
              const response = await apiRequest('/auth/verify', { method: 'POST' }, token);
              if (response?.user && isMounted) {
                const normalizedUser = {
                  ...response.user,
                  user_id: response.user.userId || response.user.user_id,
                  userId: response.user.userId || response.user.user_id,
                  user_type: response.user.userType || response.user.user_type,
                  userType: response.user.userType || response.user.user_type,
                  branch_id: response.user.branchId ?? response.user.branch_id,
                  branchId: response.user.branchId ?? response.user.branch_id,
                };
                setUserInfoAndRef(normalizedUser);
                applyUserSessionCache(normalizedUser);
              }
            } catch (error) {
              const is401 =
                error.response?.status === 401 || error.message?.includes('Invalid or expired token');
              if (is401 && isMounted && !hasEstablishedSession(userInfoRef.current)) {
                localStorage.removeItem('firebase_token');
                clearAllApiCache();
                signOut(auth).catch(() => {});
                setUserInfoAndRef(null);
              }
              if (error.message && !error.message.includes('404') && !is401) {
                console.warn('Could not verify user with backend:', error.message);
              }
            }
          }
        } catch (error) {
          console.error('Error in auth state change:', error);
          if (isMounted && !userInfoRef.current && !isCreatingUserRef.current) {
            setUserInfoAndRef(null);
          }
        }
      } else {
        localStorage.removeItem('firebase_token');
        if (isMounted && !isCreatingUserRef.current && !loginInProgressRef.current) {
          clearAllApiCache();
          setUserInfoAndRef(null);
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
  }, []);

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

