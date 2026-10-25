// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

'use client';
import './formulations.css';
import { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Formulations from '@/components/Formulations';

export default function FormulationsPage() {
  return (
    <>
      <Navbar />
      <Formulations />
    </>
  );
}