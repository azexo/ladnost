// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// app/editor/[setId]/page.tsx 
'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import EditorLayout from '@/components/editor/EditorLayout';
import Navbar from '@/components/Navbar';
import { useStore } from '@/store/useStore';
import { useTranslations } from 'next-intl';

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const setId = Number(params.setId);
  
  const isLoading = useStore((s) => s.documentPackage.isLoading);
  const loadPackage = useStore((s) => s.documentPackage.loadPackage);

  const t = useTranslations('common');

  useEffect(() => {
    if (isNaN(setId)) {
      router.replace('/workspace');
      return;
    }
    loadPackage(setId);
  }, [setId, loadPackage, router]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">
      {t('loadingPackage')}
    </div>;
  }

  return (
    <>
      <Navbar />
      <EditorLayout setId={setId} /> 
    </>
  );
}