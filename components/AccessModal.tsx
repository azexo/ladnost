// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// components/AccessModal.tsx
'use client';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { useNavbarStore } from '@/store/useNavbarStore';
import { usersApi, documentSetsApi } from '@/lib/realApi';
import { AccessType } from '@/lib/types';
import UserEmailInput from '@/components/UserEmailInput';

interface AccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  setId?: number;
}

export default function AccessModal({ isOpen, onClose, setId: propSetId }: AccessModalProps) {
  const t = useTranslations('Navbar');
  const domain = process.env.NEXT_PUBLIC_DOMAIN || 'ladnost.ru';

  const [newAccessEmail, setNewAccessEmail] = useState('');
  const [newAccessType, setNewAccessType] = useState<AccessType>(AccessType.VIEW);
  const [isAnonymousAccess, setIsAnonymousAccess] = useState(false);
  const [isAnonymousLoading, setIsAnonymousLoading] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);

  const accessList = useNavbarStore((s) => s.accessList);
  const isAccessLoading = useNavbarStore((s) => s.isAccessLoading);
  const fetchAccess = useNavbarStore((s) => s.fetchAccess);
  const grantAccess = useNavbarStore((s) => s.grantAccess);
  const updateAccess = useNavbarStore((s) => s.updateAccess);
  const revokeAccess = useNavbarStore((s) => s.revokeAccess);

  const storeSetId = useStore((s: any) => s.documentPackage.setId);
  const setId = propSetId ?? storeSetId;


  useEffect(() => {
    if (isOpen) {
      usersApi.listRelated().then(setAllUsers);
      if (setId) {
        fetchAccess(setId);
        documentSetsApi.get(setId).then(ds => {
          setIsAnonymousAccess(ds.is_anonymous_access);
        }).catch(err => {
          console.error('Ошибка загрузки данных комплекта:', err);
        });
      }
    }
  }, [isOpen, fetchAccess, setId]);

  const handleGrantAccess = async () => {
    const email = newAccessEmail.toLowerCase().trim();
    if (!email) {
      alert(t('alerts.enterEmail'));
      return;
    }
    let foundUser = allUsers.find(u => u.email.toLowerCase() === email);
    if (!foundUser) {
      try {
        foundUser = await usersApi.invite(email);
        setAllUsers(prev => [...prev, foundUser!]);
      } catch (e) { 
        alert(t('alerts.inviteError')); 
        return; 
      }
    }
    if (!setId) return;
    try {
      await grantAccess(setId, { user_id: foundUser.id, access_type: newAccessType });
      setNewAccessEmail('');
    } catch (error: any) { 
      alert(error.message || t('alerts.grantAccessError')); 
    }
  };

  const handleUpdateAccess = async (accessId: number, newType: AccessType) => {
    if (!setId) return;
    try {
      await updateAccess(setId, accessId, { access_type: newType });
    } catch (error: any) {
      alert(error.message || t('alerts.updateAccessError'));
    }
  };

  const handleRevokeAccess = async (accessId: number) => {
    if (!confirm(t('alerts.confirmRevoke'))) return;
    if (!setId) return;
    try {
      await revokeAccess(setId, accessId);
    } catch (error: any) {
      alert(error.message || t('alerts.revokeAccessError'));
    }
  };

  const handleToggleAnonymousAccess = async (checked: boolean) => {
    if (!setId) return;
    setIsAnonymousLoading(true);
    try {
      await documentSetsApi.update(setId, { is_anonymous_access: checked });
      setIsAnonymousAccess(checked);
    } catch (error: any) {
      alert(error.message || t('alerts.anonymousAccessError'));
    } finally {
      setIsAnonymousLoading(false);
    }
  };

  const handleCopyAnonymousLink = () => {
    if (!setId) return;
    const link = `https://${domain}/viewer/${setId}`;
    navigator.clipboard.writeText(link).then(() => {
      setIsLinkCopied(true);
      setTimeout(() => setIsLinkCopied(false), 2000);
    }).catch(() => {
      console.error(t('alerts.copyLinkError'));
    });
  };

  if (!isOpen) return null;

  return (
    <div id="modal-access" className="modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">{t('access.title')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('access.subtitle')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex gap-2">
            <div className="flex-1">
              <UserEmailInput value={newAccessEmail} onChange={setNewAccessEmail} placeholder={t('access.searchPlaceholder')} />
            </div>
            <select value={newAccessType} onChange={(e) => setNewAccessType(e.target.value as AccessType)} className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500">
              <option value={AccessType.FULL}>{t('access.typeFull')}</option>
              <option value={AccessType.REVIEW}>{t('access.typeReview')}</option>
              <option value={AccessType.COMMENT}>{t('access.typeComment')}</option>
              <option value={AccessType.VIEW}>{t('access.typeView')}</option>
            </select>
            <button onClick={handleGrantAccess} className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors">{t('access.inviteButton')}</button>
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('access.tableUser')}</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('access.tableEmail')}</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('access.tableType')}</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('access.tableTerm')}</th>
                  <th className="px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isAccessLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i> {t('access.loading')}</td></tr>
                ) : accessList.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">{t('access.emptyList')}</td></tr>
                ) : (
                  accessList.map((access) => {
                    const foundUser = allUsers.find(u => u.id === access.user_id);
                    const isOwnerAccess = access.access_type === AccessType.OWNER;
                    const isRegistered = foundUser ? foundUser.is_active !== false : true; 
                    return (
                      <tr key={access.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <img src={foundUser?.avatar_url || '/default-avatar.svg'} className="w-6 h-6 rounded-full object-cover" alt="Avatar" />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`font-semibold ${isRegistered ? 'text-slate-800' : 'text-slate-500 italic'}`}>
                                  {isRegistered ? (foundUser ? `${foundUser.last_name} ${foundUser.first_name}` : 'Неизвестный') : t('access.notRegistered')}
                                </span>
                                {isOwnerAccess && (<span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-semibold">{t('access.ownerBadge')}</span>)}
                              </div>
                              {!isRegistered && (
                                <div className="text-[10px] text-orange-500 font-medium mt-0.5 flex items-center gap-1">
                                  <i className="fa-solid fa-envelope"></i> {t('access.invitationSent')}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{foundUser?.email || '-'}</td>
                        <td className="px-4 py-2.5">
                          {isOwnerAccess ? (
                            <span className="text-[11px] font-semibold text-primary-600">{t('access.typeFull')}</span>
                          ) : (
                            <select value={access.access_type} onChange={(e) => handleUpdateAccess(access.id, e.target.value as AccessType)} className="text-xs bg-white border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500">
                              <option value={AccessType.FULL}>{t('access.typeFull')}</option>
                              <option value={AccessType.REVIEW}>{t('access.typeReview')}</option>
                              <option value={AccessType.COMMENT}>{t('access.typeComment')}</option>
                              <option value={AccessType.VIEW}>{t('access.typeView')}</option>
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400">{t('access.termIndefinite')}</td>
                        <td className="px-4 py-2.5 text-right">
                          {!isOwnerAccess && (
                            <button onClick={() => handleRevokeAccess(access.id)} className="text-slate-300 hover:text-red-500 transition-colors" title={t('access.revokeTitle')}>
                              <i className="fa-solid fa-trash text-xs"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <input type="checkbox" checked={isAnonymousAccess} onChange={(e) => handleToggleAnonymousAccess(e.target.checked)} disabled={isAnonymousLoading} className="w-4 h-4 text-primary-600 bg-white border-slate-300 rounded focus:ring-primary-500 cursor-pointer disabled:opacity-50 transition-all" />
              <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">{t('access.anonymousLabel')}</span>
            </label>
            {isAnonymousAccess && setId && (
              <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md px-2 py-1 shadow-sm animate-in fade-in slide-in-from-left-2 duration-200">
                <i className="fa-solid fa-link text-slate-400 text-[10px]"></i>
                <span className="text-[11px] text-slate-600 font-mono truncate max-w-[160px]" title={`https://${domain}/viewer/${setId}`}>{domain}/viewer/{setId}</span>
                <button onClick={handleCopyAnonymousLink} disabled={isLinkCopied} className={`text-[11px] font-semibold px-1.5 py-0.5 rounded transition-colors flex items-center gap-1 shrink-0 ${isLinkCopied ? 'text-green-600 bg-green-50 cursor-default' : 'text-primary-600 hover:text-primary-700 hover:bg-primary-50'}`} title={t('access.copyLinkTitle')}>
                  <i className={`fa-${isLinkCopied ? 'solid fa-check' : 'regular fa-copy'}`}></i> {isLinkCopied ? t('access.copied') : t('access.copy')}
                </button>
              </div>
            )}
            {isAnonymousLoading && (<i className="fa-solid fa-spinner fa-spin text-slate-400 text-xs"></i>)}
          </div>
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors">{t('access.closeButton')}</button>
        </div>
      </div>
    </div>
  );
}