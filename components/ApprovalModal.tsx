// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// components/ApprovalModal.tsx
'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { useTasksStore } from '@/store/useTasksStore';
import { usersApi } from '@/lib/realApi';
import UserEmailInput from '@/components/UserEmailInput';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  setId?: number;
}

export default function ApprovalModal({ isOpen, onClose, setId: propSetId }: ApprovalModalProps) {
  const t = useTranslations('Navbar');
  const pathname = usePathname();
  const isEditorRoute = pathname.startsWith('/editor/');

  const [taskName, setTaskName] = useState('');
  const [comment, setComment] = useState('');
  const [deadline, setDeadline] = useState('');
  const [searchEmail, setSearchEmail] = useState('');
  const [participants, setParticipants] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeRoute, setActiveRoute] = useState<'parallel' | 'sequential'>('parallel');

  useEffect(() => {
    if (isOpen) {
      usersApi.listRelated().then(setAllUsers);
    }
  }, [isOpen]);

  const resetForm = () => {
    setTaskName(''); setComment(''); setDeadline('');
    setSearchEmail(''); setParticipants([]); setActiveRoute('parallel');
  };

  const handleClose = () => {
    onClose();
    resetForm();
  };

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

  const storeSetId = useStore((s: any) => s.documentPackage.setId);
  const setId = propSetId ?? storeSetId;

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
    const currentSetId = setId;
    
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
      handleClose();
    } catch (error) {
      console.error('Ошибка при отправке:', error);
      alert(t('alerts.approvalError'));
    } finally { 
      setIsSubmitting(false); 
    }
  };

  if (!isOpen) return null;

  return (
    <div id="modal-approval" className="modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">{t('approval.title')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('approval.subtitle')}</p>
          </div>
          <button onClick={handleClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-xmark"></i></button>
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
                <button onClick={() => setActiveRoute('parallel')} className={`flex-1 py-2 text-xs font-semibold border-2 rounded-lg transition-all route-btn ${activeRoute === 'parallel' ? 'border-primary-500 text-primary-600 bg-primary-50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  <i className="fa-solid fa-people-group mb-1 block text-base"></i> {t('approval.routeParallel')}
                </button>
                <button onClick={() => setActiveRoute('sequential')} className={`flex-1 py-2 text-xs font-semibold border-2 rounded-lg transition-all route-btn ${activeRoute === 'sequential' ? 'border-primary-500 text-primary-600 bg-primary-50' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
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
          <button onClick={handleClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('approval.cancelButton')}</button>
          <button onClick={handleSendForApproval} disabled={isSubmitting} className="px-5 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white rounded-lg transition-colors shadow-sm flex items-center gap-1.5">
            {isSubmitting ? (<><i className="fa-solid fa-spinner fa-spin text-[11px]"></i> {t('approval.sending')}</>) : (<><i className="fa-solid fa-paper-plane text-[11px]"></i> {t('approval.sendButton')}</>)}
          </button>
        </div>
      </div>
    </div>
  );
}