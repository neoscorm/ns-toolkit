// Declarations for APIs that are not yet in the standard TypeScript types
// (the File System Access API works only in Chromium browsers)

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: string | FileSystemHandle;
}

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
  queryPermission?: (desc?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (desc?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}
