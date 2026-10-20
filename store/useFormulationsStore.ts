// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand';
import { formulationsApi } from '@/lib/realApi';
import { getT } from './i18nStore'; // Импортируем геттер для получения функции перевода
import type {
  FormulationType,
  FormulationGroup,
  DocumentSet,
  FormulationPayload,
  FormulationVersionPayload,
  FormulationTypePayload
} from '@/lib/types';

// ==========================================
// ТИПЫ ДАННЫХ
// ==========================================
export interface EnrichedFormulation {
  id: number;
  type_id?: number;
  group_id?: number;
  name: string;
  is_favorite: boolean;
  current_version_id?: number;
  created_by: number;
  created_at: string;
  updated_at: string;
  type_name: string;
  text_content: string;
  author_name: string;
  author_avatar: string;
  author_email: string;
}

export interface FormulationUsage {
  count: number;
  document_sets: DocumentSet[];
}

type FilterTab = 'all' | 'favorite' | 'recent';

// ==========================================
// ИНТЕРФЕЙС STORE
// ==========================================
interface FormulationsStore {
  // --- STATE (Данные) ---
  formulations: EnrichedFormulation[];
  types: FormulationType[];
  groups: FormulationGroup[];
  usageCache: Record<number, FormulationUsage>;
  loading: boolean;
  filters: {
    tab: FilterTab;
    typeId: number | null;
  };
  
  // --- UI STATE (Модалки) ---
  isFormulationModalOpen: boolean;
  formulationModalMode: 'create' | 'edit';
  currentFormulation: EnrichedFormulation | null;
  isTypeManagerModalOpen: boolean;

  // --- ACTIONS (Действия) ---
  toggleFavorite: (id: number) => Promise<void>;
  moveType: (id: number, direction: 'up' | 'down') => Promise<void>;
  deleteType: (id: number) => Promise<void>;
  fetchFormulations: () => Promise<void>;
  fetchTypes: () => Promise<void>;
  fetchUsage: (id: number) => Promise<void>;
  deleteFormulation: (id: number) => Promise<void>;
  createFormulation: (payload: FormulationPayload, versionPayload: FormulationVersionPayload) => Promise<void>;
  updateFormulation: (id: number, payload: FormulationPayload, versionPayload: FormulationVersionPayload) => Promise<void>;
  createType: (payload: FormulationTypePayload) => Promise<void>;
  setTab: (tab: FilterTab) => void;
  setTypeId: (typeId: number | null) => void;
  openCreateModal: () => void;
  openEditModal: (formulation: EnrichedFormulation) => void;
  closeFormulationModal: () => void;
  openTypeManagerModal: () => void;
  closeTypeManagerModal: () => void;
}

// ==========================================
// РЕАЛИЗАЦИЯ STORE
// ==========================================
export const useFormulationsStore = create<FormulationsStore>((set, get) => ({
  // --- INITIAL STATE ---
  formulations: [],
  types: [],
  groups: [],
  usageCache: {},
  loading: false,
  filters: { tab: 'all', typeId: null },
  isFormulationModalOpen: false,
  formulationModalMode: 'create',
  currentFormulation: null,
  isTypeManagerModalOpen: false,

  // --- ACTIONS ---
  toggleFavorite: async (id) => {
    await formulationsApi.toggleFavorite(id);
    await get().fetchFormulations();
  },
  
  moveType: async (id, direction) => {
    try {
      await formulationsApi.moveType(id, direction);
      await get().fetchTypes();
    } catch (error) {
      // Используем getT() для перевода логов
      console.error(getT()('formulations.errors.type.move_failed'), error);
    }
  },
  
  deleteFormulation: async (id) => {
    try {
      await formulationsApi.deleteFormulation(id);
      await get().fetchFormulations();
    } catch (error: any) {
      console.error(getT()('formulations.errors.formulation.delete_failed_log'), error);
      alert(error.message || getT()('formulations.errors.formulation.delete_failed'));
    }
  },
  
  deleteType: async (id) => {
    try {
      await formulationsApi.deleteType(id);
      await get().fetchTypes();
    } catch (error: any) {
      console.error(getT()('formulations.errors.type.delete_failed_log'), error);
      alert(error.message || getT()('formulations.errors.type.delete_failed'));
    }
  },
  
  fetchFormulations: async () => {
    set({ loading: true });
    try {
      const { tab, typeId } = get().filters;
      const data = await formulationsApi.list(typeId ?? undefined) as EnrichedFormulation[];
      
      let filteredData = data;
      if (tab === 'favorite') {
        filteredData = data.filter(f => f.is_favorite);
      } else if (tab === 'recent') {
        filteredData = [...data].sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        ).slice(0, 10);
      }
      
      set({ formulations: filteredData, loading: false });
    } catch (error) {
      console.error(getT()('formulations.errors.formulation.fetch_failed'), error);
      set({ loading: false });
    }
  },
  
  fetchTypes: async () => {
    try {
      const types = await formulationsApi.getTypes();
      set({ types });
    } catch (error) {
      console.error(getT()('formulations.errors.type.fetch_failed'), error);
    }
  },
  
  fetchUsage: async (id: number) => {
    if (get().usageCache[id]) return;
    try {
      const usage = await formulationsApi.getUsage(id);
      set((state) => ({
        usageCache: { ...state.usageCache, [id]: usage }
      }));
    } catch (error) {
      console.error(getT()('formulations.errors.usage.fetch_failed'), error);
    }
  },
  
  createFormulation: async (payload, versionPayload) => {
    try {
      const newFormulation = await formulationsApi.create(payload);
      await formulationsApi.createVersion(newFormulation.id, versionPayload);
      get().closeFormulationModal();
      await get().fetchFormulations();
    } catch (error) {
      console.error(getT()('formulations.errors.formulation.create_failed'), error);
      throw error;
    }
  },
  
  updateFormulation: async (id, payload, versionPayload) => {
    try {
      await formulationsApi.update(id, payload);
      await formulationsApi.createVersion(id, versionPayload);
      get().closeFormulationModal();
      await get().fetchFormulations();
    } catch (error) {
      console.error(getT()('formulations.errors.formulation.update_failed'), error);
      throw error;
    }
  },
  
  createType: async (payload) => {
    try {
      await formulationsApi.createType(payload);
      await get().fetchTypes();
    } catch (error) {
      console.error(getT()('formulations.errors.type.create_failed'), error);
      throw error;
    }
  },
  
  setTab: (tab) => {
    set((state) => ({ filters: { ...state.filters, tab } }));
    get().fetchFormulations();
  },
  
  setTypeId: (typeId) => {
    set((state) => ({ filters: { ...state.filters, typeId } }));
    get().fetchFormulations();
  },
  
  openCreateModal: () => set({ isFormulationModalOpen: true, formulationModalMode: 'create', currentFormulation: null }),
  openEditModal: (formulation) => set({ isFormulationModalOpen: true, formulationModalMode: 'edit', currentFormulation: formulation }),
  closeFormulationModal: () => set({ isFormulationModalOpen: false, currentFormulation: null }),
  openTypeManagerModal: () => set({ isTypeManagerModalOpen: true }),
  closeTypeManagerModal: () => set({ isTypeManagerModalOpen: false }),
}));

// ==========================================
// СЕЛЕКТОРЫ
// ==========================================
export const useTotalFormulations = () =>
  useFormulationsStore((state) => state.formulations.length);

export const useUsedFormulationsCount = () =>
  useFormulationsStore((state) =>
    Object.values(state.usageCache).filter((u: any) => u.count > 0).length
  );