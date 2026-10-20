// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useFormulationsStore, useTotalFormulations, useUsedFormulationsCount, EnrichedFormulation } from '@/store/useFormulationsStore';
import type { FormulationPayload, FormulationVersionPayload } from '@/lib/types';

// Палитра цветов для типов формулировок
const typeColorPalette = [
    { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-100', dot: 'bg-violet-400' },
    { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-100', dot: 'bg-blue-400' },
    { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', dot: 'bg-amber-400' },
    { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-100', dot: 'bg-green-400' },
    { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-100', dot: 'bg-rose-400' },
    { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-100', dot: 'bg-teal-400' },
];

const getTypeColor = (typeName: string, types: { id: number; name: string }[]) => {
    const index = types.findIndex(t => t.name === typeName);
    return typeColorPalette[index >= 0 ? index % typeColorPalette.length : 0];
};

const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(process.env.NEXT_FORMAT_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function Formulations() {
    // Инициализация next-intl
    const t = useTranslations('Formulations');

    const {
        moveType,
        deleteType,
        formulations,
        types,
        loading,
        filters,
        isFormulationModalOpen,
        formulationModalMode,
        currentFormulation,
        isTypeManagerModalOpen,
        usageCache,
        toggleFavorite,
        fetchFormulations,
        fetchTypes,
        fetchUsage,
        createFormulation,
        updateFormulation,
        createType,
        setTab,
        setTypeId,
        openCreateModal,
        openEditModal,
        closeFormulationModal,
        openTypeManagerModal,
        closeTypeManagerModal,
        deleteFormulation,
    } = useFormulationsStore();

    const total = useTotalFormulations();
    const usedCount = useUsedFormulationsCount();
    const hasFetchedRef = useRef(false);

    useEffect(() => {
        if (hasFetchedRef.current) return;
        hasFetchedRef.current = true;
        fetchFormulations();
        fetchTypes();
    }, [fetchFormulations, fetchTypes]);

    // Локальные состояния
    const [searchQuery, setSearchQuery] = useState('');
    const [activePopupId, setActivePopupId] = useState<number | null>(null);
    const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });

    // Состояния формы
    const [formName, setFormName] = useState('');
    const [formTypeId, setFormTypeId] = useState<number | ''>('');
    const [formText, setFormText] = useState('');
    const [formReason, setFormReason] = useState('');
    const [newTypeName, setNewTypeName] = useState('');

    // Инициализация формы при открытии модалки
    useEffect(() => {
        if (isFormulationModalOpen) {
            if (formulationModalMode === 'edit' && currentFormulation) {
                setFormName(currentFormulation.name);
                setFormTypeId(currentFormulation.type_id || '');
                setFormText(currentFormulation.text_content || '');
                setFormReason('');
            } else {
                setFormName('');
                setFormTypeId('');
                setFormText('');
                setFormReason('');
            }
        }
    }, [isFormulationModalOpen, formulationModalMode, currentFormulation]);

    // Закрытие попапа при клике вне его области
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (activePopupId && !(e.target as Element).closest('.docs-popup') && !(e.target as Element).closest('.usage-chip')) {
                setActivePopupId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activePopupId]);

    // Фильтрация по поиску
    const filteredFormulations = useMemo(() => {
        if (!searchQuery) return formulations;
        const q = searchQuery.toLowerCase();
        return formulations.filter(f =>
            f.name.toLowerCase().includes(q) || f.text_content.toLowerCase().includes(q)
        );
    }, [formulations, searchQuery]);

    // Группировка по типам
    const groupedFormulations = useMemo(() => {
        if (filters.tab !== 'all' || filters.typeId !== null) {
            return [{ typeName: 'all', items: filteredFormulations }];
        }
        const groups: Record<string, EnrichedFormulation[]> = {};
        filteredFormulations.forEach(f => {
            const tName = f.type_name || t('common.noType');
            if (!groups[tName]) groups[tName] = [];
            groups[tName].push(f);
        });
        return Object.entries(groups).map(([typeName, items]) => ({ typeName, items }));
    }, [filteredFormulations, filters, t]);

    // Обработчики
    const handleUsageClick = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        fetchUsage(id);
        const rect = e.currentTarget.getBoundingClientRect();
        setPopupPosition({ top: rect.bottom + 8, left: Math.max(16, rect.left - 200) });
        setActivePopupId(id);
    };

    const handleToggleFavorite = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        toggleFavorite(id);
    };

    const handleSaveFormulation = async () => {
        if (!formName.trim() || !formText.trim() || !formTypeId) {
            alert(t('alerts.fillRequired'));
            return;
        }
        if (formulationModalMode === 'edit' && !formReason.trim()) {
            alert(t('alerts.specifyReason'));
            return;
        }
        const payload: FormulationPayload = {
            name: formName.trim(),
            type_id: Number(formTypeId),
            is_favorite: currentFormulation?.is_favorite || false,
        };
        const versionPayload: FormulationVersionPayload = {
            text_content: formText.trim(),
            change_reason: formulationModalMode === 'edit' ? formReason.trim() : undefined,
        };
        try {
            if (formulationModalMode === 'create') {
                await createFormulation(payload, versionPayload);
            } else if (currentFormulation) {
                await updateFormulation(currentFormulation.id, payload, versionPayload);
            }
        } catch (error) {
            console.error('Ошибка сохранения:', error);
        }
    };

    const handleAddType = async () => {
        if (!newTypeName.trim()) return;
        await createType({ name: newTypeName.trim(), sort_order: types.length + 1 });
        setNewTypeName('');
    };

    const activeTypeName = filters.typeId ? types.find(t => t.id === filters.typeId)?.name : null;

    return (
        <>
            {/* ===== MAIN LAYOUT ===== */}
            <main id="main-workspace" className="flex-1 flex overflow-hidden relative">
                {/* LEFT SIDEBAR */}
                <aside id="left-sidebar" className="w-52 border-r border-slate-200 bg-surface flex flex-col shrink-0 py-3 px-2 gap-1 overflow-y-auto">
                    <div className="px-2 mb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('sidebar.library')}</span>
                    </div>
                    <div className={`sidebar-item ${filters.tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
                        <i className="w-4 text-center text-primary-500 fa-solid fa-book-open"></i>
                        <span>{t('sidebar.allFormulations')}</span>
                    </div>
                    <div className={`sidebar-item ${filters.tab === 'favorite' ? 'active' : ''}`} onClick={() => setTab('favorite')}>
                        <i className="w-4 text-center text-slate-400 fa-regular fa-star"></i>
                        <span>{t('sidebar.favorites')}</span>
                    </div>
                    <div className={`sidebar-item ${filters.tab === 'recent' ? 'active' : ''}`} onClick={() => setTab('recent')}>
                        <i className="w-4 text-center text-slate-400 fa-solid fa-clock-rotate-left"></i>
                        <span>{t('sidebar.recentlyModified')}</span>
                    </div>
                    <div className="px-2 mt-3 mb-1 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('sidebar.types')}</span>
                    </div>
                    <div id="sidebar-types-list" className="flex flex-col gap-0.5">
                        {types.map(type => {
                            const color = getTypeColor(type.name, types);
                            const isActive = filters.typeId === type.id;
                            return (
                                <div key={type.id} className={`sidebar-item ${isActive ? 'active' : ''}`} onClick={() => setTypeId(isActive ? null : type.id)}>
                                    <span className={`w-2 h-2 rounded-full ${color.dot} shrink-0`}></span>
                                    <span className="truncate">{type.name}</span>
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* CONTENT AREA */}
                <section id="content-area" className="flex-1 flex flex-col overflow-hidden bg-slate-50 relative">
                    {/* TOP BAR */}
                    <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4 shrink-0 flex-wrap">
                        <div className="flex items-center gap-1.5 text-sm min-w-0">
                            <span className="text-slate-800 font-semibold text-xs">{t('topBar.title')}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            <div className="relative">
                                <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('topBar.searchPlaceholder')}
                                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 w-56 transition-shadow"
                                />
                            </div>
                            <button onClick={openTypeManagerModal} className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                                <i className="fa-solid fa-pen-to-square text-slate-400 text-[11px]"></i> {t('topBar.editTypes')}
                            </button>
                            <button onClick={openCreateModal} className="h-8 px-4 flex items-center gap-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-sm">
                                <i className="fa-solid fa-plus text-[11px]"></i> {t('topBar.newFormulation')}
                            </button>
                        </div>
                    </div>

                    {/* STATS BAR */}
                    <div className="px-6 py-2.5 flex items-center gap-4 shrink-0 border-b border-slate-100 bg-white flex-wrap">
                        <span className="text-xs text-slate-500 font-medium">
                            {t('statsBar.total', { count: total })}
                        </span>
                        <span className="text-slate-200">|</span>
                        <span className="text-xs text-slate-500">
                            {t('statsBar.usedIn', { count: usedCount })}
                        </span>
                        {activeTypeName && (
                            <span id="active-filter-badge" className="flex items-center gap-1.5 ml-1">
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full border border-primary-100 flex items-center gap-1">
                                    <i className="fa-solid fa-filter text-[9px]"></i>
                                    <span>{activeTypeName}</span>
                                    <button onClick={() => setTypeId(null)} className="ml-1 hover:text-primary-800">
                                        <i className="fa-solid fa-xmark text-[9px]"></i>
                                    </button>
                                </span>
                            </span>
                        )}
                    </div>

                    {/* TABLE VIEW */}
                    <div id="table-view" className="flex-1 overflow-auto px-6 py-4 relative">
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                                    <tr>
                                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-36">{t('table.type')}</th>
                                        <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-52">{t('table.name')}</th>
                                        <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t('table.text')}</th>
                                        <th className="text-center px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-28">{t('table.usage')}</th>
                                        <th className="w-16 px-3 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr><td colSpan={5} className="text-center py-10 text-slate-400">{t('table.loading')}</td></tr>
                                    ) : groupedFormulations.length === 0 ? (
                                        <tr><td colSpan={5} className="text-center py-10 text-slate-400">{t('table.notFound')}</td></tr>
                                    ) : (
                                        groupedFormulations.map(group => (
                                            <tr key={group.typeName} className="group-row">
                                                <td colSpan={5} className="p-0">
                                                    {group.typeName !== 'all' && (
                                                        <div className="bg-slate-50/80 border-t border-slate-100 px-4 py-1.5">
                                                            <div className="group-header rounded-lg flex items-center gap-2">
                                                                <i className="fa-solid fa-chevron-down text-[10px] text-slate-400"></i>
                                                                <span className={`w-2.5 h-2.5 rounded-full ${getTypeColor(group.typeName, types).dot} inline-block shrink-0`}></span>
                                                                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{group.typeName}</span>
                                                                <span className="ml-1 text-[10px] text-slate-400 font-medium">{t('table.formulationsCount', { count: group.items.length })}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {group.items.map(f => {
                                                        const color = getTypeColor(f.type_name, types);
                                                        const usage = usageCache[f.id];
                                                        return (
                                                            <div
                                                                key={f.id}
                                                                className="table-row cursor-pointer border-t border-slate-50 transition-colors hover:bg-slate-50 grid grid-cols-[144px_1fr_2fr_112px_64px] items-start"
                                                                onClick={() => openEditModal(f)}
                                                            >
                                                                <div className="px-4 py-3">
                                                                    <span className={`type-badge ${color.bg} ${color.text} ${color.border} border px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center`}>
                                                                        <span className={`w-1.5 h-1.5 rounded-full ${color.dot} mr-1.5 inline-block shrink-0`}></span>
                                                                        {f.type_name || t('common.noType')}
                                                                    </span>
                                                                </div>
                                                                <div className="px-3 py-3 flex items-start gap-2">
                                                                    <button
                                                                        onClick={(e) => handleToggleFavorite(e, f.id)}
                                                                        className={`mt-0.5 text-sm ${f.is_favorite ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
                                                                        title={t('table.addToFavorites')}
                                                                    >
                                                                        <i className={`fa-${f.is_favorite ? 'solid' : 'regular'} fa-star`}></i>
                                                                    </button>
                                                                    <div className="min-w-0">
                                                                        <div className="text-sm font-semibold text-slate-800 hover:text-primary-600 transition-colors leading-snug truncate">{f.name}</div>
                                                                        <div className="text-[11px] text-slate-400 mt-0.5">{t('table.modified')} {formatDate(f.updated_at)} · {f.author_name}</div>
                                                                    </div>
                                                                </div>
                                                                <div className="px-3 py-3">
                                                                    <span className="text-xs text-slate-500 leading-relaxed line-clamp-2">{f.text_content}</span>
                                                                </div>
                                                                <div className="px-3 py-3 text-center">
                                                                    <button
                                                                        onClick={(e) => handleUsageClick(e, f.id)}
                                                                        className="usage-chip flex items-center gap-1 mx-auto text-xs text-slate-600 hover:text-primary-600"
                                                                    >
                                                                        <i className="fa-solid fa-file-lines text-[10px]"></i> {usage ? usage.count : '...'}
                                                                    </button>
                                                                </div>
                                                                <div className="px-3 py-2 flex items-center justify-end gap-3">
                                                                    <button onClick={(e) => { e.stopPropagation(); openEditModal(f); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-primary-50 hover:text-primary-600 transition-all" title={t('actions.edit')}>
                                                                        <i className="fa-solid fa-pen text-xs"></i>
                                                                    </button>
                                                                    <button 
                                                                        onClick={(e) => { 
                                                                            e.stopPropagation(); 
                                                                            if (window.confirm(t('confirmations.deleteFormulation', { name: f.name }))) {
                                                                                deleteFormulation(f.id);
                                                                            }
                                                                        }} 
                                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all" 
                                                                        title={t('actions.delete')}
                                                                    >
                                                                        <i className="fa-solid fa-trash text-xs"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </main>

            {/* DOCS POPUP */}
            {activePopupId && (
                <div
                    className="docs-popup bg-white border border-slate-200 rounded-xl shadow-2xl w-72 z-[500] overflow-hidden fixed"
                    style={{ top: popupPosition.top, left: popupPosition.left }}
                >
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">{t('popup.usedInDocuments')}</span>
                        <button onClick={() => setActivePopupId(null)} className="w-6 h-6 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400">
                            <i className="fa-solid fa-xmark text-[10px]"></i>
                        </button>
                    </div>
                    <div className="py-2 max-h-56 overflow-y-auto">
                        {usageCache[activePopupId] ? (
                            usageCache[activePopupId].document_sets.length > 0 ? (
                                usageCache[activePopupId].document_sets.map(ds => (
                                    <div key={ds.id} className="px-4 py-2 hover:bg-slate-50 flex items-center gap-2">
                                        <i className="fa-solid fa-file-lines text-slate-400 text-xs"></i>
                                        <span className="text-xs text-slate-700 truncate">{ds.name}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="px-4 py-2 text-xs text-slate-400">{t('popup.notUsedYet')}</div>
                            )
                        ) : (
                            <div className="px-4 py-3 text-xs text-slate-400 flex items-center justify-center gap-2">
                                <i className="fa-solid fa-spinner fa-spin text-primary-500"></i>
                                <span>{t('popup.loading')}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* OVERLAY */}
            {(isFormulationModalOpen || isTypeManagerModalOpen) && (
                <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[400]"
                    onClick={() => {
                        if (isFormulationModalOpen) closeFormulationModal();
                        if (isTypeManagerModalOpen) closeTypeManagerModal();
                    }}
                ></div>
            )}

            {/* FORMULATION SLIDE PANEL */}
            {isFormulationModalOpen && (
                <div id="slide-panel" className="fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-[450] flex flex-col border-l border-slate-200 animate-slide-in">
                    <div className="shrink-0 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between bg-white">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                                <i className="fa-solid fa-quote-right text-primary-500 text-sm"></i>
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-sm font-bold text-slate-800 truncate">
                                    {formulationModalMode === 'create' ? t('panel.newFormulation') : currentFormulation?.name}
                                </h2>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-3">
                            <button onClick={closeFormulationModal} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">
                                <i className="fa-solid fa-xmark text-sm"></i>
                            </button>
                        </div>
                    </div>
                    <div className="shrink-0 px-5 py-3 border-b border-slate-100 bg-slate-50/80 flex items-center gap-1.5 flex-wrap">
                        <button onClick={handleSaveFormulation} className="action-btn bg-primary-600 hover:bg-primary-700 text-white shadow-sm px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                            <i className="fa-solid fa-floppy-disk text-xs"></i> {t('actions.save')}
                        </button>
                        <button onClick={closeFormulationModal} className="action-btn bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                            <i className="fa-solid fa-xmark text-xs text-slate-400"></i> {t('actions.cancel')}
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                                <i className="fa-solid fa-tag text-slate-300"></i> {t('form.type')} <span className="text-red-400">*</span>
                            </label>
                            <select
                                value={formTypeId}
                                onChange={(e) => setFormTypeId(e.target.value ? Number(e.target.value) : '')}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow appearance-none cursor-pointer"
                            >
                                <option value="">{t('form.selectType')}</option>
                                {types.map(t_type => <option key={t_type.id} value={t_type.id}>{t_type.name}</option>)}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                                <i className="fa-solid fa-pen text-slate-300"></i> {t('form.name')} <span className="text-red-400">*</span>
                            </label>
                            <input
                                type="text"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder={t('form.namePlaceholder')}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow placeholder:text-slate-400"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                                    <i className="fa-solid fa-align-left text-slate-300"></i> {t('form.text')} <span className="text-red-400">*</span>
                                </label>
                            </div>
                            <textarea
                                value={formText}
                                onChange={(e) => setFormText(e.target.value)}
                                rows={8}
                                placeholder={t('form.textPlaceholder')}
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow placeholder:text-slate-400 resize-none leading-relaxed"
                            ></textarea>
                        </div>
                        {formulationModalMode === 'edit' && (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <i className="fa-solid fa-triangle-exclamation text-amber-500 text-xs"></i>
                                    <span className="text-xs font-bold text-amber-700">{t('form.changeReason')}</span>
                                    <span className="text-[10px] font-normal text-amber-600">{t('form.requiredForSubmit')}</span>
                                </div>
                                <textarea
                                    value={formReason}
                                    onChange={(e) => setFormReason(e.target.value)}
                                    rows={2}
                                    placeholder={t('form.changeReasonPlaceholder')}
                                    className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none placeholder:text-slate-400"
                                ></textarea>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* GROUPS (TYPES) MANAGEMENT MODAL */}
            {isTypeManagerModalOpen && (
                <div className="fixed inset-0 flex items-center justify-center z-[450] p-4">
                    <div className="modal-card bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
                        {/* HEADER */}
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center">
                                    <i className="fa-solid fa-layer-group text-primary-500 text-base"></i>
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800">{t('typeManager.title')}</h3>
                                    <p className="text-[11px] text-slate-400 mt-0.5">{t('typeManager.subtitle')}</p>
                                </div>
                            </div>
                            <button onClick={closeTypeManagerModal} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        {/* INPUT FOR NEW TYPE */}
                        <div className="px-6 py-4 border-b border-slate-100 shrink-0 bg-slate-50/60">
                            <div className="flex items-center gap-2">
                                <div className="flex-1 relative">
                                    <i className="fa-solid fa-plus absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                    <input
                                        type="text"
                                        value={newTypeName}
                                        onChange={(e) => setNewTypeName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddType()}
                                        placeholder={t('typeManager.newTypePlaceholder')}
                                        className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow placeholder:text-slate-400"
                                    />
                                </div>
                                <button onClick={handleAddType} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm flex items-center gap-1.5 shrink-0">
                                    <i className="fa-solid fa-plus text-[10px]"></i> {t('actions.add')}
                                </button>
                            </div>
                        </div>
                        {/* LIST OF TYPES */}
                        <div className="flex-1 overflow-y-auto px-6 py-3">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">{t('typeManager.existingTypes')}</div>
                            <div className="space-y-1">
                                {types.map((type, index) => {
                                    const color = getTypeColor(type.name, types);
                                    return (
                                        <div key={type.id} className="group-list-item flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg group">
                                            <div className="flex items-center gap-2">
                                                <span className={`color-dot w-2.5 h-2.5 rounded-full ${color.dot}`}></span>
                                                <span className="text-xs text-slate-800">{type.name}</span>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => moveType(type.id, 'up')}
                                                    disabled={index === 0}
                                                    className="text-slate-400 hover:text-primary-500 p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                                    title={t('actions.moveUp')}
                                                >
                                                    <i className="fa-solid fa-chevron-up text-[10px]"></i>
                                                </button>
                                                <button
                                                    onClick={() => moveType(type.id, 'down')}
                                                    disabled={index === types.length - 1}
                                                    className="text-slate-400 hover:text-primary-500 p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                                    title={t('actions.moveDown')}
                                                >
                                                    <i className="fa-solid fa-chevron-down text-[10px]"></i>
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm(t('confirmations.deleteType', { name: type.name }))) {
                                                            deleteType(type.id);
                                                        }
                                                    }}
                                                    className="text-slate-400 hover:text-red-500 p-1"
                                                    title={t('actions.delete')}
                                                >
                                                    <i className="fa-solid fa-trash text-[10px]"></i>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        {/* FOOTER */}
                        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0 bg-white">
                            <span className="text-[11px] text-slate-400 font-medium">{t('typeManager.typesCount', { count: types.length })}</span>
                            <div className="flex items-center gap-2">
                                <button onClick={closeTypeManagerModal} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition-colors">
                                    {t('actions.close')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}