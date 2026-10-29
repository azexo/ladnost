// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

'use client';
import './tasks.css';
import { Suspense } from 'react';
import Navbar from '@/components/Navbar';
import Tasks from '@/components/Tasks';

export default function TasksPage() {
    return (
        <>
            <Navbar />
            <Suspense
                fallback={
                    <div className="flex h-screen w-full flex-col items-center justify-center gap-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                    </div>
                }
            >
                <Tasks />
            </Suspense>
        </>
    );
}