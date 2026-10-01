import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    // Só localhost. Um dev server escutando em 0.0.0.0 fica exposto à rede
    // local, e a sessão autenticada de quem estiver testando vai junto.
    host: '127.0.0.1',
  },
});
