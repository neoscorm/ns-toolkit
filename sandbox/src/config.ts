// Origins from which the sandbox may accept commands (the toolkit address).
// Set with the VITE_TOOLKIT_ORIGINS variable at build time (comma-separated list).

const fromEnv = (import.meta.env.VITE_TOOLKIT_ORIGINS as string | undefined)
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  hostOrigins: fromEnv?.length
    ? fromEnv
    : import.meta.env.DEV
      ? ['http://localhost:5173']
      : ['https://neoscorm.com', 'https://www.neoscorm.com'],
  toolkitUrl: 'https://neoscorm.com/toolkit/',
};
