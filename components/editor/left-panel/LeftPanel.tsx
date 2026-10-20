// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/LeftPanel.tsx
import { useStore } from '@/store/useStore';
import { ModeRail } from './ModeRail';
import { MarkupView } from './views/MarkupView';
import { EditView } from './views/EditView';
import { ReviewView } from './views/ReviewView';
import { CommentView } from './views/CommentView';
import { HistoryView } from './views/HistoryView';

export const LeftPanel = () => {
    const mode = useStore((s: any) => s.ui.mode);
    const activeTab = useStore((s: any) => s.ui.activeTab);
    const setMode = useStore((s: any) => s.ui.setMode);
    const setActiveTab = useStore((s: any) => s.ui.setActiveTab);
    
    // 🆕 Получаем уровень доступа, тип комплекта и массив свойств
    const currentUserAccess = useStore((s: any) => s.documentPackage.currentUserAccess);
    const docSetMode = useStore((s: any) => s.documentPackage.documentSetMode);
    const documentSetMode = useStore((s: any) => s.documentPackage.documentSetMode);
    const properties = useStore((s: any) => s.data.properties);

    if (currentUserAccess === 'view' || docSetMode === 'file') {
        return null;
    }

    const hasProperties = properties && properties.length > 0;
    
    // 🆕 Логика скрытия EditView: 
    // Показываем анкету, если это НЕ "нетиповой" комплект ИЛИ если в "нетиповом" вдруг появились свойства.
    const shouldShowEditView = mode === 'edit' && (documentSetMode !== 'non_standard' || hasProperties);

    // 🆕 Если мы в режиме edit, но показывать анкету не нужно, скрываем весь aside, чтобы не было пустоты
    const isAsideEmpty = mode === 'edit' && !shouldShowEditView;

    if (isAsideEmpty) {
        return <ModeRail mode={mode} setMode={setMode} />;
    }

    return (
        <>
            <ModeRail mode={mode} setMode={setMode} />
            <aside id="left-panel" className="w-[300px] border-r border-slate-200 bg-surface flex flex-col relative shrink-0 z-10 overflow-hidden">
                {mode === 'markup' && <MarkupView activeTab={activeTab} setActiveTab={setActiveTab} />}
                {shouldShowEditView && <EditView />}
                {mode === 'review' && <ReviewView />}
                {mode === 'comment' && <CommentView />}
                {mode === 'history' && <HistoryView />}
            </aside>
        </>
    );
};