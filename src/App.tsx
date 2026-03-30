import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User, sendPasswordResetEmail, signOut as secondarySignOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, onSnapshot, orderBy, deleteDoc, getDocs, limit, updateDoc, writeBatch } from 'firebase/firestore';
import { auth, db, secondaryAuth, firebaseConfig } from './firebase';
import { UserProfile, UserRole, TimesheetEntry } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LogOut, LayoutDashboard, FileText, Users, Clock, Plus, Download, Trash2, ChevronLeft, ChevronRight, Menu, X, Check, Mail, Lock, User as UserIcon, Home, DollarSign } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Calculator as CalcIcon } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, parseISO, startOfWeek, addDays, isSameDay, getDay, subDays } from 'date-fns';
import { cn } from './lib/utils';
import { TimeEntryModal } from './components/TimeEntryModal';
import { BulkInputModal } from './components/BulkInputModal';
import { Calculator } from './components/Calculator';
import { calculateBreakdown, isFriday, getFridayBenefit } from './lib/hours';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  loading?: boolean;
}

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, loading }: ConfirmModalProps) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
          <p className="text-gray-600">{message}</p>
        </div>
        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg font-bold text-gray-600 hover:bg-gray-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="bg-red-600 text-white py-2 px-4 rounded-lg font-bold hover:bg-red-700 transition-all shadow-md shadow-red-100 disabled:opacity-50"
          >
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Types & Constants ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

// --- Context ---
interface SettingsContextType {
  companyName: string;
  updateCompanyName: (name: string) => Promise<void>;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within a SettingsProvider');
  return context;
};

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [companyName, setCompanyName] = useState('Company Timesheet Management');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        setCompanyName(snapshot.data().companyName);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const updateCompanyName = async (name: string) => {
    if (!name.trim()) {
      alert('Please enter a valid company name.');
      return;
    }
    try {
      await setDoc(doc(db, 'settings', 'global'), { companyName: name });
      alert('Company name updated successfully!');
    } catch (err) {
      console.error('Update company name error:', err);
      alert('Failed to update company name. Check permissions.');
    }
  };

  return (
    <SettingsContext.Provider value={{ companyName, updateCompanyName, loading }}>
      {children}
    </SettingsContext.Provider>
  );
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (email: string, pass: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

// --- Components ---

const HomePage = () => {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && profile && !loading) {
      if (profile.role === 'admin') navigate('/admin');
      else navigate('/dashboard-view');
    }
  }, [user, profile, loading, navigate]);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center lg:pt-32">
          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-200 animate-bounce">
              <Clock className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="mx-auto max-w-4xl font-display text-5xl font-extrabold tracking-tight text-slate-900 sm:text-7xl">
            Streamline Your <span className="text-blue-600">Company Timesheets</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg tracking-tight text-slate-700">
            The ultimate solution for tracking worker hours, managing weekly benefits, and generating professional reports. Built for efficiency and precision.
          </p>
          <div className="mt-10 flex justify-center gap-x-6">
            <Link
              to="/login"
              className="group inline-flex items-center justify-center rounded-full py-3 px-8 text-sm font-semibold focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-blue-600 shadow-lg shadow-blue-100 transition-all hover:scale-105"
            >
              Get Started Now
            </Link>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                <LayoutDashboard className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Real-time Tracking</h3>
              <p className="text-slate-600">Workers can easily log their hours and see their weekly progress in real-time.</p>
            </div>
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-6">
                <Users className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Admin Control</h3>
              <p className="text-slate-600">Powerful admin panel for bulk entries, worker management, and detailed reporting.</p>
            </div>
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-6">
                <FileText className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Instant Reports</h3>
              <p className="text-slate-600">Generate PDF and CSV reports with a single click for payroll and documentation.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Clock className="w-6 h-6 text-blue-600" />
            <span className="text-lg font-bold text-slate-900">TimeSheet Pro</span>
          </div>
          <p className="text-slate-500 text-sm">© 2026 TimeSheet Pro. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-gray-500 font-medium">Loading your workspace...</p>
    </div>
  </div>
);

