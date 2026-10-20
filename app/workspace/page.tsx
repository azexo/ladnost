// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

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