// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

'use client';
import './myfiles.css';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import MyFiles from '@/components/files/MyFiles';
import { useFilesStore } from '@/store/useFilesStore'; 

export default function WorkspacePage() {
  return (
    <>
      <Navbar />
      <MyFiles />
    </>
  );
}