const Navbar = () => {
  const { profile, logout, isAdmin } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center gap-2">
            <Clock className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-bold text-gray-900 tracking-tight">TimeSheet Pro</span>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            <Link to="/" className="text-gray-600 hover:text-blue-600 font-medium flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4" /> Dashboard
            </Link>
            {isAdmin && (
              <>
                <Link to="/admin" className="text-gray-600 hover:text-blue-600 font-medium flex items-center gap-2">
                  <Users className="w-4 h-4" /> Admin Panel
                </Link>
                <Link to="/reports" className="text-gray-600 hover:text-blue-600 font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Reports
                </Link>
                <Link to="/salary-sheet" className="text-gray-600 hover:text-blue-600 font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4" /> Salary Sheet
                </Link>
              </>
            )}
            <div className="flex items-center gap-4 pl-6 border-l border-gray-200">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">{profile?.displayName || profile?.email?.replace('@company.com', '')}</p>
                <p className="text-xs text-gray-500 capitalize">{profile?.role}</p>
              </div>
              <button
                onClick={logout}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Mobile Menu Toggle */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {isMenuOpen && (
        <div className="md:hidden bg-white border-b border-gray-200 px-4 pt-2 pb-4 space-y-2">
          <Link
            to="/"
            onClick={() => setIsMenuOpen(false)}
            className="block px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg font-medium"
          >
            Dashboard
          </Link>
          {isAdmin && (
            <>
              <Link
                to="/admin"
                onClick={() => setIsMenuOpen(false)}
                className="block px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg font-medium"
              >
                Admin Panel
              </Link>
              <Link
                to="/reports"
                onClick={() => setIsMenuOpen(false)}
                className="block px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg font-medium"
              >
                Reports
              </Link>
              <Link
                to="/salary-sheet"
                onClick={() => setIsMenuOpen(false)}
                className="block px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg font-medium"
              >
                Salary Sheet
              </Link>
            </>
          )}
          <div className="pt-4 border-t border-gray-100">
            <p className="px-3 text-sm font-semibold text-gray-900">{profile?.displayName || profile?.email?.replace('@company.com', '')}</p>
            <button
              onClick={logout}
              className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium mt-2"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
};

// --- Pages ---

const Login = () => {
  const { signIn, signUp, user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState<React.ReactNode>('');
  const [authLoading, setAuthLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (user && profile && !loading) {
      if (profile.role === 'admin') navigate('/admin');
      else navigate('/dashboard-view');
    }
  }, [user, profile, loading, navigate]);

  const handleResetPassword = async () => {
    if (!email) {
      setError('Please enter your email address first.');
      return;
    }
    setAuthLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAuthLoading(true);
    try {
      if (isLogin) {
        // Handle both email and company ID login
        const loginEmail = email.includes('@') ? email : `${email.toLowerCase()}@company.com`;
        await signIn(loginEmail, password);
      } else {
        // Validation for Company ID - Very Relaxed
        if (companyId.length < 1 && !email) {
          setError('Please provide either a Company ID or an Email');
          setAuthLoading(false);
          return;
        }
        
        // Validation for numeric password (only for non-admin emails)
        const isAdminEmail = email.toLowerCase() === 'mnalambd09@gmail.com';
        if (!isAdminEmail && !/^[0-9]+$/.test(password)) {
          setError('Password must be numeric only (e.g., 225510)');
          setAuthLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 digits');
          setAuthLoading(false);
          return;
        }

        const registrationEmail = email || `${companyId.toLowerCase()}@company.com`;
        await signUp(registrationEmail, password, name || companyId);
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      if (err.code === 'auth/invalid-credential') {
        setError(
          <div className="flex flex-col gap-2">
            <span>Invalid email/ID or password.</span>
            <button 
              type="button"
              onClick={() => setIsLogin(false)}
              className="text-blue-600 hover:underline text-left font-bold"
            >
              Never registered? Sign Up here
            </button>
          </div>
        );
      } else if (err.code === 'auth/email-already-in-use') {
        setError(
          <div className="flex flex-col gap-2">
            <span>This email is already registered.</span>
            <button 
              type="button"
              onClick={() => setIsLogin(true)}
              className="text-blue-600 hover:underline text-left font-bold"
            >
              Already have an account? Log In here
            </button>
          </div>
        );
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please use at least 6 characters.');
      } else if (err.code === 'auth/user-not-found') {
        setError('No account found with this email/ID. Please Sign Up.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password. Please try again or reset your password.');
      } else {
        setError(err.message || 'Authentication failed');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full">
        <div className="bg-white p-10 rounded-2xl shadow-xl border border-gray-100">
          <div className="text-center mb-10 relative">
            <Link 
              to="/" 
              className="absolute -top-6 -left-6 p-3 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all group flex items-center gap-2"
              title="Back to Home"
            >
              <Home className="w-6 h-6" />
              <span className="text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity">Home</span>
            </Link>
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-2xl mb-6">
              <Clock className="w-10 h-10 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h1>
            <p className="text-gray-500">
              {isLogin ? 'Sign in to manage your company timesheets' : 'Register as a worker to track your time'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5 flex items-center gap-2">
                    <UserIcon className="w-4 h-4" /> Company ID
                  </label>
                  <input
                    type="text"
                    required
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="e.g. ABC123"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5 flex items-center gap-2">
                    <UserIcon className="w-4 h-4" /> Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="John Doe"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5 flex items-center gap-2">
                <Mail className="w-4 h-4" /> {isLogin ? 'Email or Worker ID' : 'Email (Optional)'}
              </label>
              <input
                type="text"
                required={isLogin}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder={isLogin ? "e.g. j202021 or email" : "worker@company.com"}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5 flex items-center gap-2">
                <Lock className="w-4 h-4" /> Password { !isLogin && '(Numeric only)' }
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder={isLogin ? "••••••••" : "e.g. 225510"}
              />
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 font-medium animate-in fade-in slide-in-from-top-2">
                {error}
              </div>
            )}

            {resetSent && (
              <div className="p-4 bg-green-50 border border-green-100 rounded-xl text-sm text-green-600 font-medium animate-in fade-in slide-in-from-top-2">
                Password reset email sent! Please check your inbox.
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 text-white py-4 px-4 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 active:scale-[0.98] text-lg"
            >
              {authLoading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {isLogin && (
            <div className="mt-6 text-center">
              <button
                onClick={handleResetPassword}
                disabled={authLoading}
                className="text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors underline decoration-2 underline-offset-4"
              >
                Forgot your password? Reset it here
              </button>
            </div>
          )}

          <div className="mt-8 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
            </button>
          </div>

          <p className="mt-8 text-xs text-gray-400 text-center">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
};

// --- Auth Provider ---

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          setProfile(userDoc.data() as UserProfile);
        } else {
          // Create profile if it doesn't exist
          const isDefaultAdmin = firebaseUser.email?.toLowerCase() === (firebaseConfig as any).adminEmail?.toLowerCase();
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || '',
            role: isDefaultAdmin ? 'admin' : 'worker',
            canAddTimeEntry: isDefaultAdmin ? true : false,
            createdAt: serverTimestamp(),
          };
          await setDoc(userDocRef, newProfile);
          setProfile(newProfile);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, pass: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (error: any) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const signUp = async (email: string, pass: string, name: string) => {
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, pass);
      const userDocRef = doc(db, 'users', user.uid);
      const isDefaultAdmin = email.toLowerCase() === (firebaseConfig as any).adminEmail?.toLowerCase();
      const newProfile: UserProfile = {
        uid: user.uid,
        email: email,
        displayName: name,
        role: isDefaultAdmin ? 'admin' : 'worker',
        canAddTimeEntry: isDefaultAdmin ? true : false,
        createdAt: serverTimestamp(),
      };
      await setDoc(userDocRef, newProfile);
      setProfile(newProfile);
    } catch (error: any) {
      console.error('Signup failed:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const value = {
    user,
    profile,
    loading,
    isAdmin: profile?.role === 'admin',
    signIn,
    signUp,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// --- App Entry ---

export default function App() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <AuthProvider>
          <Router>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/dashboard-view" element={<Layout><Dashboard /></Layout>} />
              <Route path="/admin" element={<Layout><AdminPanel /></Layout>} />
              <Route path="/dashboard" element={<Layout><AdminPanel /></Layout>} />
              <Route path="/reports" element={<Layout><Reports /></Layout>} />
              <Route path="/salary-sheet" element={<Layout><SalarySheet /></Layout>} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Router>
        </AuthProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

// --- Dashboard Component ---

const Dashboard = () => {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCalcOpen, setIsCalcOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!profile) return;

    setLoading(true);
    const q = query(
      collection(db, 'timesheets'),
      where('workerId', '==', profile.uid),
      orderBy('date', 'desc'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimesheetEntry));
      setEntries(data);
      setLoading(false);
    }, (error) => {
      console.error("Firestore error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    
    try {
      await deleteDoc(doc(db, 'timesheets', deleteId));
      setDeleteId(null);
    } catch (error: any) {
      if (error.message?.includes('insufficient permissions')) {
        handleFirestoreError(error, OperationType.DELETE, `timesheets/${deleteId}`);
      } else {
        console.error("Delete failed:", error);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const { companyName } = useSettings();
  const monthEntries = entries.filter(e => e.date.startsWith(selectedMonth));
  const approvedMonthEntries = monthEntries;

  const getWeeklyBenefit = () => {
    const start = startOfMonth(parseISO(`${selectedMonth}-01`));
    const end = endOfMonth(start);
    const fridays = eachDayOfInterval({ start, end }).filter(d => getDay(d) === 5);
    
    let totalBenefit = 0;
    fridays.forEach(friday => {
      const dateStr = format(friday, 'yyyy-MM-dd');
      // Benefit counts for all entries
      const fridayEntry = entries.find(e => e.date === dateStr);
      if (fridayEntry) {
        totalBenefit += getFridayBenefit(dateStr, entries);
      }
    });
    
    return totalBenefit;
  };

  const totalBenefit = getWeeklyBenefit();
  const totalHoursThisMonth = approvedMonthEntries.reduce((sum, e) => sum + e.totalHours, 0) + totalBenefit;

  const handleDownloadReport = async (exportFormat: 'csv' | 'pdf' | 'excel') => {
    const monthEntries = entries.filter(e => e.date.startsWith(selectedMonth));
    if (monthEntries.length === 0) {
      alert("No entries to download for this month.");
      return;
    }

    const monthDate = parseISO(`${selectedMonth}-01`);
    const monthName = format(monthDate, 'MMMM_yyyy');
    const start = startOfMonth(monthDate);
    const end = endOfMonth(start);
    const fridays = eachDayOfInterval({ start, end }).filter(d => getDay(d) === 5);

    if (exportFormat === 'csv') {
      const headers = ['Date', 'Day', 'Time In', 'Time Out', 'Total W/H', 'Basic', 'B.OT', 'E.OT', 'N.OT', 'Holiday', 'Benefit', 'Status', 'Notes'];
      const rows = monthEntries.map(e => {
        const benefit = isFriday(e.date) ? getFridayBenefit(e.date, entries) : 0;
        return [
          e.date,
          format(parseISO(e.date), 'EEE'),
          e.startTime,
          e.endTime,
          (e.totalHours + benefit).toFixed(2),
          e.basicWork,
          e.basicOT,
          e.extenOT,
          e.nightOT,
          e.holiday,
          benefit.toFixed(2),
          e.status || 'pending',
          `"${e.notes || ''}"`
        ];
      });
      
      const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `timesheet_${profile?.displayName || 'worker'}_${monthName}.csv`);
      link.click();
    } else if (exportFormat === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Timesheet');

      // Title
      worksheet.addRow([`${companyName} - Timesheet Report`]);
      worksheet.mergeCells(1, 1, 1, 13);
      worksheet.getCell(1, 1).font = { bold: true, size: 14 };
      worksheet.getCell(1, 1).alignment = { horizontal: 'center' };

      worksheet.addRow([`Worker: ${profile?.displayName || profile?.email}`]);
      worksheet.addRow([`Date: ${format(new Date(), 'MMM dd, yyyy')}`]);
      worksheet.addRow([]);

      // Headers
      const headers = ['Date', 'Day', 'In', 'Out', 'Total', 'Basic', 'B.OT', 'E.OT', 'N.OT', 'Hol', 'Ben', 'Status', 'Notes'];
      const headerRow = worksheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Data
      monthEntries.forEach(e => {
        const benefit = isFriday(e.date) ? getFridayBenefit(e.date, entries) : 0;
        const row = worksheet.addRow([
          e.date,
          format(parseISO(e.date), 'EEE'),
          e.startTime,
          e.endTime,
          parseFloat((e.totalHours + benefit).toFixed(2)),
          e.basicWork,
          e.basicOT,
          e.extenOT,
          e.nightOT,
          e.holiday,
          parseFloat(benefit.toFixed(2)),
          e.status || 'pending',
          e.notes || '-'
        ]);

        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };

          // Highlight Fridays
          if (format(parseISO(e.date), 'EEE') === 'Fri') {
            cell.font = { color: { argb: 'FFFF0000' }, bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFF0F0' }
            };
          }
        });
      });

      // Total
      let totalBenefit = 0;
      fridays.forEach(friday => {
        const dateStr = format(friday, 'yyyy-MM-dd');
        totalBenefit += getFridayBenefit(dateStr, entries);
      });
      const total = monthEntries.reduce((sum, e) => sum + e.totalHours, 0) + totalBenefit;
      
      worksheet.addRow([]);
      const totalRow = worksheet.addRow(['', '', '', '', `Total: ${total.toFixed(2)}`]);
      totalRow.getCell(5).font = { bold: true };

      // Column widths
      worksheet.getColumn(1).width = 15;
      worksheet.getColumn(2).width = 8;
      worksheet.getColumn(12).width = 30;

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `timesheet_${profile?.displayName || 'worker'}_${monthName}.xlsx`);
    } else {
      const doc = new jsPDF();
      doc.setFontSize(20);
      doc.text(`${companyName} - Timesheet Report`, 14, 22);
      doc.setFontSize(12);
      doc.text(`Worker: ${profile?.displayName || profile?.email}`, 14, 32);
      doc.text(`Date: ${format(new Date(), 'MMM dd, yyyy')}`, 14, 40);

      const tableData = monthEntries.map(e => {
        const benefit = isFriday(e.date) ? getFridayBenefit(e.date, entries) : 0;
        return [
          e.date,
          format(parseISO(e.date), 'EEE'),
          e.startTime,
          e.endTime,
          (e.totalHours + benefit).toFixed(2),
          e.basicWork,
          e.basicOT,
          e.extenOT,
          e.nightOT,
          e.holiday,
          benefit.toFixed(2),
          e.status || 'pending',
          e.notes || '-'
        ];
      });

      autoTable(doc, {
        startY: 50,
        head: [['Date', 'Day', 'In', 'Out', 'Total', 'Basic', 'B.OT', 'E.OT', 'N.OT', 'Hol', 'Ben', 'Status', 'Notes']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
        styles: { 
          fontSize: 7,
          lineWidth: 0.3,
          lineColor: [0, 0, 0]
        },
        tableLineWidth: 0.5,
        tableLineColor: [0, 0, 0],
        didParseCell: function (data) {
          if (data.section === 'body') {
            const dayName = data.row.cells[1].text[0];
            if (dayName === 'Fri') {
              data.cell.styles.fillColor = [254, 242, 242];
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      });

      let totalBenefit = 0;
      fridays.forEach(friday => {
        const dateStr = format(friday, 'yyyy-MM-dd');
        totalBenefit += getFridayBenefit(dateStr, entries);
      });

      const total = monthEntries.reduce((sum, e) => sum + e.totalHours, 0) + totalBenefit;
      const finalY = (doc as any).lastAutoTable.finalY || 50;
      doc.text(`Total Hours (including benefit): ${total.toFixed(2)}`, 14, finalY + 10);
      doc.save(`timesheet_${profile?.displayName || 'worker'}_${monthName}.pdf`);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Worker Dashboard</h1>
          <p className="text-gray-500">Track your daily working hours</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input 
            type="month" 
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
          />
          <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <button 
              onClick={() => handleDownloadReport('csv')}
              className="p-2.5 text-gray-600 hover:bg-gray-50 border-r border-gray-200 transition-all active:scale-95"
              title="Download CSV"
            >
              <Download className="w-5 h-5" />
            </button>
            <button 
              onClick={() => handleDownloadReport('excel')}
              className="p-2.5 text-green-600 hover:bg-green-50 border-r border-gray-200 transition-all active:scale-95"
              title="Download Excel"
            >
              <FileText className="w-5 h-5" />
            </button>
            <button 
              onClick={() => handleDownloadReport('pdf')}
              className="p-2.5 text-red-600 hover:bg-red-50 transition-all active:scale-95"
              title="Download PDF"
            >
              <FileText className="w-5 h-5" />
            </button>
          </div>
          <button 
            onClick={() => setIsCalcOpen(true)}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 py-2.5 px-4 rounded-xl font-semibold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
            title="Open Calculator"
          >
            <CalcIcon className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            disabled={!profile?.canAddTimeEntry}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 px-6 rounded-xl font-semibold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-5 h-5" /> Add Time Entry
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-gray-500 mb-1">Total Hours This Month</p>
          <p className="text-3xl font-bold text-gray-900">{totalHoursThisMonth.toFixed(1)}</p>
          <p className="text-xs text-blue-600 font-medium mt-1">Includes {totalBenefit}h benefits</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-gray-500 mb-1">Total Entries</p>
          <p className="text-3xl font-bold text-blue-600">{entries.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border-4 border-gray-900 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b-4 border-gray-900 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Recent Entries</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 border-b-4 border-gray-900">
              <tr>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Date</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Day</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">In</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Out</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Total</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Basic</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">B.OT</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">E.OT</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">N.OT</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Hol</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Ben</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider border-r-4 border-gray-900">Status</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-900 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y-4 divide-gray-900">
              {loading ? (
                <tr><td colSpan={14} className="px-6 py-10 text-center text-gray-400">Loading entries...</td></tr>
              ) : monthEntries.length === 0 ? (
                <tr><td colSpan={14} className="px-6 py-10 text-center text-gray-400 italic">No entries found. Start by adding one!</td></tr>
              ) : (
                <>
                  {monthEntries.map((entry) => {
                    const friday = isFriday(entry.date);
                    const benefit = friday ? getFridayBenefit(entry.date, entries) : 0;
                    
                    return (
                      <tr key={entry.id} className={cn(
                        "hover:bg-gray-50 transition-colors",
                        friday && "bg-red-50 text-red-600 font-bold"
                      )}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-r-4 border-gray-900">
                          {format(parseISO(entry.date), 'MMM dd, yyyy')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{format(parseISO(entry.date), 'EEEE')}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{entry.startTime}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{entry.endTime}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 border-r-4 border-gray-900">{(entry.totalHours + benefit).toFixed(2)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{entry.basicWork}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{entry.basicOT}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{entry.extenOT}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{entry.nightOT}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 border-r-4 border-gray-900">{entry.holiday}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600 border-r-4 border-gray-900">{benefit.toFixed(2)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm border-r-4 border-gray-900">
                          <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700">
                            Approved
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <button 
                            onClick={() => entry.id && setDeleteId(entry.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Entry"
        message="Are you sure you want to delete this time entry?"
        loading={isDeleting}
      />

      <TimeEntryModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={() => {}} 
      />
      <Calculator 
        isOpen={isCalcOpen}
        onClose={() => setIsCalcOpen(false)}
      />
    </div>
  );
};

// --- Admin Panel Component ---

const WorkerManagement = ({ workers }: { workers: UserProfile[] }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteUid, setDeleteUid] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingWorker, setEditingWorker] = useState<UserProfile | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const handleCreateWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const finalEmail = email.includes('@') ? email : `${email}@company.com`;
      const { user } = await createUserWithEmailAndPassword(secondaryAuth, finalEmail, password);
      
      const userDocRef = doc(db, 'users', user.uid);
      const newProfile: UserProfile = {
        uid: user.uid,
        email: finalEmail,
        displayName: name,
        role: 'worker',
        hourlyRate: parseFloat(hourlyRate) || 0,
        canAddTimeEntry: false,
        createdAt: serverTimestamp(),
      };
      await setDoc(userDocRef, newProfile);
      await secondarySignOut(secondaryAuth);
      
      setSuccess(`Worker ${name || finalEmail} created successfully!`);
      setEmail('');
      setPassword('');
      setName('');
      setHourlyRate('');
    } catch (err: any) {
      console.error('Worker creation error:', err);
      setError(err.message || 'Failed to create worker');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRate = async (worker: UserProfile, newRate: string) => {
    try {
      const rate = parseFloat(newRate);
      if (isNaN(rate)) return;
      await updateDoc(doc(db, 'users', worker.uid), { hourlyRate: rate });
    } catch (err) {
      console.error('Update rate error:', err);
    }
  };

  const toggleTimeEntry = async (worker: UserProfile) => {
    try {
      await updateDoc(doc(db, 'users', worker.uid), { 
        canAddTimeEntry: !worker.canAddTimeEntry 
      });
    } catch (err) {
      console.error('Toggle time entry error:', err);
    }
  };

  const handleDeleteWorker = async () => {
    if (!deleteUid) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'users', deleteUid));
      setDeleteUid(null);
    } catch (err: any) {
      console.error('Delete worker error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-blue-600" /> Add New Worker
        </h3>
        <form onSubmit={handleCreateWorker} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Email / ID</label>
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. j202021"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Hourly Rate</label>
              <input
                type="number"
                step="0.01"
                required
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="0.00"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
          {success && <p className="text-xs text-green-600 font-medium">{success}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white py-2 px-6 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Worker'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">Worker List</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Email / ID</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Hourly Rate</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Time Entry</th>
                <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {workers.map(w => (
                <tr key={w.uid} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{w.displayName || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{w.email?.replace('@company.com', '')}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={w.hourlyRate || 0}
                      onBlur={(e) => handleUpdateRate(w, e.target.value)}
                      className="w-20 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none transition-all"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <button
                      onClick={() => toggleTimeEntry(w)}
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all",
                        w.canAddTimeEntry ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      )}
                    >
                      {w.canAddTimeEntry ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingWorker(w);
                          setIsDetailsModalOpen(true);
                        }}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                        title="Edit Details"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteUid(w.uid)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteUid}
        onClose={() => setDeleteUid(null)}
        onConfirm={handleDeleteWorker}
        title="Delete Worker"
        message="Are you sure you want to delete this worker? Their profile will be removed from Firestore, but their Auth account must be manually deleted if needed."
        loading={isDeleting}
      />

      {editingWorker && (
        <WorkerDetailsModal
          isOpen={isDetailsModalOpen}
          onClose={() => {
            setIsDetailsModalOpen(false);
            setEditingWorker(null);
          }}
          worker={editingWorker}
        />
      )}
    </div>
  );
};

interface WorkerDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: UserProfile;
}

const WorkerDetailsModal = ({ isOpen, onClose, worker }: WorkerDetailsModalProps) => {
  const [formData, setFormData] = useState({
    displayName: worker.displayName || '',
    division: worker.division || '',
    jobTitle: worker.jobTitle || '',
    arrivalDate: worker.arrivalDate || '',
    passportNo: worker.passportNo || '',
    accountHolder: worker.accountHolder || '',
    accountNo: worker.accountNo || '',
    bankName: worker.bankName || '',
    branchName: worker.branchName || '',
    routingNumber: worker.routingNumber || '',
    hourlyRate: worker.hourlyRate || 0,
    deduction: worker.deduction || 0,
  });
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', worker.uid), formData);
      onClose();
    } catch (err) {
      console.error('Save worker details error:', err);
      alert('Failed to save details');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-xl font-bold text-gray-900">Worker Details: {worker.email}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Full Name</label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Hourly Rate</label>
              <input
                type="number"
                step="0.01"
                value={formData.hourlyRate}
                onChange={(e) => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Division</label>
              <input
                type="text"
                value={formData.division}
                onChange={(e) => setFormData({ ...formData, division: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Job Title</label>
              <input
                type="text"
                value={formData.jobTitle}
                onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Arrival Date</label>
              <input
                type="date"
                value={formData.arrivalDate}
                onChange={(e) => setFormData({ ...formData, arrivalDate: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Passport No</label>
              <input
                type="text"
                value={formData.passportNo}
                onChange={(e) => setFormData({ ...formData, passportNo: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100">
            <h4 className="text-sm font-bold text-gray-900 mb-4">Bank Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Account Holder</label>
                <input
                  type="text"
                  value={formData.accountHolder}
                  onChange={(e) => setFormData({ ...formData, accountHolder: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Account No</label>
                <input
                  type="text"
                  value={formData.accountNo}
                  onChange={(e) => setFormData({ ...formData, accountNo: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Bank Name</label>
                <input
                  type="text"
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Branch Name</label>
                <input
                  type="text"
                  value={formData.branchName}
                  onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Routing Number</label>
                <input
                  type="text"
                  value={formData.routingNumber}
                  onChange={(e) => setFormData({ ...formData, routingNumber: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Monthly Deduction</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.deduction}
                  onChange={(e) => setFormData({ ...formData, deduction: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        </form>
        <div className="p-6 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="py-2 px-4 rounded-xl font-bold text-gray-600 hover:bg-gray-200 transition-all">Cancel</button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="bg-blue-600 text-white py-2 px-6 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Details'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminPanel = () => {
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [recentEntries, setRecentEntries] = useState<TimesheetEntry[]>([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'workers' | 'settings'>('workers');
  const { companyName, updateCompanyName } = useSettings();
  const [newCompanyName, setNewCompanyName] = useState(companyName);

  useEffect(() => {
    setNewCompanyName(companyName);
  }, [companyName]);

  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const handleUpdateCompanyName = async () => {
    setIsSavingSettings(true);
    try {
      await updateCompanyName(newCompanyName);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleClearAllData = async () => {
    setIsClearing(true);
    try {
      const snapshot = await getDocs(collection(db, 'timesheets'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      setShowClearConfirm(false);
      alert('All timesheet data has been cleared successfully.');
    } catch (err) {
      console.error('Clear data error:', err);
      alert('Failed to clear data.');
    } finally {
      setIsClearing(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await updateDoc(doc(db, 'timesheets', id), { status: 'approved' });
    } catch (err) {
      console.error('Approval error:', err);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await updateDoc(doc(db, 'timesheets', id), { status: 'rejected' });
    } catch (err) {
      console.error('Rejection error:', err);
    }
  };

  useEffect(() => {
    const workersQuery = query(collection(db, 'users'), where('role', '==', 'worker'));
    const entriesQuery = query(collection(db, 'timesheets'), orderBy('createdAt', 'desc'), limit(10));

    const unsubWorkers = onSnapshot(workersQuery, (snapshot) => {
      setWorkers(snapshot.docs.map(doc => doc.data() as UserProfile));
    });

    const unsubEntries = onSnapshot(entriesQuery, (snapshot) => {
      setRecentEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimesheetEntry)));
      setLoading(false);
    });

    return () => {
      unsubWorkers();
      unsubEntries();
    };
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
          <p className="text-gray-500">Manage company workers, approvals and settings</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowClearConfirm(true)}
            className="flex items-center justify-center gap-2 bg-white border border-red-200 text-red-600 py-2.5 px-6 rounded-xl font-semibold hover:bg-red-50 transition-all shadow-sm active:scale-95"
          >
            <Trash2 className="w-5 h-5" /> Clear All Data
          </button>
          <button 
            onClick={() => setIsBulkModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 py-2.5 px-6 rounded-xl font-semibold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-5 h-5" /> Bulk Add (1-31)
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('workers')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-all border-b-2",
            activeTab === 'workers' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          Workers
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-all border-b-2",
            activeTab === 'settings' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          Settings
        </button>
      </div>

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearAllData}
        title="Clear All Timesheet Data"
        message="Are you sure you want to delete ALL timesheet entries? This action cannot be undone."
        loading={isClearing}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {activeTab === 'workers' && <WorkerManagement workers={workers} />}
          
          {activeTab === 'settings' && (
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Company Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">Company Name</label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter company name"
                    />
                    <button
                      onClick={handleUpdateCompanyName}
                      disabled={isSavingSettings}
                      className="bg-blue-600 text-white py-2 px-6 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 disabled:opacity-50"
                    >
                      {isSavingSettings ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4">Quick Stats</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Total Workers</span>
                <span className="font-bold">{workers.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Total Entries</span>
                <span className="font-bold">{recentEntries.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BulkInputModal 
        isOpen={isBulkModalOpen} 
        onClose={() => setIsBulkModalOpen(false)} 
        onSuccess={() => {}} 
      />
    </div>
  );
};

// --- Salary Sheet Component ---

const SalarySheet = () => {
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [loading, setLoading] = useState(false);
  const [salaryData, setSalaryData] = useState<any[]>([]);
  const [isEditingDeductions, setIsEditingDeductions] = useState(false);
  const [tempDeductions, setTempDeductions] = useState<Record<string, number>>({});

  const addPayslipToDoc = (doc: jsPDF, data: any, worker: UserProfile | undefined, monthName: string, companyName: string) => {
    // Header
    doc.setFontSize(10);
    doc.text(companyName, 105, 15, { align: 'center' });
    doc.setFontSize(16);
    doc.text(`${monthName}. SALARY TABLE`, 105, 25, { align: 'center' });
    doc.setLineWidth(0.5);
    doc.line(60, 27, 150, 27);

    // Worker Details
    doc.setFontSize(10);
    doc.text(`Name    :  ${data.workerName}`, 20, 40);
    doc.text(`Division :  ${worker?.division || '-'}`, 110, 40);
    doc.text(`S.N.    :  ${data.workerId}`, 20, 47);
    doc.text(`Job Title:  ${worker?.jobTitle || '-'}`, 110, 47);
    doc.text(`Arrival :  ${worker?.arrivalDate || '-'}`, 20, 54);
    doc.text(`P.P. No :  ${worker?.passportNo || '-'}`, 110, 54);

    const paymentDate = format(new Date(), 'yyyy.MM.dd');
    const period = `${selectedMonth}.01-${selectedMonth}.31`;
    doc.text(`Payment Date : ${paymentDate} (${period})`, 20, 65);
    doc.text(`Currency : USD`, 170, 65);

    // Hours Table
    autoTable(doc, {
      startY: 70,
      head: [['Type of W/H', 'Basic Work', 'Weekly Benefits', 'Basic O.T(150%)', 'Extension O.T(150%)', 'N/T(200%)', 'H/W(200%)']],
      body: [['W/H', 
        (data.totalBasicWork || 0).toFixed(2), 
        (data.totalBenefit || 0).toFixed(2), 
        (data.totalBasicOT || 0).toFixed(2), 
        (data.totalExtenOT || 0).toFixed(2), 
        (data.totalNightOT || 0).toFixed(2), 
        (data.totalHoliday || 0).toFixed(2)
      ]],
      theme: 'grid',
      headStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
      bodyStyles: { halign: 'center' },
    });

    // Payment & Deduction Table
    const paymentRows = [
      ['Basic Work', (data.basicWorkPay || 0).toFixed(2)],
      ['Weekly Benefits', (data.benefitPay || 0).toFixed(2)],
      ['Basic O.T(150%)', ((data.totalBasicOT || 0) * (data.hourlyRate || 0) * 1.5).toFixed(2)],
      ['Extension O.T(150%)', ((data.totalExtenOT || 0) * (data.hourlyRate || 0) * 2).toFixed(2)],
      ['N/T(200%)', ((data.totalNightOT || 0) * (data.hourlyRate || 0) * 2).toFixed(2)],
      ['H/W(200%)', ((data.totalHoliday || 0) * (data.hourlyRate || 0) * 2).toFixed(2)],
      ['', ''],
      ['Bonus', '0.00'],
      ['Salary to be added', '0.00'],
      ['Annual Allowance', '0.00'],
      ['Other Benefits', '0.00'],
      ['', ''],
      ['Salary Total', (data.grossPay || 0).toFixed(2)],
    ];

    const deductionRows = [
      ['Insurance', '0.00'],
      ['Salary to be deducted', (data.deduction || 0).toFixed(2)],
      ['Cash Withdrawal', '0.00'],
      ['Advance Payment', '0.00'],
      ['Additional Deduction', '0.00'],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['Total Deduction', (data.deduction || 0).toFixed(2)],
      ['Net Salary', (data.totalPay || 0).toFixed(2)],
    ];

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Payment', '', 'Deduction', '']],
      body: paymentRows.map((row, i) => [...row, ...deductionRows[i]]),
      theme: 'grid',
      headStyles: { fillColor: [150, 150, 150], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 40, halign: 'right' },
        2: { cellWidth: 50 },
        3: { cellWidth: 40, halign: 'right' },
      },
    });

    // Bank Info
    const bankStartY = (doc as any).lastAutoTable.finalY + 10;
    doc.text(`Indirect Management : `, 20, bankStartY);
    
    autoTable(doc, {
      startY: bankStartY + 5,
      body: [
        ['Acct. Holder', worker?.accountHolder || '-', 'Acct. No.', worker?.accountNo || '-'],
        ['MAIN. S.CODE', '', 'Bank', worker?.bankName || '-'],
        ['BR. S.CODE', '', 'Branch', worker?.branchName || '-'],
        ['Routing Number', worker?.routingNumber || '-', '', ''],
        ['Monthly', '', 'Wage/h', (data.hourlyRate || 0).toFixed(2)],
      ],
      theme: 'grid',
      styles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 40, fontStyle: 'bold', fillColor: [240, 240, 240] },
        1: { cellWidth: 50 },
        2: { cellWidth: 40, fontStyle: 'bold', fillColor: [240, 240, 240] },
        3: { cellWidth: 50 },
      },
    });

    // Footer
    const footerY = (doc as any).lastAutoTable.finalY + 20;
    doc.text('Signature :', 130, footerY);
    doc.line(150, footerY, 190, footerY);
    doc.text('Date :', 130, footerY + 10);
    doc.line(150, footerY + 10, 190, footerY + 10);
  };

  const generatePayslipPDF = (data: any) => {
    const doc = new jsPDF();
    const worker = workers.find(w => w.uid === data.workerUid);
    const monthName = format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy').toUpperCase();
    const companyName = document.title === 'My Google AI Studio App' ? 'Company Timesheet Management' : document.title;

    addPayslipToDoc(doc, data, worker, monthName, companyName);
    doc.save(`Payslip_${data.workerName}_${selectedMonth}.pdf`);
  };

  const generateAllPayslipsPDF = () => {
    if (salaryData.length === 0) return;
    const doc = new jsPDF();
    const monthName = format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy').toUpperCase();
    const companyName = document.title === 'My Google AI Studio App' ? 'Company Timesheet Management' : document.title;

    salaryData.forEach((data, index) => {
      if (index > 0) doc.addPage();
      const worker = workers.find(w => w.uid === data.workerUid);
      addPayslipToDoc(doc, data, worker, monthName, companyName);
    });

    doc.save(`All_Payslips_${selectedMonth}.pdf`);
  };

  const handleEditDeductions = () => {
    const initialDeductions: Record<string, number> = {};
    salaryData.forEach(d => {
      initialDeductions[d.workerUid] = d.deduction || 0;
    });
    setTempDeductions(initialDeductions);
    setIsEditingDeductions(true);
  };

  const handleSaveDeductions = async () => {
    setLoading(true);
    try {
      const batch = writeBatch(db);
      Object.entries(tempDeductions).forEach(([uid, amount]) => {
        batch.update(doc(db, 'users', uid), { deduction: amount });
      });
      await batch.commit();
      setIsEditingDeductions(false);
      // Refresh workers to trigger recalculation
      const q = query(collection(db, 'users'), where('role', '==', 'worker'));
      const snapshot = await getDocs(q);
      setWorkers(snapshot.docs.map(doc => doc.data() as UserProfile));
    } catch (err) {
      console.error('Save deductions error:', err);
      alert('Failed to save deductions');
    } finally {
      setLoading(false);
    }
  };

  const exportExcelGrid = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Salary Grid');

    worksheet.mergeCells('A1:L1');
    worksheet.getCell('A1').value = `SALARY SUMMARY - ${selectedMonth}`;
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    const headers = [
      'Worker Name', 'ID', 'Rate', 'Basic Hrs', 'Benefit Hrs', 'Friday Hrs (x2)', 'OT (1.5x)', 'Ext OT (2x)', 'Night OT (2x)', 'Basic Pay', 'OT Pay', 'Deduction', 'Net Salary'
    ];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    salaryData.forEach(d => {
      const row = worksheet.addRow([
        d.workerName, d.workerId, d.hourlyRate, d.totalBasicWork, d.totalBenefit, d.totalHoliday, d.totalBasicOT, d.totalExtenOT, d.totalNightOT,
        parseFloat((d.basicPay || 0).toFixed(2)), parseFloat((d.otPay || 0).toFixed(2)), parseFloat((d.deduction || 0).toFixed(2)), parseFloat((d.totalPay || 0).toFixed(2))
      ]);
      row.eachCell(cell => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Salary_Summary_${selectedMonth}.xlsx`);
  };

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'worker'));
    const unsub = onSnapshot(q, (snapshot) => {
      setWorkers(snapshot.docs.map(doc => doc.data() as UserProfile));
    }, (err) => {
      console.error('Fetch workers error (SalarySheet):', err);
    });
    return () => unsub();
  }, []);

  const [hasPending, setHasPending] = useState(false);

  const calculateSalaries = async () => {
    setLoading(true);
    setHasPending(false);
    try {
      const monthStart = parseISO(`${selectedMonth}-01`);
      const start = format(subDays(monthStart, 6), 'yyyy-MM-dd');
      const end = `${selectedMonth}-31`;
      
      const q = query(
        collection(db, 'timesheets'), 
        where('date', '>=', start),
        where('date', '<=', end),
        orderBy('date', 'asc')
      );
      
      const snapshot = await getDocs(q);
      const allEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimesheetEntry));
      
      const monthEntries = allEntries.filter(e => e.date.startsWith(selectedMonth));
      const approvedEntries = allEntries; // Include all fetched entries
      const pendingEntries = []; // No pending entries anymore
      
      if (pendingEntries.length > 0) {
        setHasPending(true);
      }

      const calculatedData = workers.map(worker => {
        const workerEntries = approvedEntries.filter(e => e.workerId === worker.uid);
        const currentMonthEntries = workerEntries.filter(e => e.date.startsWith(selectedMonth));
        
        let totalBasicWork = 0;
        let totalBasicOT = 0;
        let totalExtenOT = 0;
        let totalNightOT = 0;
        let totalBenefit = 0;
        let totalHoliday = 0;

        currentMonthEntries.forEach(e => {
          totalBasicWork += e.basicWork || 0;
          totalBasicOT += e.basicOT || 0;
          totalExtenOT += e.extenOT || 0;
          totalNightOT += e.nightOT || 0;
          totalHoliday += e.holiday || 0;
          
          if (getDay(parseISO(e.date)) === 5) {
            totalBenefit += getFridayBenefit(e.date, workerEntries);
          }
        });

        const rate = worker.hourlyRate || 0;
        const deduction = worker.deduction || 0;
        // Basic Pay includes: Basic Work + Friday Benefit + Friday Work (Holiday) * 2
        const benefitPay = totalBenefit * rate;
        const basicWorkPay = (totalBasicWork + totalBenefit) * rate;
        const holidayPay = (totalHoliday * 2) * rate;
        const basicPay = basicWorkPay + holidayPay;
        const otPay = (totalBasicOT * 1.5 + totalExtenOT * 2 + totalNightOT * 2) * rate;
        const grossPay = basicPay + otPay;
        const totalPay = grossPay - deduction;

        return {
          workerName: worker.displayName || worker.email || 'Unknown',
          workerId: worker.email?.replace('@company.com', '') || '-',
          workerUid: worker.uid,
          hourlyRate: rate,
          deduction,
          totalBasicWork,
          totalBenefit,
          totalHoliday,
          totalBasicOT,
          totalExtenOT,
          totalNightOT,
          benefitPay,
          basicWorkPay,
          holidayPay,
          basicPay,
          otPay,
          grossPay,
          totalPay
        };
      });

      setSalaryData(calculatedData.sort((a, b) => a.workerName.localeCompare(b.workerName)));
    } catch (err) {
      console.error('Salary calculation error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    calculateSalaries();
  }, [selectedMonth, workers]);

  const handleExportExcel = async () => {
    // This function is now replaced by exportExcelGrid
    exportExcelGrid();
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Salary Sheet</h1>
          <p className="text-gray-500">Calculate monthly salaries based on hours and rates</p>
        </div>
        <div className="flex gap-3">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
          />
          <button
            onClick={exportExcelGrid}
            className="flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 px-6 rounded-xl font-semibold hover:bg-green-700 transition-all shadow-md shadow-green-100 active:scale-95"
          >
            <Download className="w-5 h-5" /> Export Excel Grid
          </button>
          <button
            onClick={generateAllPayslipsPDF}
            className="flex items-center justify-center gap-2 bg-red-600 text-white py-2.5 px-6 rounded-xl font-semibold hover:bg-red-700 transition-all shadow-md shadow-red-100 active:scale-95"
          >
            <FileText className="w-5 h-5" /> Export All PDF
          </button>
          {!isEditingDeductions ? (
            <button
              onClick={handleEditDeductions}
              className="flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 px-6 rounded-xl font-semibold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 active:scale-95"
            >
              <Plus className="w-5 h-5" /> Set Deductions
            </button>
          ) : (
            <button
              onClick={handleSaveDeductions}
              disabled={loading}
              className="flex items-center justify-center gap-2 bg-orange-600 text-white py-2.5 px-6 rounded-xl font-semibold hover:bg-orange-700 transition-all shadow-md shadow-orange-100 active:scale-95 disabled:opacity-50"
            >
              Save Deductions
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500">Calculating salaries...</p>
          </div>
        ) : salaryData.length === 0 ? (
          <div className="p-12 text-center">
            <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">No data found</h3>
            <p className="text-gray-500 max-w-xs mx-auto mt-1">
              No timesheet entries found for {format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Worker</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Rate</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Basic + Ben</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Friday (x2)</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">OT (1.5/2.0)</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Basic Pay</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">OT Pay</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Deduction</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right font-bold text-blue-600">Net Salary</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {salaryData.map((d, idx) => (
                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{d.workerName}</div>
                    <div className="text-xs text-gray-500">ID: {d.workerId}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 text-center">${(d.hourlyRate || 0).toFixed(2)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 text-center">
                    {((d.totalBasicWork || 0) + (d.totalBenefit || 0)).toFixed(2)} hrs
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 text-center">
                    {(d.totalHoliday || 0).toFixed(2)} hrs
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 text-center">
                    {((d.totalBasicOT || 0) + (d.totalExtenOT || 0) + (d.totalNightOT || 0)).toFixed(2)} hrs
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 text-right">${d.basicPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 text-right">${d.otPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm font-medium text-red-600 text-right">
                    {isEditingDeductions ? (
                      <input
                        type="number"
                        step="0.01"
                        value={tempDeductions[d.workerUid] ?? 0}
                        onChange={(e) => setTempDeductions({ ...tempDeductions, [d.workerUid]: parseFloat(e.target.value) || 0 })}
                        className="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      `-$${(d.deduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-blue-600 text-right">${d.totalPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => generatePayslipPDF(d)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                      title="Download Payslip PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
};

// --- Reports Component ---

const Reports = () => {
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [selectedWorkerId, setSelectedWorkerId] = useState('all');
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingGrid, setIsExportingGrid] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [reportData, setReportData] = useState<{ worker: UserProfile, rows: any[] }[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'worker'));
    const unsub = onSnapshot(q, (snapshot) => {
      setWorkers(snapshot.docs.map(doc => doc.data() as UserProfile));
    }, (err) => {
      console.error('Fetch workers error (Reports):', err);
    });
    return () => unsub();
  }, []);

  const getFilteredEntries = async () => {
    const monthStart = parseISO(`${selectedMonth}-01`);
    const start = format(subDays(monthStart, 6), 'yyyy-MM-dd');
    const end = `${selectedMonth}-31`;
    
    let q;
    if (selectedWorkerId === 'all') {
      q = query(
        collection(db, 'timesheets'), 
        where('date', '>=', start),
        where('date', '<=', end),
        orderBy('date', 'asc')
      );
    } else {
      q = query(
        collection(db, 'timesheets'), 
        where('workerId', '==', selectedWorkerId),
        where('date', '>=', start),
        where('date', '<=', end),
        orderBy('date', 'asc')
      );
    }
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data() as TimesheetEntry);
  };

  const generateReportPreview = async () => {
    setIsPreviewLoading(true);
    try {
      const entries = await getFilteredEntries();
      const [year, month] = selectedMonth.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      
      const workersToReport = selectedWorkerId === 'all' 
        ? workers 
        : workers.filter(w => w.uid === selectedWorkerId);

      const fullReport: { worker: UserProfile, rows: any[] }[] = [];

      workersToReport.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '')).forEach(worker => {
        const workerEntries = entries.filter(e => e.workerId === worker.uid);
        const workerRows: any[] = [];
        
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = `${selectedMonth}-${day.toString().padStart(2, '0')}`;
          const e = workerEntries.find(entry => entry.date === dateStr);
          const isFri = getDay(parseISO(dateStr)) === 5;
          
          if (e) {
            const benefit = isFri ? getFridayBenefit(e.date, workerEntries) : 0;
            workerRows.push({
              ...e,
              totalHours: e.totalHours + benefit,
              weeklyBenefit: benefit,
              dayName: format(parseISO(e.date), 'EEE')
            });
          } else {
            const benefit = isFri ? getFridayBenefit(dateStr, workerEntries) : 0;
            workerRows.push({
              workerName: worker.displayName || worker.email || 'Unknown',
              workerId: worker.email?.replace('@company.com', '') || '-',
              date: dateStr,
              dayName: format(parseISO(dateStr), 'EEE'),
              startTime: '-',
              endTime: '-',
              totalHours: benefit,
              basicWork: 0,
              basicOT: 0,
              extenOT: 0,
              nightOT: 0,
              holiday: 0,
              weeklyBenefit: benefit,
              notes: ''
            });
          }
        }
        // Filter out the extra days used for calculation before pushing to report
        const filteredRows = workerRows.filter(r => r.date.startsWith(selectedMonth));
        fullReport.push({ worker, rows: filteredRows });
      });
      setReportData(fullReport);
    } catch (error) {
      console.error("Preview generation failed:", error);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const entries = await getFilteredEntries();

      if (entries.length === 0) {
        alert('No entries found for the selected criteria.');
        setIsExporting(false);
        return;
      }

      // Group entries by worker
      const groupedByWorker: { [key: string]: TimesheetEntry[] } = {};
      entries.forEach(e => {
        if (!groupedByWorker[e.workerName]) groupedByWorker[e.workerName] = [];
        groupedByWorker[e.workerName].push(e);
      });

      // Generate CSV
      const headers = ['Worker Name', 'Worker ID', 'Date', 'Day', 'Time In', 'Time Out', 'Total W/H', 'Basic', 'B.OT', 'E.OT', 'N.OT', 'Holiday', 'Benefit', 'Notes'];
      const rows: string[][] = [headers];
      
      const [year, month] = selectedMonth.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      
      const workersToReport = selectedWorkerId === 'all' 
        ? workers 
        : workers.filter(w => w.uid === selectedWorkerId);

      workersToReport.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '')).forEach(worker => {
        const workerName = worker.displayName || worker.email || 'Unknown';
        const workerId = worker.email?.replace('@company.com', '') || '-';
        const workerEntries = entries.filter(e => e.workerId === worker.uid);
        
        let workerTotalHours = 0;
        let workerTotalBenefit = 0;

        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = `${selectedMonth}-${day.toString().padStart(2, '0')}`;
          const e = workerEntries.find(entry => entry.date === dateStr);
          const isFri = getDay(parseISO(dateStr)) === 5;
          const benefit = isFri ? getFridayBenefit(dateStr, workerEntries) : 0;
          
          if (e) {
            const rowTotal = e.totalHours + benefit;
            workerTotalHours += rowTotal;
            workerTotalBenefit += benefit;
            rows.push([
              e.workerName,
              workerId,
              e.date,
              format(parseISO(e.date), 'EEE'),
              e.startTime,
              e.endTime,
              rowTotal.toFixed(2),
              e.basicWork.toString(),
              e.basicOT.toString(),
              e.extenOT.toString(),
              e.nightOT.toString(),
              e.holiday.toString(),
              benefit.toFixed(2),
              `"${e.notes || ''}"`
            ]);
          } else {
            workerTotalHours += benefit;
            workerTotalBenefit += benefit;
            rows.push([
              workerName,
              workerId,
              dateStr,
              format(parseISO(dateStr), 'EEE'),
              '-',
              '-',
              benefit.toFixed(2),
              '0',
              '0',
              '0',
              '0',
              '0',
              benefit.toFixed(2),
              '""'
            ]);
          }
        }
        // Add summary row for worker
        rows.push([
          'TOTAL',
          '',
          '',
          '',
          '',
          '',
          workerTotalHours.toFixed(2),
          '',
          '',
          '',
          '',
          '',
          workerTotalBenefit.toFixed(2),
          ''
        ]);
        // Add a blank row between workers
        rows.push(new Array(headers.length).fill(''));
      });

      const csvContent = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `timesheet_report_${selectedMonth}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export report.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportExcelGrid = async () => {
    setIsExportingGrid(true);
    try {
      const entries = await getFilteredEntries();

      if (entries.length === 0) {
        alert('No entries found for the selected criteria.');
        setIsExportingGrid(false);
        return;
      }

      // Get all days in the selected month
      const [year, month] = selectedMonth.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      const start = startOfMonth(parseISO(`${selectedMonth}-01`));
      const monthTitle = format(start, 'MMMM yyyy');
      
      // Group entries by worker
      const groupedByWorker: { [key: string]: { [day: number]: number } } = {};
      const workerNames = new Set<string>();
      
      entries.forEach(e => {
        workerNames.add(e.workerName);
        if (!groupedByWorker[e.workerName]) groupedByWorker[e.workerName] = {};
        if (e.date.startsWith(selectedMonth)) {
          const day = parseInt(e.date.split('-')[2]);
          groupedByWorker[e.workerName][day] = (groupedByWorker[e.workerName][day] || 0) + e.totalHours;
        }
      });

      // Add Weekly Benefits to the Grid (on Fridays)
      const end = endOfMonth(start);
      const fridays = eachDayOfInterval({ start, end }).filter(d => getDay(d) === 5);

      Array.from(workerNames).forEach(workerName => {
        const workerEntries = entries.filter(e => e.workerName === workerName);
        fridays.forEach(friday => {
          const day = friday.getDate();
          const dateStr = format(friday, 'yyyy-MM-dd');
          const benefit = getFridayBenefit(dateStr, workerEntries);
          if (benefit > 0) {
            groupedByWorker[workerName][day] = (groupedByWorker[workerName][day] || 0) + benefit;
          }
        });
      });

      // Create Excel Workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Timesheet Grid');

      // Title
      worksheet.addRow([`Timesheet Report - ${monthTitle}`]);
      worksheet.mergeCells(1, 1, 1, daysInMonth + 2);
      const titleCell = worksheet.getCell(1, 1);
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { horizontal: 'center' };

      worksheet.addRow([]); // Empty row

      // Headers
      const headers = ['Worker Name', ...Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString()), 'Total Hours'];
      const headerRow = worksheet.addRow(headers);
      headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };

        // Highlight Fridays in header
        if (colNumber > 1 && colNumber <= daysInMonth + 1) {
          const day = colNumber - 1;
          const date = new Date(year, month - 1, day);
          if (getDay(date) === 5) {
            cell.font = { bold: true, color: { argb: 'FFFF0000' } };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFEAEA' }
            };
          }
        }
      });

      // Data Rows
      Array.from(workerNames).sort().forEach(workerName => {
        const rowData: (string | number)[] = [workerName];
        let workerTotal = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          const hours = groupedByWorker[workerName][day] || 0;
          rowData.push(hours > 0 ? hours : 0);
          workerTotal += hours;
        }
        rowData.push(parseFloat(workerTotal.toFixed(2)));
        
        const row = worksheet.addRow(rowData);
        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };

          // Highlight Fridays in data
          if (colNumber > 1 && colNumber <= daysInMonth + 1) {
            const day = colNumber - 1;
            const date = new Date(year, month - 1, day);
            if (getDay(date) === 5) {
              cell.font = { color: { argb: 'FFFF0000' }, bold: true };
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFF0F0' }
              };
            }
          }
          
          if (colNumber === daysInMonth + 2) {
            cell.font = { bold: true };
          }
        });
      });

      // Grand Total Row
      const grandTotalData: (string | number)[] = ['GRAND TOTAL'];
      let grandTotal = 0;
      const dayTotals = new Array(daysInMonth).fill(0);

      Array.from(workerNames).forEach(workerName => {
        for (let day = 1; day <= daysInMonth; day++) {
          const hours = groupedByWorker[workerName][day] || 0;
          dayTotals[day - 1] += hours;
          grandTotal += hours;
        }
      });

      dayTotals.forEach(total => grandTotalData.push(parseFloat(total.toFixed(2))));
      grandTotalData.push(parseFloat(grandTotal.toFixed(2)));

      const grandTotalRow = worksheet.addRow(grandTotalData);
      grandTotalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF00' } // Yellow background for grand total
        };
        cell.border = {
          top: { style: 'medium' },
          left: { style: 'thin' },
          bottom: { style: 'medium' },
          right: { style: 'thin' }
        };
      });

      // Column widths
      worksheet.getColumn(1).width = 25;
      for (let i = 2; i <= daysInMonth + 1; i++) {
        worksheet.getColumn(i).width = 5;
      }
      worksheet.getColumn(daysInMonth + 2).width = 15;

      // Save file
      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `timesheet_grid_${selectedMonth}.xlsx`);
    } catch (error) {
      console.error("Grid export failed:", error);
      alert("Failed to export grid report.");
    } finally {
      setIsExportingGrid(false);
    }
  };

  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      const entries = await getFilteredEntries();

      if (entries.length === 0) {
        alert('No entries found for the selected criteria.');
        setIsExportingPDF(false);
        return;
      }

      const doc = new jsPDF();
      const reportTitle = selectedWorkerId === 'all' ? 'Company Timesheet Report' : `Timesheet Report: ${entries[0]?.workerName}`;
      
      doc.setFontSize(20);
      doc.text(reportTitle, 14, 22);
      doc.setFontSize(12);
      doc.text(`Month: ${selectedMonth}`, 14, 32);

      const [year, month] = selectedMonth.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      
      const workersToReport = selectedWorkerId === 'all' 
        ? workers 
        : workers.filter(w => w.uid === selectedWorkerId);

      let currentY = 40;

      workersToReport.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '')).forEach((worker, index) => {
        if (index > 0) {
          doc.addPage();
          currentY = 20;
        }

        const workerName = worker.displayName || worker.email || 'Unknown';
        const workerId = worker.email?.replace('@company.com', '') || '-';
        doc.setFontSize(16);
        doc.text(`Worker: ${workerName} (${workerId})`, 14, currentY);
        currentY += 10;

        const workerEntries = entries.filter(e => e.workerId === worker.uid);
        
        const tableData: any[][] = [];
        let workerTotal = 0;

        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = `${selectedMonth}-${day.toString().padStart(2, '0')}`;
          const e = workerEntries.find(entry => entry.date === dateStr);
          const isFri = getDay(parseISO(dateStr)) === 5;
          const benefit = isFri ? getFridayBenefit(dateStr, workerEntries) : 0;
          
          if (e) {
            tableData.push([
              e.date,
              format(parseISO(e.date), 'EEE'),
              e.startTime,
              e.endTime,
              (e.totalHours + benefit).toFixed(2),
              e.basicWork,
              e.basicOT,
              e.extenOT,
              e.nightOT,
              e.holiday,
              benefit.toFixed(2),
              e.notes || '-'
            ]);
            workerTotal += (e.totalHours + benefit);
          } else {
            tableData.push([
              dateStr,
              format(parseISO(dateStr), 'EEE'),
              '-',
              '-',
              benefit.toFixed(2),
              '0',
              '0',
              '0',
              '0',
              '0',
              benefit.toFixed(2),
              '-'
            ]);
            workerTotal += benefit;
          }
        }

        autoTable(doc, {
          startY: currentY,
          head: [['Date', 'Day', 'In', 'Out', 'Total', 'Basic', 'B.OT', 'E.OT', 'N.OT', 'Hol', 'Ben', 'Notes']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
          styles: { 
            fontSize: 7,
            lineWidth: 0.3,
            lineColor: [0, 0, 0]
          },
          tableLineWidth: 0.5,
          tableLineColor: [0, 0, 0],
          didParseCell: function (data) {
            if (data.section === 'body') {
              const dayName = data.row.cells[1].text[0];
              if (dayName === 'Fri') {
                data.cell.styles.fillColor = [254, 242, 242];
                data.cell.styles.textColor = [220, 38, 38];
                data.cell.styles.fontStyle = 'bold';
              }
            }
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY || currentY;
        doc.setFontSize(12);
        doc.text(`Worker Total Hours: ${workerTotal.toFixed(2)}`, 14, finalY + 10);
        currentY = finalY + 20;
      });

      doc.save(`timesheet_report_${selectedMonth}.pdf`);
    } catch (error) {
      console.error("PDF Export failed:", error);
      alert("Failed to export PDF.");
    } finally {
      setIsExportingPDF(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Monthly Reports</h1>
        <p className="text-gray-500">Download and export worker timesheets</p>
      </div>

      <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Select Month</label>
            <input 
              type="month" 
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none" 
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Select Worker</label>
            <select 
              value={selectedWorkerId}
              onChange={(e) => setSelectedWorkerId(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">All Workers</option>
              {workers.map(w => (
                <option key={w.uid} value={w.uid}>{w.displayName || w.email}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={generateReportPreview}
            disabled={isPreviewLoading}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-6 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 active:scale-95 disabled:opacity-50"
          >
            <LayoutDashboard className="w-5 h-5" /> {isPreviewLoading ? 'Generating...' : 'View Report'}
          </button>
          <button 
            onClick={handleExportCSV}
            disabled={isExporting}
            className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 py-3 px-6 rounded-xl font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <Download className="w-5 h-5" /> {isExporting ? 'Exporting CSV...' : 'Download CSV'}
          </button>
          <button 
            onClick={handleExportExcelGrid}
            disabled={isExportingGrid}
            className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 py-3 px-6 rounded-xl font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <FileText className="w-5 h-5" /> {isExportingGrid ? 'Exporting Grid...' : 'Download Excel Grid'}
          </button>
          <button 
            onClick={handleExportPDF}
            disabled={isExportingPDF}
            className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 py-3 px-6 rounded-xl font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <Download className="w-5 h-5" /> {isExportingPDF ? 'Exporting PDF...' : 'Download PDF'}
          </button>
        </div>
        
        <p className="mt-6 text-sm text-gray-400 italic">
          * Reports can be viewed online or downloaded in CSV and PDF formats.
        </p>
      </div>

      {reportData.length > 0 && (
        <div className="space-y-12">
          {reportData.map(({ worker, rows }) => {
            const totalHours = rows.reduce((sum, r) => sum + r.totalHours, 0);
            const totalBenefit = rows.reduce((sum, r) => sum + r.weeklyBenefit, 0);
            const grandTotal = totalHours;

            return (
              <div key={worker.uid} className="bg-white rounded-2xl border-4 border-gray-900 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="px-6 py-4 border-b-4 border-gray-900 bg-gray-50/50 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{worker.displayName || worker.email} ({worker.email?.replace('@company.com', '')})</h2>
                    <p className="text-sm text-gray-500">Timesheet for {format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Monthly Hours</p>
                    <p className="text-2xl font-black text-blue-600">{grandTotal.toFixed(2)}</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse border-4 border-gray-900">
                    <thead className="bg-gray-50 border-b-4 border-gray-900">
                      <tr>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">Date</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">Day</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">In</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">Out</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">Total</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">Basic</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">B.OT</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">E.OT</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">N.OT</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">Hol</th>
                        <th className="px-4 py-3 font-bold text-gray-900 border-r-4 border-gray-900">Ben</th>
                        <th className="px-4 py-3 font-bold text-gray-900">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-gray-900">
                      {rows.map((row, idx) => (
                        <tr key={idx} className={cn(
                          "hover:bg-gray-50/50 transition-colors",
                          row.dayName === 'Fri' ? "bg-red-50 text-red-600 font-bold" : ""
                        )}>
                          <td className="px-4 py-3 font-mono text-xs border-r-4 border-gray-900">{row.date}</td>
                          <td className="px-4 py-3 font-bold border-r-4 border-gray-900">{row.dayName}</td>
                          <td className="px-4 py-3 border-r-4 border-gray-900">{row.startTime}</td>
                          <td className="px-4 py-3 border-r-4 border-gray-900">{row.endTime}</td>
                          <td className="px-4 py-3 font-bold border-r-4 border-gray-900">{row.totalHours > 0 ? row.totalHours.toFixed(2) : '-'}</td>
                          <td className="px-4 py-3 border-r-4 border-gray-900">{row.basicWork || '-'}</td>
                          <td className="px-4 py-3 border-r-4 border-gray-900">{row.basicOT || '-'}</td>
                          <td className="px-4 py-3 border-r-4 border-gray-900">{row.extenOT || '-'}</td>
                          <td className="px-4 py-3 border-r-4 border-gray-900">{row.nightOT || '-'}</td>
                          <td className="px-4 py-3 font-bold border-r-4 border-gray-900">{row.holiday || '-'}</td>
                          <td className="px-4 py-3 font-bold border-r-4 border-gray-900">{row.weeklyBenefit > 0 ? row.weeklyBenefit.toFixed(2) : '-'}</td>
                          <td className="px-4 py-3 italic text-xs truncate max-w-[150px]">{row.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-bold border-t-4 border-gray-900">
                      <tr>
                        <td colSpan={4} className="px-4 py-4 text-right text-gray-900 uppercase tracking-wider text-xs border-r-4 border-gray-900">Monthly Totals:</td>
                        <td className="px-4 py-4 text-gray-900 border-r-4 border-gray-900">{grandTotal.toFixed(2)}</td>
                        <td className="px-4 py-4 text-gray-900 border-r-4 border-gray-900">{rows.reduce((sum, r) => sum + r.basicWork, 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-gray-900 border-r-4 border-gray-900">{rows.reduce((sum, r) => sum + r.basicOT, 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-gray-900 border-r-4 border-gray-900">{rows.reduce((sum, r) => sum + r.extenOT, 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-gray-900 border-r-4 border-gray-900">{rows.reduce((sum, r) => sum + r.nightOT, 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-blue-600 border-r-4 border-gray-900">{rows.reduce((sum, r) => sum + r.holiday, 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-green-600 border-r-4 border-gray-900">{totalBenefit.toFixed(2)}</td>
                        <td className="px-4 py-4"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

