import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    port: 5190,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
