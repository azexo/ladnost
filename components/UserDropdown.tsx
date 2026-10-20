// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useNavbarStore } from '@/store/useNavbarStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import SubscriptionModal from '@/components/SubscriptionModal';
import { apiKeysApi } from '@/lib/realApi';
import { ApiKeyResponse } from '@/lib/types';
import { PluginSlot } from '@/components/PluginSlot';

export default function UserDropdown() {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('UserDropdown');

  // Состояния дропдауна
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isModalBillingOpen, setIsModalBillingOpen] = useState(false);
  
  // Состояния модалки настроек профиля
  const [isModalSettingsOpen, setIsModalSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    first_name: '', last_name: '', middle_name: '',
    current_password: '', new_password: '', confirm_password: '',
    avatar_url: '',
  });
  const [isSettingsSubmitting, setIsSettingsSubmitting] = useState(false);
  
  // Состояния модалки API-ключей
  const [isModalApiKeysOpen, setIsModalApiKeysOpen] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyResponse[]>([]);
  const [isApiKeysLoading, setIsApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [createdFullKey, setCreatedFullKey] = useState<string | null>(null);
  const [isKeyCopied, setIsKeyCopied] = useState(false);

  // Стор пользователей
  const user = useNavbarStore((s) => s.user);
  const notifications = useNavbarStore((s) => s.notifications);
  const unreadCount = useNavbarStore((s) => s.unreadCount);
  const fetchNotifications = useNavbarStore((s) => s.fetchNotifications);
  const markAsRead = useNavbarStore((s) => s.markAsRead);
  const markAllAsRead = useNavbarStore((s) => s.markAllAsRead);
  const logout = useNavbarStore((s) => s.logout);
  const updateProfile = useNavbarStore((s) => s.updateProfile);

  // Стор воркспейса
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);

  // Загрузка уведомлений
  useEffect(() => {
    if (user) fetchNotifications();
  }, [user, fetchNotifications]);

  // Закрытие при клике вне
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Обработка Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalSettingsOpen(false);
        setIsModalApiKeysOpen(false);
        setIsUserDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Handlers: Settings ---
  const openSettingsModal = () => {
    if (user) {
      setSettingsForm({
        first_name: user.first_name || '', last_name: user.last_name || '', middle_name: user.middle_name || '',
        current_password: '', new_password: '', confirm_password: '',
        avatar_url: user.avatar_url || '/default-avatar.svg',
      });
    }
    setIsModalSettingsOpen(true);
    setIsUserDropdownOpen(false);
  };

  const closeSettingsModal = () => setIsModalSettingsOpen(false);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSettingsForm(prev => ({ ...prev, avatar_url: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  const handleSettingsSubmit = async () => {
    if (!settingsForm.first_name.trim() || !settingsForm.last_name.trim()) {
      alert(t('alerts.nameRequired')); return;
    }
    if (settingsForm.new_password && settingsForm.new_password !== settingsForm.confirm_password) {
      alert(t('alerts.passwordsMismatch')); return;
    }
    if (settingsForm.new_password && !settingsForm.current_password) {
      alert(t('alerts.currentPasswordRequired')); return;
    }

    setIsSettingsSubmitting(true);
    try {
      const payload: any = {};
      if (settingsForm.first_name !== user?.first_name) payload.first_name = settingsForm.first_name;
      if (settingsForm.last_name !== user?.last_name) payload.last_name = settingsForm.last_name;
      if (settingsForm.middle_name !== user?.middle_name) payload.middle_name = settingsForm.middle_name;
      if (settingsForm.avatar_url !== user?.avatar_url) payload.avatar_url = settingsForm.avatar_url;
      
      if (settingsForm.new_password) {
        payload.password = settingsForm.current_password;
        payload.new_password = settingsForm.new_password;
      }

      if (Object.keys(payload).length > 0) {
        await updateProfile(payload);
        alert(t('alerts.settingsSaved'));
        closeSettingsModal();
      } else {
        closeSettingsModal();
      }
    } catch (error: any) {
      alert(error.message || t('alerts.settingsSaveError'));
    } finally {
      setIsSettingsSubmitting(false);
    }
  };

  // --- Handlers: API Keys ---
  const fetchApiKeys = async () => {
    if (!currentWorkspace) return;
    setIsApiKeysLoading(true);
    try {
      const keys = await apiKeysApi.list(currentWorkspace.id);
      setApiKeys(keys);
    } catch (error) {
      console.error(t('alerts.apiKeysLoadError'), error);
    } finally {
      setIsApiKeysLoading(false);
    }
  };

  const openApiKeysModal = () => {
    setIsModalApiKeysOpen(true);
    setIsUserDropdownOpen(false);
    setCreatedFullKey(null);
    fetchApiKeys();
  };

  const handleCreateApiKey = async () => {
    if (!currentWorkspace || !newKeyName.trim()) return;
    setIsCreatingKey(true);
    try {
      const res = await apiKeysApi.create(currentWorkspace.id, { name: newKeyName.trim() });
      setCreatedFullKey(res.full_key);
      setNewKeyName('');
      await fetchApiKeys();
    } catch (error) {
      console.error(t('alerts.apiKeyCreateError'), error);
      alert(t('alerts.apiKeyCreateError'));
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleToggleApiKey = async (keyId: number, isActive: boolean) => {
    if (!currentWorkspace) return;
    try {
      await apiKeysApi.toggle(currentWorkspace.id, keyId, { is_active: isActive });
      await fetchApiKeys();
    } catch (error) { 
      console.error(t('alerts.apiKeyUpdateError'), error); 
    }
  };

  const handleDeleteApiKey = async (keyId: number) => {
    if (!currentWorkspace) return;
    if (!confirm(t('alerts.apiKeyDeleteConfirm'))) return;
    try {
      await apiKeysApi.delete(currentWorkspace.id, keyId);
      await fetchApiKeys();
    } catch (error) { 
      console.error(t('alerts.apiKeyDeleteError'), error); 
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      setIsKeyCopied(true);
      setTimeout(() => setIsKeyCopied(false), 2000);
    });
  };

  const handleLogout = () => {
    logout();
    router.push('/');
    setIsUserDropdownOpen(false);
  };

  return (
    <>
      {/* ДРОПДАУН ПОЛЬЗОВАТЕЛЯ */}
      <div className="relative flex" id="avatar-wrapper" ref={dropdownRef}>
        <button onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)} className="relative">
          <img
            src={user?.avatar_url || '/default-avatar.svg'}
            alt="User"
            className="w-8 h-8 rounded-full border-2 border-slate-200 object-cover cursor-pointer hover:border-primary-400 transition-all"
          />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 rounded-full border-2 border-white text-[9px] text-white flex items-center justify-center font-bold">
              {unreadCount > 9 ? t('moreThanNine') : unreadCount}
            </span>
          )}
        </button>

        <div id="user-dropdown" className={`dropdown-menu absolute right-0 top-10 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-[200] overflow-hidden transition-all ${isUserDropdownOpen ? 'block' : 'hidden'}`}>
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <img src={user?.avatar_url || '/default-avatar.svg'} className="w-9 h-9 rounded-full object-cover" alt="Avatar" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">
                {user ? `${user.last_name} ${user.first_name}` : t('guest')}
              </div>
              <div className="text-xs text-slate-500 truncate">{user?.email || t('guestEmail')}</div>
            </div>
          </div>
          
          <div className="px-3 py-2 border-b border-slate-100 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between px-2 py-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{t('notifications')}</div>
              {unreadCount > 0 && (
                <button onClick={() => markAllAsRead()} className="text-[10px] text-primary-600 hover:text-primary-700 font-semibold">
                  {t('markAllAsRead')}
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">{t('noNotifications')}</div>
            ) : (
              notifications.map((notif) => (
                <div key={notif.id} onClick={() => !notif.is_read && markAsRead(notif.id)} className={`py-2 px-2 flex items-start gap-3 hover:bg-slate-50 rounded-lg cursor-pointer ${!notif.is_read ? 'bg-slate-50/50' : ''}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!notif.is_read ? 'bg-blue-500' : 'bg-transparent'}`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-800">{notif.title}</div>
                    <div className="text-xs text-slate-500 truncate">{notif.message}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(notif.created_at).toLocaleString(process.env.NEXT_FORMAT_LOCALE, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-3 py-2">
            <button onClick={openSettingsModal} className="w-full text-left px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-2">
              <i className="fa-solid fa-gear text-slate-400 w-4"></i> {t('profileSettings')}
            </button>
            <button onClick={() => { setIsModalBillingOpen(true); setIsUserDropdownOpen(false); }} className="w-full text-left px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-2">
              <i className="fa-solid fa-crown text-yellow-500 w-4"></i> {t('billingAndSubscription')}
            </button>
            
            {/* СЛОТ ДЛЯ ПЛАГИНА НАСТРОЕК ИИ */}
            <PluginSlot name="user-dropdown-ai-settings" />
            
            <button onClick={openApiKeysModal} className="w-full text-left px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-2">
              <i className="fa-solid fa-key text-slate-400 w-4"></i> {t('apiKeys')}
            </button>
            <button onClick={handleLogout} className="w-full text-left px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg flex items-center gap-2">
              <i className="fa-solid fa-right-from-bracket w-4"></i> {t('logout')}
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Settings */}
      <div id="modal-settings" className={`modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] items-center justify-center p-4 ${isModalSettingsOpen ? 'flex' : 'hidden'}`} onClick={closeSettingsModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
            <div>
              <h2 className="text-base font-bold text-slate-800">{t('settings.title')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('settings.subtitle')}</p>
            </div>
            <button onClick={closeSettingsModal} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-xmark"></i></button>
          </div>
          
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="flex items-center gap-4">
              <img src={settingsForm.avatar_url || '/default-avatar.svg'} alt="Avatar" className="w-16 h-16 rounded-full object-cover border-2 border-slate-200" />
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('settings.avatar')}</label>
                <input type="file" accept="image/*" onChange={handleAvatarChange} className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-600 hover:file:bg-primary-100 cursor-pointer" />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('settings.lastName')} <span className="text-red-500">*</span></label>
                <input type="text" value={settingsForm.last_name} onChange={(e) => setSettingsForm({...settingsForm, last_name: e.target.value})} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('settings.firstName')} <span className="text-red-500">*</span></label>
                <input type="text" value={settingsForm.first_name} onChange={(e) => setSettingsForm({...settingsForm, first_name: e.target.value})} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('settings.middleName')}</label>
              <input type="text" value={settingsForm.middle_name} onChange={(e) => setSettingsForm({...settingsForm, middle_name: e.target.value})} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
            </div>
            
            <hr className="border-slate-200" />
            
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3">{t('settings.changePassword')}</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('settings.currentPassword')}</label>
                  <input type="password" value={settingsForm.current_password} onChange={(e) => setSettingsForm({...settingsForm, current_password: e.target.value})} placeholder={t('settings.currentPasswordPlaceholder')} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('settings.newPassword')}</label>
                    <input type="password" value={settingsForm.new_password} onChange={(e) => setSettingsForm({...settingsForm, new_password: e.target.value})} placeholder={t('settings.newPasswordPlaceholder')} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('settings.confirmPassword')}</label>
                    <input type="password" value={settingsForm.confirm_password} onChange={(e) => setSettingsForm({...settingsForm, confirm_password: e.target.value})} placeholder={t('settings.confirmPasswordPlaceholder')} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50">
            <button onClick={closeSettingsModal} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('settings.cancel')}</button>
            <button onClick={handleSettingsSubmit} disabled={isSettingsSubmitting} className="px-5 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white rounded-lg transition-colors shadow-sm flex items-center gap-1.5">
              {isSettingsSubmitting ? (<><i className="fa-solid fa-spinner fa-spin text-[11px]"></i> {t('settings.saving')}</>) : (<><i className="fa-solid fa-check text-[11px]"></i> {t('settings.save')}</>)}
            </button>
          </div>
        </div>
      </div>

      {/* Modal: API Keys */}
      <div id="modal-api-keys" className={`modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] items-center justify-center p-4 ${isModalApiKeysOpen ? 'flex' : 'hidden'}`} onClick={() => setIsModalApiKeysOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
            <div>
              <h2 className="text-base font-bold text-slate-800">{t('apiKeysModal.title')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('apiKeysModal.subtitle')}</p>
            </div>
            <button onClick={() => setIsModalApiKeysOpen(false)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-xmark"></i></button>
          </div>
          
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('apiKeysModal.createNewLabel')}</label>
              <div className="flex gap-2">
                <input type="text" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder={t('apiKeysModal.createPlaceholder')} className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
                <button onClick={handleCreateApiKey} disabled={isCreatingKey || !newKeyName.trim()} className="px-4 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white rounded-lg transition-colors flex items-center gap-1.5">
                  {isCreatingKey ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-plus"></i>} {t('apiKeysModal.createButton')}
                </button>
              </div>
              {createdFullKey && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-xs font-semibold text-green-800 mb-1 flex items-center gap-1.5">
                    <i className="fa-solid fa-circle-check"></i> {t('apiKeysModal.createdSuccess')}
                  </div>
                  <div className="flex items-center gap-2 bg-white border border-green-300 rounded p-2 font-mono text-xs break-all">
                    <span className="flex-1 text-slate-800">{createdFullKey}</span>
                    <button onClick={() => handleCopyKey(createdFullKey)} className={`shrink-0 px-2 py-1 rounded text-[11px] font-semibold transition-colors ${isKeyCopied ? 'bg-green-100 text-green-700' : 'bg-primary-50 text-primary-600 hover:bg-primary-100'}`}>
                      {isKeyCopied ? t('apiKeysModal.copied') : t('apiKeysModal.copy')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('apiKeysModal.existingKeys')}</h3>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('apiKeysModal.table.name')}</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('apiKeysModal.table.prefix')}</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('apiKeysModal.table.status')}</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('apiKeysModal.table.created')}</th>
                      <th className="px-4 py-2.5 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isApiKeysLoading ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i> {t('apiKeysModal.loading')}</td></tr>
                    ) : apiKeys.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">{t('apiKeysModal.noKeys')}</td></tr>
                    ) : (
                      apiKeys.map((key) => (
                        <tr key={key.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-semibold text-slate-800">{key.name}</td>
                          <td className="px-4 py-2.5 text-slate-500 font-mono">{key.key_prefix}...</td>
                          <td className="px-4 py-2.5">
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input type="checkbox" checked={key.is_active} onChange={(e) => handleToggleApiKey(key.id, e.target.checked)} className="sr-only peer" />
                              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                            </label>
                          </td>
                          <td className="px-4 py-2.5 text-slate-400">{new Date(key.created_at).toLocaleDateString(process.env.NEXT_FORMAT_LOCALE)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={() => handleDeleteApiKey(key.id)} className="text-slate-300 hover:text-red-500 transition-colors" title={t('apiKeysModal.deleteTitle')}>
                              <i className="fa-solid fa-trash text-xs"></i>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50">
            <button onClick={() => setIsModalApiKeysOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('apiKeysModal.close')}</button>
          </div>
        </div>
      </div>

      <SubscriptionModal 
        isOpen={isModalBillingOpen} 
        onClose={() => setIsModalBillingOpen(false)} 
      />
    </>
  );
}