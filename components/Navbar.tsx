// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl'; // Добавляем next-intl
import { useStore } from '@/store/useStore';
import { useTasksStore } from '@/store/useTasksStore';
import { usersApi, documentSetsApi } from '@/lib/realApi';
import { useNavbarStore } from '@/store/useNavbarStore';
import { AccessType } from '@/lib/types';
import UserEmailInput from '@/components/UserEmailInput';
import UserDropdown from '@/components/UserDropdown'; 
import ContactFormModal from '@/components/ContactFormModal';

export default function Navbar() {
  // Инициализируем переводы для неймспейса Navbar
  const t = useTranslations('Navbar');
  
  const domain = process.env.NEXT_PUBLIC_DOMAIN || 'ladnost.ru';
  const [isModalApprovalOpen, setIsModalApprovalOpen] = useState(false);
  const [isModalAccessOpen, setIsModalAccessOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<'parallel' | 'sequential'>('parallel');
  const router = useRouter();
  
  // Состояния формы согласования
  const [taskName, setTaskName] = useState('');
  const [comment, setComment] = useState('');
  const [deadline, setDeadline] = useState('');
  const [searchEmail, setSearchEmail] = useState('');
  const [participants, setParticipants] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Состояния формы доступа
  const [newAccessEmail, setNewAccessEmail] = useState('');
  const [newAccessType, setNewAccessType] = useState<AccessType>(AccessType.VIEW);
  const [isAnonymousAccess, setIsAnonymousAccess] = useState(false);
  const [isAnonymousLoading, setIsAnonymousLoading] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  
  // Подключение стора доступов
  const accessList = useNavbarStore((s) => s.accessList);
  const isAccessLoading = useNavbarStore((s) => s.isAccessLoading);
  const fetchAccess = useNavbarStore((s) => s.fetchAccess);
  const grantAccess = useNavbarStore((s) => s.grantAccess);
  const updateAccess = useNavbarStore((s) => s.updateAccess);
  const revokeAccess = useNavbarStore((s) => s.revokeAccess);
  
  // Получаем setId из стора
  const setId = useStore((s: any) => s.documentPackage.setId);
  const documentSetMode = useStore((s: any) => s.documentPackage.documentSetMode);
  const setDocumentSetMode = useStore((s: any) => s.documentPackage.setDocumentSetMode);
  const isPackageLoaded = useStore((s: any) => !!s.documentPackage.setId);
  const currentUserAccess = useStore((s: any) => s.documentPackage.currentUserAccess);
  const isOwner = currentUserAccess === 'owner';
  const isFull = currentUserAccess === 'full';
  const canChangeMode = isOwner || isFull;
  const pathname = usePathname();
  const isEditorRoute = pathname.startsWith('/editor/');
  const shouldShowControls = isPackageLoaded && isEditorRoute;
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  // Загрузка списка пользователей и доступов при открытии модалок
  useEffect(() => {
    if (isModalApprovalOpen || isModalAccessOpen) {
      usersApi.listRelated().then(setAllUsers);
    }
    if (isModalAccessOpen && setId) {
      fetchAccess(setId);
      documentSetsApi.get(setId).then(ds => {
        setIsAnonymousAccess(ds.is_anonymous_access);
      }).catch(err => {
        console.error('Ошибка загрузки данных комплекта:', err);
      });
    }
  }, [isModalApprovalOpen, isModalAccessOpen, fetchAccess, setId]);

  const openModal = (id: string) => {
    if (id === 'modal-approval') setIsModalApprovalOpen(true);
    if (id === 'modal-access') setIsModalAccessOpen(true);
  };

  const resetForm = () => {
    setTaskName(''); setComment(''); setDeadline('');
    setSearchEmail(''); setParticipants([]); setActiveRoute('parallel');
  };

  const closeModal = (id: string) => {
    if (id === 'modal-approval') { setIsModalApprovalOpen(false); resetForm(); }
    if (id === 'modal-access') setIsModalAccessOpen(false);
  };

  const setRoute = (route: 'parallel' | 'sequential') => setActiveRoute(route);

  const handleAddParticipant = async () => {
    const email = searchEmail.toLowerCase().trim();
    if (!email) return;
    
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
    
    if (participants.find(p => p.id === foundUser.id)) {
      alert(t('alerts.userAlreadyAdded')); 
      setSearchEmail(''); 
      return;
    }
    
    setParticipants([...participants, {
      id: foundUser.id,
      name: foundUser.is_active ? `${foundUser.last_name} ${foundUser.first_name?.charAt(0) || ''}.${foundUser.middle_name ? foundUser.middle_name.charAt(0) + '.' : ''}` : t('approval.notRegistered'),
      email: foundUser.email, 
      avatar: foundUser.avatar_url || '/default-avatar.svg',
      access: 'review', 
      isRegistered: foundUser.is_active
    }]);
    setSearchEmail('');
  };

  const handleRemoveParticipant = (userId: number) => setParticipants(participants.filter(p => p.id !== userId));
  const handleChangeAccess = (userId: number, newAccess: string) => setParticipants(participants.map(p => p.id === userId ? { ...p, access: newAccess } : p));

  const handleSendForApproval = async () => {
    if (!taskName.trim()) { 
      alert(t('alerts.enterTaskName')); 
      return; 
    }
    if (participants.length === 0) { 
      alert(t('alerts.addParticipant')); 
      return; 
    }
    
    const state = useStore.getState();
    const currentSetId = state.documentPackage.setId;
    if (!currentSetId) return;
    
    setIsSubmitting(true);
    try {
      if (isEditorRoute && state.ui.mode !== 'history') {
        await state.documentPackage.saveActiveDocumentToServer();
      }
      await useTasksStore.getState().sendForApproval({
        documentSetId: currentSetId, 
        taskName, 
        comment, 
        deadline: deadline || null,
        routeType: activeRoute, 
        participants: participants.map(p => ({ id: p.id, access: p.access }))
      });
      
      alert(t('alerts.approvalSuccess'));
      closeModal('modal-approval');
    } catch (error) {
      console.error('Ошибка при отправке:', error);
      alert(t('alerts.approvalError'));
    } finally { 
      setIsSubmitting(false); 
    }
  };

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

  const handleNavClick = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (isEditorRoute) {
      e.preventDefault();
      const currentMode = useStore.getState().ui.mode;
      if (currentMode !== 'history') {
        try {
          await useStore.getState().documentPackage.saveActiveDocumentToServer();
          await useStore.getState().data.saveAnswersToApi();
        } catch (error) { 
          console.error('Ошибка принудительного сохранения при переходе:', error); 
        }
      }
      router.push(href);
    }
  };

  const getModeBtnClass = (btnMode: string) =>
    documentSetMode === btnMode
      ? "px-3 h-7 flex items-center gap-1.5 transition-colors text-xs font-medium bg-primary-50 text-primary-600"
      : "px-3 h-7 flex items-center gap-1.5 text-slate-400 hover:bg-slate-50 transition-colors text-xs font-medium";

  // Обработка Escape для модалок Navbar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalApprovalOpen(false);
        setIsModalAccessOpen(false);
        setIsContactModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <header id="header" className="h-12 border-b border-slate-200 flex items-center justify-between px-4 shrink-0 bg-white z-50 gap-4">
        <div className="flex items-center gap-1 min-w-0">
          <div className="flex items-center gap-2 mr-3 shrink-0">
            <div className="w-7 h-7 bg-primary-600 rounded flex items-center justify-center text-white font-bold text-sm">
              <i className="fa-solid fa-scale-balanced text-sm"></i>
            </div>
            <span className="font-semibold text-base tracking-tight text-slate-800">{t('brand')}</span>
          </div>
          <nav className="flex items-center gap-0.5">
            <Link href="/workspace" onClick={(e) => handleNavClick(e, '/workspace')} className={`nav-link ${pathname === '/workspace' || pathname.startsWith('/workspace/') ? 'active' : ''}`}>
              {t('nav.myFiles')}
            </Link>
            <Link href="/formulations" onClick={(e) => handleNavClick(e, '/formulations')} className={`nav-link ${pathname === '/formulations' || pathname.startsWith('/formulations/') ? 'active' : ''}`}>
              {t('nav.formulations')}
            </Link>
            <Link href="/tasks" onClick={(e) => handleNavClick(e, '/tasks')} className={`nav-link ${pathname === '/tasks' || pathname.startsWith('/tasks/') ? 'active' : ''}`}>
              {t('nav.myTasks')}
            </Link>
            <Link href="/builder" onClick={(e) => handleNavClick(e, '/builder')} className={`nav-link ${pathname === '/builder' || pathname.startsWith('/builder/') ? 'active' : ''}`}>
              {t('nav.neuralNetwork')}
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {shouldShowControls && (
            <>
              {canChangeMode && (
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                  {isOwner && (
                    <button onClick={() => setDocumentSetMode('template')} className={getModeBtnClass('template')}>
                      <i className="fa-solid fa-copy text-xs"></i> {t('modes.template')}
                    </button>
                  )}
                  <button onClick={() => setDocumentSetMode('standard')} className={getModeBtnClass('standard')}>
                    <i className="fa-solid fa-clipboard-check text-xs"></i> {t('modes.standard')}
                  </button>
                  <button onClick={() => setDocumentSetMode('non_standard')} className={getModeBtnClass('non_standard')}>
                    <i className="fa-solid fa-puzzle-piece text-xs"></i> {t('modes.nonStandard')}
                  </button>
                </div>
              )}
              {isOwner && (
                <button id="btn-send-approval" onClick={() => openModal('modal-approval')} className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-md transition-colors shadow-sm flex items-center gap-1.5">
                  <i className="fa-solid fa-paper-plane text-[11px]"></i> {t('actions.sendForApproval')}
                </button>
              )}
              {isOwner && (
                <button id="btn-access" onClick={() => openModal('modal-access')} className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5">
                  <i className="fa-solid fa-user-plus text-[11px] text-slate-500"></i> {t('actions.access')}
                </button>
              )}
            </>
          )}
          <button 
            onClick={() => setIsContactModalOpen(true)} 
            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5"
            title={t('actions.supportTitle')}
          >
            <i className="fa-solid fa-headset text-[11px] text-slate-500"></i> {t('actions.support')}
          </button>
          <UserDropdown />
        </div>
      </header>

      {/* Modal: Approval */}
      <div id="modal-approval" className={`modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] items-center justify-center p-4 ${isModalApprovalOpen ? 'flex' : 'hidden'}`} onClick={() => closeModal('modal-approval')}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
            <div>
              <h2 className="text-base font-bold text-slate-800">{t('approval.title')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('approval.subtitle')}</p>
            </div>
            <button onClick={() => closeModal('modal-approval')} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-xmark"></i></button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('approval.taskNameLabel')} <span className="text-red-500">*</span></label>
              <input type="text" value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder={t('approval.taskNamePlaceholder')} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('approval.commentLabel')}</label>
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('approval.commentPlaceholder')} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow resize-none"></textarea>
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('approval.routeLabel')}</label>
                <div className="flex gap-2">
                  <button onClick={() => setRoute('parallel')} className={`flex-1 py-2 text-xs font-semibold border-2 rounded-lg transition-all route-btn ${activeRoute === 'parallel' ? 'border-primary-500 text-primary-600 bg-primary-50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    <i className="fa-solid fa-people-group mb-1 block text-base"></i> {t('approval.routeParallel')}
                  </button>
                  <button onClick={() => setRoute('sequential')} className={`flex-1 py-2 text-xs font-semibold border-2 rounded-lg transition-all route-btn ${activeRoute === 'sequential' ? 'border-primary-500 text-primary-600 bg-primary-50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    <i className="fa-solid fa-arrow-right-long mb-1 block text-base"></i> {t('approval.routeSequential')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('approval.deadlineLabel')}</label>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">{t('approval.participantsLabel')}</label>
              </div>
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <UserEmailInput value={searchEmail} onChange={setSearchEmail} placeholder={t('approval.searchPlaceholder')} />
                </div>
                <button onClick={handleAddParticipant} className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors">{t('approval.addButton')}</button>
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 w-6">{t('approval.tableIndex')}</th>
                      <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500">{t('approval.tableParticipant')}</th>
                      <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500">{t('approval.tableAccess')}</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {participants.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">{t('approval.emptyParticipants')}</td></tr>
                    ) : (
                      participants.map((p, idx) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-400 font-medium">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <img src={p.avatar} className="w-6 h-6 rounded-full object-cover" alt="Avatar" />
                              <div>
                                <div className={`font-semibold ${p.isRegistered ? 'text-slate-800' : 'text-slate-500 italic'}`}>
                                  {p.isRegistered ? p.name : t('approval.notRegistered')}
                                </div>
                                <div className="text-[10px] text-slate-400">{p.email}</div>
                                {!p.isRegistered && (
                                  <div className="text-[10px] text-orange-500 font-medium mt-0.5 flex items-center gap-1">
                                    <i className="fa-solid fa-envelope"></i> {t('approval.invitationSent')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <select value={p.access} onChange={(e) => handleChangeAccess(p.id, e.target.value)} className="text-xs bg-white border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500">
                              <option value="review">{t('approval.accessReview')}</option>
                              <option value="full">{t('approval.accessFull')}</option>
                              <option value="comment">{t('approval.accessComment')}</option>
                              <option value="view">{t('approval.accessView')}</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => handleRemoveParticipant(p.id)} className="text-slate-300 hover:text-red-400 transition-colors">
                              <i className="fa-solid fa-xmark text-xs"></i>
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
            <button onClick={() => closeModal('modal-approval')} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('approval.cancelButton')}</button>
            <button onClick={handleSendForApproval} disabled={isSubmitting} className="px-5 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white rounded-lg transition-colors shadow-sm flex items-center gap-1.5">
              {isSubmitting ? (<><i className="fa-solid fa-spinner fa-spin text-[11px]"></i> {t('approval.sending')}</>) : (<><i className="fa-solid fa-paper-plane text-[11px]"></i> {t('approval.sendButton')}</>)}
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Access */}
      <div id="modal-access" className={`modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] items-center justify-center p-4 ${isModalAccessOpen ? 'flex' : 'hidden'}`} onClick={() => closeModal('modal-access')}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
            <div>
              <h2 className="text-base font-bold text-slate-800">{t('access.title')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('access.subtitle')}</p>
            </div>
            <button onClick={() => closeModal('modal-access')} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
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
            <button onClick={() => closeModal('modal-access')} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors">{t('access.closeButton')}</button>
          </div>
        </div>
      </div>

      <ContactFormModal 
        isOpen={isContactModalOpen} 
        onClose={() => setIsContactModalOpen(false)} 
      />
    </>
  );
}