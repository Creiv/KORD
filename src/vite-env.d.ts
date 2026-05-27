/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REKORD_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
