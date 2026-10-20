// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// app/auth/AuthPageClient.tsx
"use client";

import './home.css';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useNavbarStore } from '@/store/useNavbarStore';
import { authApi } from '@/lib/realApi';
import ContactFormModal from '@/components/ContactFormModal';
import { PluginSlot } from '@/components/PluginSlot';
import MarkdownRenderer from '@/components/MarkdownRenderer';

interface AuthPageClientProps {
  articleContent: string;
  termsContent: string;
  privacyContent: string;
}

export default function AuthPageClient({
  articleContent,
  termsContent,
  privacyContent
}: AuthPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, login, register, isAuthLoading, authError } = useNavbarStore();
  
  const t = useTranslations('Auth');

  const mode = searchParams.get('mode');
  const token = searchParams.get('token');

  // Состояние для модального окна
  const [modalContent, setModalContent] = useState<'terms' | 'privacy' | null>(null);
  const [isContactOpen, setIsContactOpen] = useState(false);

  // Редирект после успешной авторизации
  useEffect(() => {
    if (user && (pathname === '/' || pathname === '/login' || pathname === '/auth')) {
      router.replace('/workspace');
    }
  }, [user, router, pathname]);

  // ===== СОСТОЯНИЯ (STATE) =====
  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'forgot' | 'reset' | 'success' | 'activate'>('login');
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [passwordStrength, setPasswordStrength] = useState({
    label: '',
    color: 'bg-slate-300',
    width: 'w-0'
  });

  // Состояния для полей форм
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginErrors, setLoginErrors] = useState({ email: false, password: false });
  
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regTerms, setRegTerms] = useState(false);
  const [regErrors, setRegErrors] = useState({
    firstname: false, lastname: false, email: false, password: false, confirm: false, terms: false
  });

  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState(false);
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [forgotErrorMsg, setForgotErrorMsg] = useState('');

  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetErrors, setResetErrors] = useState({ password: false, confirm: false });
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [resetErrorMsg, setResetErrorMsg] = useState('');

  const [activateStatus, setActivateStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [activateMessage, setActivateMessage] = useState(t('activate.loadingText'));

  // ===== ФУНКЦИИ =====
  const switchTab = (tab: 'login' | 'register' | 'forgot' | 'reset' | 'success' | 'activate') => {
    setActiveTab(tab);
    setLoginErrors({ email: false, password: false });
    setRegErrors({ firstname: false, lastname: false, email: false, password: false, confirm: false, terms: false });
    setForgotError(false);
    setForgotErrorMsg('');
    setResetErrors({ password: false, confirm: false });
    setResetErrorMsg('');
    if (tab !== 'activate' && tab !== 'reset') {
      router.replace(pathname, { scroll: false });
    }
  };

  useEffect(() => {
    if (mode === 'activate' && token) {
      setActiveTab('activate');
      handleActivate(token);
    } else if (mode === 'reset' && token) {
      setActiveTab('reset');
    } else if (mode === 'invite' && token) {
      setActiveTab('register');
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.sub) {
          setRegEmail(payload.sub);
        }
      } catch (e) {
        console.error('Не удалось декодировать токен приглашения', e);
      }
    }
  }, [mode, token]);

  const handleActivate = async (tkn: string) => {
    try {
      const response = await authApi.activate(tkn);
      setActivateStatus('success');
      setActivateMessage(response.message || t('activate.successDefault'));
      setTimeout(() => {
        setActiveTab('login');
        router.replace('/');
      }, 3000);
    } catch (err: any) {
      setActivateStatus('error');
      setActivateMessage(err.message || t('activate.errorDefault'));
    }
  };

  const togglePassword = (inputId: string) => {
    setShowPasswords(prev => ({ ...prev, [inputId]: !prev[inputId] }));
  };

  const checkPasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    let label = '';
    let color = 'bg-slate-300';
    let width = 'w-0';

    if (password.length === 0) {
      label = ''; width = 'w-0'; color = 'bg-slate-300';
    } else if (strength <= 1) {
      label = t('register.strength.weak'); width = 'w-1/4'; color = 'bg-red-500';
    } else if (strength === 2) {
      label = t('register.strength.medium'); width = 'w-2/4'; color = 'bg-yellow-500';
    } else if (strength === 3) {
      label = t('register.strength.good'); width = 'w-3/4'; color = 'bg-blue-500';
    } else {
      label = t('register.strength.strong'); width = 'w-full'; color = 'bg-green-500';
    }
    setPasswordStrength({ label, color, width });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = { email: !loginEmail, password: !loginPassword };
    setLoginErrors(errors);
    if (errors.email || errors.password) return;
    await login(loginEmail, loginPassword);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = {
      firstname: !regFirstName,
      lastname: !regLastName,
      email: !regEmail,
      password: regPassword.length < 8,
      confirm: regPassword !== regConfirmPassword,
      terms: !regTerms
    };
    setRegErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    const isSuccess = await register({
      email: regEmail,
      password: regPassword,
      first_name: regFirstName,
      last_name: regLastName,
    });

    if (isSuccess) {
      if (typeof window !== 'undefined' && (window as any).ym) {
        (window as any).ym(111041629, 'reachGoal', 'register_account');
      }
      switchTab('success');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) {
      setForgotError(true);
      return;
    }
    setForgotError(false);
    setForgotErrorMsg('');
    setIsForgotLoading(true);
    try {
      await authApi.forgotPassword(forgotEmail);
      switchTab('success');
    } catch (err: any) {
      setForgotErrorMsg(err.message || t('forgot.errors.general'));
    } finally {
      setIsForgotLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = {
      password: resetPassword.length < 8,
      confirm: resetPassword !== resetConfirmPassword
    };
    setResetErrors(errors);
    if (errors.password || errors.confirm) return;

    setIsResetLoading(true);
    setResetErrorMsg('');
    try {
      if (!token) throw new Error('Токен сброса не найден в ссылке');
      await authApi.resetPassword(token, resetPassword);
      switchTab('success');
      setTimeout(() => {
        router.replace('/');
      }, 3000);
    } catch (err: any) {
      setResetErrorMsg(err.message || t('reset.errors.general'));
    } finally {
      setIsResetLoading(false);
    }
  };

  if (user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <>
      <PluginSlot name="counter-init" />
      <div className="flex w-full" style={{ height: "100dvh" }}>
        {/* ===== LEFT PANEL — BRANDING & ARTICLE ===== */}
        <div id="brand-panel" className="flex w-full lg:w-[52%] xl:w-[55%] relative flex-col overflow-y-auto" style={{ background: "linear-gradient(145deg, #1e40af 0%, #1d4ed8 35%, #2563eb 65%, #3b82f6 100%)" }}>
          {/* Декоративные фоновые элементы */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(147,197,253,0.15), transparent 70%)' }}></div>
            <div className="absolute top-1/2 -left-20 w-64 h-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(96,165,250,0.1), transparent 70%)' }}></div>
            <div className="absolute -bottom-16 right-8 w-80 h-80 rounded-full" style={{ background: 'radial-gradient(circle, rgba(191,219,254,0.12), transparent 70%)' }}></div>
            <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '44px 44px' }}></div>
          </div>
          
          <div className="relative z-10 flex flex-col min-h-full px-6 py-10 lg:px-10 xl:px-14">
            {/* Шапка с логотипом и навигацией */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-white/20 text-white rounded-xl flex items-center justify-center border border-white/20 backdrop-blur-sm shadow-sm">
                  <i className="fa-solid fa-scale-balanced text-sm"></i>
                </div>
                <span className="text-white font-bold text-xl tracking-tight">{t('brand.name')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a href="/analysis" className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-transparent border border-white hover:bg-white/10 rounded-xl transition-all">
                  {t('header.checkContract')}
                </a>
                <a href="/partner" className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-transparent border border-white hover:bg-white/10 rounded-xl transition-all">
                  {t('header.becomePartner')}
                </a>
                <button 
                  onClick={() => {
                    if (typeof window !== 'undefined' && (window as any).ym) {
                      (window as any).ym(111041629, 'reachGoal', 'open_consultation');
                    }
                    setIsContactOpen(true);
                  }} 
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-900 bg-white hover:bg-blue-50 rounded-xl transition-all shadow-sm"
                >
                  <i className="fa-solid fa-headset text-xs"></i> {t('header.consultation')}
                </button>
              </div>
            </div>

            {/* Основной контент: Заголовок и Статья */}
            <div className="flex-1 flex flex-col justify-center mt-8 max-w-xl">
              <div className="mb-4">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/15 border border-white/20 rounded-full text-xs font-semibold text-blue-100">
                  <i className="fa-solid fa-hand-sparkles text-[10px]"></i> {t('hero.badge')}
                </span>
              </div>
              <div className="pb-10">
                <MarkdownRenderer 
                  content={articleContent} 
                  className="prose-invert max-w-none text-blue-100 text-white prose-headings:text-white prose-strong:text-white prose-blockquote:border-blue-300 prose-blockquote:text-blue-200" 
                />
              </div>
            </div>
          </div>
        </div>

        {/* ===== RIGHT PANEL — AUTH FORM ===== */}
        <div id="auth-panel" className="hidden lg:flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 bg-white">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-primary-600 rounded-xl flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-base">
                <i className="fa-solid fa-scale-balanced text-sm"></i>
              </span>
            </div>
            <span className="text-slate-800 font-bold text-xl tracking-tight">{t('brand.name')}</span>
          </div>

          <div className="w-full max-w-sm fade-in">
            <div className="mb-7" id="auth-heading">
              <h2 className="text-2xl font-extrabold text-slate-900 mb-1.5" id="auth-title">
                {activeTab === 'register' ? t('auth.title.register') : 
                 activeTab === 'forgot' ? t('auth.title.forgot') : 
                 activeTab === 'reset' ? t('auth.title.reset') :
                 activeTab === 'activate' ? t('auth.title.activate') :
                 t('auth.title.login')}
              </h2>
              <p className="text-sm text-slate-500" id="auth-subtitle">
                {activeTab === 'register' ? t('auth.subtitle.register') : 
                 activeTab === 'forgot' ? t('auth.subtitle.forgot') : 
                 activeTab === 'reset' ? t('auth.subtitle.reset') :
                 activeTab === 'activate' ? t('auth.subtitle.activate') :
                 t('auth.subtitle.login')}
              </p>
            </div>

            {/* Tab switcher */}
            {activeTab !== 'reset' && activeTab !== 'activate' && activeTab !== 'success' && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl mb-6">
                <button id="tab-login" className={`auth-tab ${activeTab === 'login' || activeTab === 'forgot' ? 'active' : ''}`} onClick={() => switchTab('login')}>{t('tabs.login')}</button>
                <button id="tab-register" className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`} onClick={() => switchTab('register')}>{t('tabs.register')}</button>
              </div>
            )}

            {/* LOGIN FORM */}
            <div id="login-form" className={`panel-slide ${activeTab === 'login' ? 'panel-visible' : 'panel-hidden'}`}>
              <form onSubmit={handleLogin} noValidate>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('login.email')}</label>
                    <div className="relative">
                      <i className="fa-solid fa-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input id="login-email" type="email" className="form-input pl-9" placeholder={t('login.placeholders.email')} autoComplete="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
                    </div>
                    <p id="login-email-error" className={`text-[11px] text-red-500 mt-1 ${loginErrors.email ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('login.errors.email')}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-700">{t('login.password')}</label>
                      <button type="button" onClick={() => switchTab('forgot')} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium transition-colors">{t('login.forgot')}</button>
                    </div>
                    <div className="relative">
                      <i className="fa-solid fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input id="login-password" type={showPasswords['login-password'] ? 'text' : 'password'} className="form-input pl-9 pr-10" placeholder={t('login.placeholders.password')} autoComplete="current-password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
                      <button type="button" onClick={() => togglePassword('login-password')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                        <i className={`fa-regular ${showPasswords['login-password'] ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                      </button>
                    </div>
                    <p id="login-password-error" className={`text-[11px] text-red-500 mt-1 ${loginErrors.password ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('login.errors.password')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="remember-me" className="w-4 h-4 accent-primary-600 rounded cursor-pointer" />
                    <label htmlFor="remember-me" className="text-xs text-slate-600 cursor-pointer select-none">{t('login.remember')}</label>
                  </div>
                </div>
                <div id="login-general-error" className={`mt-4 flex items-center gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl ${authError ? '' : 'hidden'}`}>
                  <i className="fa-solid fa-triangle-exclamation text-red-500 text-xs shrink-0"></i>
                  <span className="text-xs text-red-600 font-medium">{authError || t('login.errors.general')}</span>
                </div>
                <button type="submit" id="login-submit-btn" disabled={isAuthLoading} className="mt-5 w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                  <span id="login-btn-text">{isAuthLoading ? t('login.loading') : t('login.submit')}</span>
                  <span id="login-btn-spinner" className={isAuthLoading ? '' : 'hidden'}><i className="fa-solid fa-circle-notch fa-spin text-sm"></i></span>
                  <i id="login-btn-icon" className={`fa-solid fa-arrow-right text-xs ${isAuthLoading ? 'hidden' : ''}`}></i>
                </button>
              </form>
            </div>

            {/* REGISTER FORM */}
            <div id="register-form" className={`panel-slide ${activeTab === 'register' ? 'panel-visible' : 'panel-hidden'}`}>
              <form onSubmit={handleRegister} noValidate>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('register.firstName')} <span className="text-red-500">*</span></label>
                      <input id="reg-firstname" type="text" className="form-input" placeholder={t('register.placeholders.firstName')} autoComplete="given-name" value={regFirstName} onChange={(e) => setRegFirstName(e.target.value)} />
                      <p id="reg-firstname-error" className={`text-[11px] text-red-500 mt-1 ${regErrors.firstname ? '' : 'hidden'}`}>
                        <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('register.errors.firstName')}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('register.lastName')} <span className="text-red-500">*</span></label>
                      <input id="reg-lastname" type="text" className="form-input" placeholder={t('register.placeholders.lastName')} autoComplete="family-name" value={regLastName} onChange={(e) => setRegLastName(e.target.value)} />
                      <p id="reg-lastname-error" className={`text-[11px] text-red-500 mt-1 ${regErrors.lastname ? '' : 'hidden'}`}>
                        <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('register.errors.lastName')}
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('register.workEmail')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <i className="fa-solid fa-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input 
                        id="reg-email" 
                        type="email" 
                        className="form-input pl-9" 
                        placeholder={t('register.placeholders.email')} 
                        autoComplete="email" 
                        value={regEmail} 
                        onChange={(e) => setRegEmail(e.target.value)} 
                        readOnly={mode === 'invite'} 
                      />
                    </div>
                    <p id="reg-email-error" className={`text-[11px] text-red-500 mt-1 ${regErrors.email ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('register.errors.email')}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('register.password')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <i className="fa-solid fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input id="reg-password" type={showPasswords['reg-password'] ? 'text' : 'password'} className="form-input pl-9 pr-10" placeholder={t('register.placeholders.password')} autoComplete="new-password" value={regPassword} onChange={(e) => { setRegPassword(e.target.value); checkPasswordStrength(e.target.value); }} />
                      <button type="button" onClick={() => togglePassword('reg-password')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                        <i className={`fa-regular ${showPasswords['reg-password'] ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                        <div id="strength-bar" className={`password-strength-bar h-full ${passwordStrength.width} ${passwordStrength.color}`}></div>
                      </div>
                      <span id="strength-label" className="text-[10px] text-slate-400 font-medium min-w-[60px]">{passwordStrength.label}</span>
                    </div>
                    <p id="reg-password-error" className={`text-[11px] text-red-500 mt-1 ${regErrors.password ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('register.errors.password')}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('register.confirmPassword')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <i className="fa-solid fa-lock-open absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input id="reg-password-confirm" type={showPasswords['reg-password-confirm'] ? 'text' : 'password'} className="form-input pl-9 pr-10" placeholder={t('register.placeholders.confirmPassword')} autoComplete="new-password" value={regConfirmPassword} onChange={(e) => setRegConfirmPassword(e.target.value)} />
                      <button type="button" onClick={() => togglePassword('reg-password-confirm')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                        <i className={`fa-regular ${showPasswords['reg-password-confirm'] ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                      </button>
                    </div>
                    <p id="reg-confirm-error" className={`text-[11px] text-red-500 mt-1 ${regErrors.confirm ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('register.errors.confirm')}
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <input type="checkbox" id="reg-terms" className="w-4 h-4 accent-primary-600 rounded cursor-pointer mt-0.5 shrink-0" checked={regTerms} onChange={(e) => setRegTerms(e.target.checked)} />
                    <label htmlFor="reg-terms" className="text-xs text-slate-600 leading-relaxed cursor-pointer select-none">
                      {/* Используем t.rich для вставки интерактивных элементов внутрь строки */}
                      {t.rich('register.termsText', {
                        terms: (chunks) => (
                          <button type="button" onClick={() => setModalContent('terms')} className="text-primary-600 hover:underline font-medium">
                            {chunks}
                          </button>
                        ),
                        privacy: (chunks) => (
                          <button type="button" onClick={() => setModalContent('privacy')} className="text-primary-600 hover:underline font-medium">
                            {chunks}
                          </button>
                        )
                      })}
                    </label>
                  </div>
                  <p id="reg-terms-error" className={`text-[11px] text-red-500 -mt-2 ${regErrors.terms ? '' : 'hidden'}`}>
                    <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('register.errors.terms')}
                  </p>
                  <div className={`flex items-center gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl ${authError ? '' : 'hidden'}`}>
                    <i className="fa-solid fa-triangle-exclamation text-red-500 text-xs shrink-0"></i>
                    <span className="text-xs text-red-600 font-medium">{authError || t('register.errors.general')}</span>
                  </div>
                </div>
                <button type="submit" id="reg-submit-btn" disabled={isAuthLoading} className="mt-5 w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                  <span id="reg-btn-text">{isAuthLoading ? t('register.loading') : t('register.submit')}</span>
                  <span id="reg-btn-spinner" className={isAuthLoading ? '' : 'hidden'}> <i className="fa-solid fa-circle-notch fa-spin text-sm"></i> </span>
                  <i id="reg-btn-icon" className={`fa-solid fa-user-plus text-xs ${isAuthLoading ? 'hidden' : ''}`}></i>
                </button>
              </form>
            </div>

            {/* FORGOT PASSWORD FORM */}
            <div id="forgot-form" className={`panel-slide ${activeTab === 'forgot' ? 'panel-visible' : 'panel-hidden'}`}>
              <div className="mb-5 p-3.5 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-2.5">
                <i className="fa-solid fa-circle-info text-primary-500 text-sm shrink-0 mt-0.5"></i>
                <p className="text-xs text-slate-600 leading-relaxed">{t('forgot.info')}</p>
              </div>
              <form onSubmit={handleForgot} noValidate>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('forgot.email')}</label>
                    <div className="relative">
                      <i className="fa-solid fa-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input id="forgot-email" type="email" className="form-input pl-9" placeholder={t('forgot.placeholders.email')} autoComplete="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} disabled={isForgotLoading} />
                    </div>
                    <p id="forgot-email-error" className={`text-[11px] text-red-500 mt-1 ${forgotError ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('forgot.errors.email')}
                    </p>
                  </div>
                </div>
                {forgotErrorMsg && (
                  <div className="mt-4 flex items-center gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <i className="fa-solid fa-triangle-exclamation text-red-500 text-xs shrink-0"></i>
                    <span className="text-xs text-red-600 font-medium">{forgotErrorMsg}</span>
                  </div>
                )}
                <button type="submit" disabled={isForgotLoading} className="mt-5 w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                  <span>{isForgotLoading ? t('forgot.loading') : t('forgot.submit')}</span>
                  {isForgotLoading ? <i className="fa-solid fa-circle-notch fa-spin text-xs"></i> : <i className="fa-solid fa-paper-plane text-xs"></i>}
                </button>
                <button type="button" onClick={() => switchTab('login')} disabled={isForgotLoading} className="mt-3 w-full py-2 text-xs text-slate-500 hover:text-slate-700 font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                  <i className="fa-solid fa-arrow-left text-[10px]"></i> {t('forgot.back')}
                </button>
              </form>
            </div>

            {/* RESET PASSWORD FORM */}
            <div id="reset-form" className={`panel-slide ${activeTab === 'reset' ? 'panel-visible' : 'panel-hidden'}`}>
              <div className="mb-5 p-3.5 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-2.5">
                <i className="fa-solid fa-shield-halved text-primary-500 text-sm shrink-0 mt-0.5"></i>
                <p className="text-xs text-slate-600 leading-relaxed">{t('reset.info')}</p>
              </div>
              <form onSubmit={handleReset} noValidate>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('reset.password')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <i className="fa-solid fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input id="reset-password" type={showPasswords['reset-password'] ? 'text' : 'password'} className="form-input pl-9 pr-10" placeholder={t('reset.placeholders.password')} autoComplete="new-password" value={resetPassword} onChange={(e) => { setResetPassword(e.target.value); checkPasswordStrength(e.target.value); }} />
                      <button type="button" onClick={() => togglePassword('reset-password')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                        <i className={`fa-regular ${showPasswords['reset-password'] ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full ${passwordStrength.width} ${passwordStrength.color}`}></div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium min-w-[60px]">{passwordStrength.label}</span>
                    </div>
                    <p className={`text-[11px] text-red-500 mt-1 ${resetErrors.password ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('reset.errors.password')}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('reset.confirmPassword')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <i className="fa-solid fa-lock-open absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                      <input id="reset-password-confirm" type={showPasswords['reset-password-confirm'] ? 'text' : 'password'} className="form-input pl-9 pr-10" placeholder={t('reset.placeholders.confirmPassword')} autoComplete="new-password" value={resetConfirmPassword} onChange={(e) => setResetConfirmPassword(e.target.value)} />
                      <button type="button" onClick={() => togglePassword('reset-password-confirm')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                        <i className={`fa-regular ${showPasswords['reset-password-confirm'] ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                      </button>
                    </div>
                    <p className={`text-[11px] text-red-500 mt-1 ${resetErrors.confirm ? '' : 'hidden'}`}>
                      <i className="fa-solid fa-circle-exclamation mr-1"></i>{t('reset.errors.confirm')}
                    </p>
                  </div>
                </div>
                {resetErrorMsg && (
                  <div className="mt-4 flex items-center gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <i className="fa-solid fa-triangle-exclamation text-red-500 text-xs shrink-0"></i>
                    <span className="text-xs text-red-600 font-medium">{resetErrorMsg}</span>
                  </div>
                )}
                <button type="submit" disabled={isResetLoading} className="mt-5 w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                  <span>{isResetLoading ? t('reset.loading') : t('reset.submit')}</span>
                  {isResetLoading ? <i className="fa-solid fa-circle-notch fa-spin text-xs"></i> : <i className="fa-solid fa-check text-xs"></i>}
                </button>
                <button type="button" onClick={() => switchTab('login')} disabled={isResetLoading} className="mt-3 w-full py-2 text-xs text-slate-500 hover:text-slate-700 font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                  <i className="fa-solid fa-arrow-left text-[10px]"></i> {t('reset.back')}
                </button>
              </form>
            </div>

            {/* ACTIVATE STATUS */}
            <div id="activate-panel" className={`panel-slide ${activeTab === 'activate' ? 'panel-visible' : 'panel-hidden'} text-center py-4`}>
              {activateStatus === 'loading' && (
                <>
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i className="fa-solid fa-circle-notch fa-spin text-primary-500 text-2xl"></i>
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">{t('activate.loadingTitle')}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed mb-6">{t('activate.loadingText')}</p>
                </>
              )}
              {activateStatus === 'success' && (
                <>
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i className="fa-solid fa-check text-green-500 text-2xl"></i>
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">{t('activate.successTitle')}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed mb-6">{activateMessage}</p>
                </>
              )}
              {activateStatus === 'error' && (
                <>
                  <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i className="fa-solid fa-triangle-exclamation text-red-500 text-2xl"></i>
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">{t('activate.errorTitle')}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed mb-6">{activateMessage}</p>
                  <button onClick={() => switchTab('login')} className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md">
                    {t('activate.back')}
                  </button>
                </>
              )}
            </div>

            {/* SUCCESS STATE */}
            <div id="success-panel" className={`panel-slide ${activeTab === 'success' ? 'panel-visible' : 'panel-hidden'} text-center py-4`}>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fa-solid fa-envelope-circle-check text-green-500 text-2xl"></i>
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">{t('success.title')}</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-6">{t('success.text')}</p>
              <button onClick={() => switchTab('login')} className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md">
                {t('success.back')}
              </button>
            </div>
          </div>

          <div className="mt-8 text-center space-y-2">
            <p className="text-[11px] text-slate-400">{t('footer.copyright')}</p>
          </div>
        </div>
      </div>

      {/* МОДАЛЬНОЕ ОКНО */}
      {modalContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-2xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slideUp">
            {/* Заголовок модального окна */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">
                {modalContent === 'terms' ? t('modal.termsTitle') : t('modal.privacyTitle')}
              </h3>
              <button 
                onClick={() => setModalContent(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 transition-colors"
              >
                <i className="fa-solid fa-xmark text-slate-500"></i>
              </button>
            </div>
            {/* Контент модального окна */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <MarkdownRenderer 
                content={modalContent === 'terms' ? termsContent : privacyContent} 
                className="prose prose-sm max-w-none text-slate-600 
                          prose-h2:text-xl prose-h2:font-bold prose-h2:text-slate-900 prose-h2:mb-4 prose-h2:mt-6
                          prose-h3:text-lg prose-h3:font-semibold prose-h3:text-slate-800 prose-h3:mb-2 prose-h3:mt-4
                          prose-headings:text-slate-800 
                          prose-strong:text-slate-800 
                          prose-a:text-primary-600 hover:prose-a:underline" 
              />
            </div>
            {/* Футер модального окна */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button 
                onClick={() => setModalContent(null)}
                className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md"
              >
                {t('modal.close')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ContactFormModal isOpen={isContactOpen} onClose={() => setIsContactOpen(false)} />
    </>
  );
}