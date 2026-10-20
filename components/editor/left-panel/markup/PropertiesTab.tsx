// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/PropertiesTab.tsx
import { useStore } from '@/store/useStore';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { scrollAndHighlightInEditor } from '@/components/editor/editorExtensions';

interface PropertiesTabProps {
  openSettingsPanel: (type: 'property' | 'condition' | 'formulation', id?: number) => void;
}

// ==========================================
// 1. КАРТОЧКА ЭЛЕМЕНТА (Свойство / Условие)
// ==========================================
const SortableItem = ({ item, openSettingsPanel }: any) => {
  const t = useTranslations('PropertiesTab');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.uid });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
    width: '100%',
  };

  const isCondition = item.itemType === 'condition';

  const getIcon = (type: string, dataType: string) => {
    if (type === 'condition') return 'fa-solid fa-code-branch fa-fw';
    switch (dataType) {
      case 'text': return 'fa-solid fa-font fa-fw';
      case 'money': return 'fa-solid fa-hashtag fa-fw';
      case 'number': return 'fa-solid fa-hashtag fa-fw';
      case 'date': return 'fa-regular fa-calendar fa-fw';
      default: return 'fa-solid fa-circle fa-fw';
    }
  };

  const getLabel = (type: string, dataType: string) => {
    if (type === 'condition') return t('condition');
    switch (dataType) {
      case 'text': return t('text');
      case 'money': return t('money');
      case 'number': return t('number');
      case 'date': return t('date');
      default: return t('property');
    }
  };

  return (
    <div
      id={`prop-card-${item.id}`}
      ref={setNodeRef}
      style={style}
      className={`bg-white border border-slate-200 ${isCondition ? 'border-l-4 border-l-orange-400' : ''} rounded-lg p-2.5 flex items-center gap-2.5 hover:border-primary-300 hover:shadow-sm cursor-pointer property-item w-full`}
      onClick={() => {
        openSettingsPanel(item.itemType, item.id);
        // 🆕 Клик по карточке -> прокрутка редактора
        if (item.identifier) {
          scrollAndHighlightInEditor(item.identifier);
        }
      }}
    >
      {/* Ручка для перетаскивания карточки */}
      <div
        {...attributes}
        {...listeners}
        className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <i className="fa-solid fa-grip-vertical text-xs"></i>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-800 truncate">{item.name}</div>
        <div className={`text-[11px] ${isCondition ? 'text-orange-500 font-semibold' : 'text-slate-400'} mt-0.5`}>
          <i className={`${getIcon(item.itemType, item.data_type)} mr-1`}></i>
          {getLabel(item.itemType, item.data_type)}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 2. КОМПОНЕНТ СЕКЦИИ
// ==========================================
const Section = ({ section, items, openSettingsPanel }: any) => {
  const t = useTranslations('PropertiesTab');
  const collapsedSections = useStore((s: any) => s.data.collapsedSections || {});
  const toggleSectionCollapse = useStore((s: any) => s.data.toggleSectionCollapse);
  const updateSection = useStore((s: any) => s.data.updateSection);
  const deleteSection = useStore((s: any) => s.data.deleteSection);
  
  const isCollapsed = !!collapsedSections[section.id];
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(section.name);
  
  // 🆕 Получаем текущее состояние (является ли секция таблицей)
  const isTable = !!section.is_table;

  // 🆕 Функция переключения режима таблицы
  const toggleTableMode = (e: React.MouseEvent) => {
    e.stopPropagation(); // Предотвращаем всплытие события, чтобы не сработало сворачивание
    updateSection(section.id, { is_table: !isTable });
  };

  // 🆕 Адаптируем handleSave под новую сигнатуру updateSection
  const handleSave = () => {
    if (editName.trim()) updateSection(section.id, { name: editName.trim() });
    setIsEditing(false);
  };

  // useSortable для перетаскивания и сортировки самой секции
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `section-${section.id}` });
  
  // useDroppable для тела секции (чтобы можно было дропать в пустую секцию)
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `body-${section.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 40 : 'auto',
  };

  const handleDelete = () => {
    if (confirm(t('confirmDeleteSection'))) {
      deleteSection(section.id);
    }
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-3 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Хедер секции */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${isOver ? 'border-primary-300 bg-primary-50/50' : 'border-slate-100 bg-slate-50'}`}>
        {/* Ручка для перетаскивания секции */}
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 flex items-center">
          <i className="fa-solid fa-grip-vertical text-xs"></i>
        </div>
        
        {/* Кнопка сворачивания */}
        <button 
          onClick={() => toggleSectionCollapse(section.id)} 
          className="text-slate-400 hover:text-slate-600 w-4 h-4 flex items-center justify-center"
        >
          <i className={`fa-solid fa-chevron-${isCollapsed ? 'right' : 'down'} text-[10px]`}></i>
        </button>
        
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            className="flex-1 text-xs font-medium text-slate-700 bg-white border border-primary-300 rounded px-2 py-1 focus:outline-none leading-none"
            autoFocus
          />
        ) : (
          <div
            className="flex-1 text-[11px] translate-y-[1px] font-medium text-slate-400 uppercase tracking-wider truncate cursor-pointer select-none leading-none flex items-center"
            onDoubleClick={() => { setIsEditing(true); setEditName(section.name); }}
          >
            {section.name}
          </div>
        )}
        
        {/* Кнопки действий */}
        {!isEditing && (
          <div className="flex items-center gap-1 opacity-60 hover:opacity-100">
            <button 
              onClick={() => { setIsEditing(true); setEditName(section.name); }} 
              className="text-slate-400 hover:text-primary-500 flex items-center justify-center" 
              title={t('rename')}
            >
              <i className="fa-solid fa-pen text-[11px]"></i>
            </button>
            <button 
              onClick={toggleTableMode} 
              className={`flex items-center justify-center transition-colors ${
                isTable 
                  ? 'text-primary-600' // 🎨 Активное состояние (Таблица) - акцентный цвет
                  : 'text-slate-400 hover:text-slate-600' // Неактивное состояние (Обычный текст) - серый
              }`} 
              title={isTable ? t('tableModeActive') : t('tableModeInactive')}
            >
              <i className="fa-solid fa-table text-[11px]"></i>
            </button>
            <button 
              onClick={handleDelete} 
              className="text-slate-400 hover:text-red-500 flex items-center justify-center" 
              title={t('delete')}
            >
              <i className="fa-solid fa-trash text-[11px]"></i>
            </button>
          </div>
        )}
      </div>
      
      {/* Тело секции */}
      {!isCollapsed && (
        <div ref={setDropRef} className={`p-2.5 min-h-[40px] ${isOver ? 'bg-primary-50/30' : ''}`}>
          {items.length === 0 && (
            <div className="text-center text-slate-300 text-xs py-2 italic">{t('dropHere')}</div>
          )}
          <SortableContext items={items.map((i: any) => i.uid)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((item: any) => (
                <SortableItem key={item.uid} item={item} openSettingsPanel={openSettingsPanel} />
              ))}
            </div>
          </SortableContext>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 3. ГЛАВНЫЙ КОМПОНЕНТ ВКЛАДКИ
// ==========================================
export const PropertiesTab = ({ openSettingsPanel }: PropertiesTabProps) => {
  const t = useTranslations('PropertiesTab');
  
  const properties = useStore((s: any) => s.data.properties || []);
  const conditions = useStore((s: any) => s.data.conditions || []);
  const sections = useStore((s: any) => s.data.sections || []);
  const addSection = useStore((s: any) => s.data.addSection);
  const moveItemToSection = useStore((s: any) => s.data.moveItemToSection);
  const reorderSections = useStore((s: any) => s.data.reorderSections);
  const reorderItems = useStore((s: any) => s.data.reorderItems);
  
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const items = [
    ...properties.map((p: any) => ({ ...p, uid: `prop-${p.id}`, itemType: 'property' as const })),
    ...conditions.map((c: any) => ({ ...c, uid: `cond-${c.id}`, itemType: 'condition' as const })),
  ];

  const unassignedItems = items.filter(i => !i.section_id);
  const sortedSections = [...sections].sort((a: any, b: any) => a.sort_order - b.sort_order);
  
  const { setNodeRef: setUnassignedDropRef, isOver: isUnassignedOver } = useDroppable({ id: 'body-unassigned' });
  
  const sectionIds = sortedSections.map((s: any) => `section-${s.id}`);
  const unassignedIds = unassignedItems.map(i => i.uid);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const isSection = activeId.startsWith('section-');
    const isItem = !isSection;

    if (isSection) {
      if (overId.startsWith('section-')) {
        reorderSections(activeId, overId);
      }
    } else if (isItem) {
      const activeItem = items.find((i: any) => i.uid === activeId);
      if (!activeItem) return;

      let targetSectionId: number | null = null;
      let overItemId: string | null = null;

      if (overId.startsWith('prop-') || overId.startsWith('cond-')) {
        overItemId = overId;
        const overItem = items.find((i: any) => i.uid === overId);
        targetSectionId = overItem ? overItem.section_id : null;
      } else if (overId.startsWith('body-')) {
        if (overId === 'body-unassigned') targetSectionId = null;
        else targetSectionId = Number(overId.replace('body-', ''));
      } else if (overId.startsWith('section-')) {
        targetSectionId = Number(overId.replace('section-', ''));
      }

      if (activeItem.section_id === targetSectionId && overItemId) {
        if (reorderItems) reorderItems(activeId, overItemId);
      } else {
        moveItemToSection(activeId, targetSectionId);
      }
    }
  };

  const highlightTarget = useStore((s: any) => s.ui.highlightTarget);

  useEffect(() => {
    if (highlightTarget && highlightTarget.type === 'property') {
      const cardEl = document.getElementById(`prop-card-${highlightTarget.id}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cardEl.classList.add('card-highlight-flash');
        setTimeout(() => cardEl.classList.remove('card-highlight-flash'), 1500);
      }
    }
  }, [highlightTarget]);

  return (
    <div id="content-properties" className="flex flex-col flex-1 overflow-hidden">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Кнопка / Инпут добавления секции */}
          {isAddingSection ? (
            <div className="bg-white rounded-lg px-3 py-2 flex items-center gap-2">
              <input
                type="text"
                placeholder={t('sectionNamePlaceholder')}
                value={newSectionName}
                onChange={e => setNewSectionName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newSectionName.trim()) {
                    addSection(newSectionName.trim());
                    setNewSectionName('');
                    setIsAddingSection(false);
                  } else if (e.key === 'Escape') setIsAddingSection(false);
                }}
                className="flex-1 text-xs font-medium text-slate-700 bg-white border border-primary-300 rounded px-2 py-1 focus:outline-none leading-none"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { if(newSectionName.trim()) { addSection(newSectionName.trim()); setNewSectionName(''); setIsAddingSection(false); } }}
                  className="text-slate-400 hover:text-primary-500 flex items-center justify-center"
                  title={t('save')}
                >
                  <i className="fa-solid fa-check text-[11px]"></i>
                </button>
                <button
                  onClick={() => setIsAddingSection(false)}
                  className="text-slate-400 hover:text-red-500 flex items-center justify-center"
                  title={t('cancel')}
                >
                  <i className="fa-solid fa-xmark text-[11px]"></i>
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingSection(true)}
              className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-xs hover:border-primary-400 hover:text-primary-600"
            >
              <i className="fa-solid fa-plus mr-1"></i> {t('addSection')}
            </button>
          )}

          {/* Зона "Без секции" */}
          <div ref={setUnassignedDropRef} className={`p-2 border border-dashed rounded-lg ${isUnassignedOver ? 'border-primary-400 bg-primary-50/30' : 'border-slate-200'}`}>
            <div className="text-xs text-slate-400 mb-1.5 px-1 font-medium uppercase tracking-wide">{t('unassigned')}</div>
            {unassignedItems.length === 0 && !isUnassignedOver && (
              <div className="text-center text-slate-300 text-xs py-1 italic">{t('empty')}</div>
            )}
            <SortableContext items={unassignedIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {unassignedItems.map(item => (
                  <SortableItem key={item.uid} item={item} openSettingsPanel={openSettingsPanel} />
                ))}
              </div>
            </SortableContext>
          </div>

          {/* Список секций */}
          <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
            {sortedSections.map((section: any) => {
              const sectionItems = items.filter((i: any) => i.section_id === section.id).sort((a: any, b: any) => a.sort_order - b.sort_order);
              return <Section key={section.id} section={section} items={sectionItems} openSettingsPanel={openSettingsPanel} />;
            })}
          </SortableContext>
        </div>
      </DndContext>
    </div>
  );
};