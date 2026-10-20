// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

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