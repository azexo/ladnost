// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Navbar.tsx
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import UserDropdown from '@/components/UserDropdown';
import ContactFormModal from '@/components/ContactFormModal';
import ApprovalModal from '@/components/ApprovalModal';
import AccessModal from '@/components/AccessModal';

export default function Navbar() {
  const t = useTranslations('Navbar');
  const router = useRouter();
  const pathname = usePathname();

  const [isModalApprovalOpen, setIsModalApprovalOpen] = useState(false);
  const [isModalAccessOpen, setIsModalAccessOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  const setId = useStore((s: any) => s.documentPackage.setId);
  const documentSetMode = useStore((s: any) => s.documentPackage.documentSetMode);
  const setDocumentSetMode = useStore((s: any) => s.documentPackage.setDocumentSetMode);
  const isPackageLoaded = useStore((s: any) => !!s.documentPackage.setId);
  const currentUserAccess = useStore((s: any) => s.documentPackage.currentUserAccess);
  
  const isOwner = currentUserAccess === 'owner';
  const isFull = currentUserAccess === 'full';
  const canChangeMode = isOwner || isFull;

  const isEditorRoute = pathname.startsWith('/editor/');
  const shouldShowControls = isPackageLoaded && isEditorRoute;

  const openModal = (id: string) => {
    if (id === 'modal-approval') setIsModalApprovalOpen(true);
    if (id === 'modal-access') setIsModalAccessOpen(true);
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
      <header id="header" className="h-12 border-b border-slate-200 flex items-center justify-between px-4 shrink-0 bg-white z-30 gap-4">
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

      <ApprovalModal 
        isOpen={isModalApprovalOpen} 
        onClose={() => setIsModalApprovalOpen(false)} 
      />
      
      <AccessModal 
        isOpen={isModalAccessOpen} 
        onClose={() => setIsModalAccessOpen(false)} 
      />

      <ContactFormModal 
        isOpen={isContactModalOpen} 
        onClose={() => setIsContactModalOpen(false)} 
      />
    </>
  );
}