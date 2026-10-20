interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | string;
  }): Promise<FileSystemDirectoryHandle>;
}
