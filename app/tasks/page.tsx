// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

'use client';
import './tasks.css';
import { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Tasks from '@/components/Tasks';

export default function TasksPage() {
  return (
    <>
      <Navbar />
      <Tasks />
    </>
  );
}