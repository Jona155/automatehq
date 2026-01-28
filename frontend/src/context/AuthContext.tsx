import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import client from '../api/client';
import type { User, Business, AuthResponse } from '../types';

interface LoginCredentials {
  email: string;
  password: string;
}

interface AuthContextType {
  user: User | null;
  business: Business | null;
  token: string | null;
  login: (credentials: LoginCredentials) => Promise<User>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  // Derive business from user
  const business = user?.business || null;

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        try {
          const response = await client.get<{ data: User }>('/auth/me');
          setUser(response.data.data);
          setToken(storedToken);
        } catch (error) {
          console.error("Failed to fetch user", error);
          localStorage.removeItem('token');
          setToken(null);
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async ({ email, password }: LoginCredentials) => {
    try {
      const response = await client.post<AuthResponse>('/auth/login', { email, password });
      if (response.data.success) {
        const { token: newToken, user: newUser } = response.data.data;
        localStorage.setItem('token', newToken);
        setToken(newToken);
        setUser(newUser);
        return newUser;
      } else {
        throw new Error(response.data.message || 'Login failed');
      }
    } catch (error: any) {
      // Re-throw the error so UI can handle it (display message)
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      business,
      token,
      login,
      logout,
      isAuthenticated: !!user,
      isLoading
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
