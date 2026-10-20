// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/EditorLayout.tsx
"use client";
import { useRef, useEffect } from 'react';
import DocumentEditor from './DocumentEditor';
import { LeftPanel } from './left-panel/LeftPanel';
import { useStore } from '@/store/useStore';

interface EditorLayoutProps {
  setId: number;
}

export default function EditorLayout({ setId }: EditorLayoutProps) {
  const editorRef = useRef<any>(null);
  
  const setEditorRef = useStore((s: any) => s.editor.setRef);
  const fetchInitialData = useStore((s: any) => s.data.fetchInitialData);

  useEffect(() => {
    if (editorRef.current) {
      setEditorRef(editorRef);
      fetchInitialData(setId); 
    }
  }, [setEditorRef, fetchInitialData, setId]);

  return (
    <main id="main-workspace" className="flex-1 flex overflow-hidden">
      <LeftPanel />
      <DocumentEditor ref={editorRef} documentSetId={setId} />
    </main>
  );
}