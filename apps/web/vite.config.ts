import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("osx-") } } })],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@vraxis/osx-components")) return "osx-components";
          if (id.includes("highlight.js")) return "syntax-highlighting";
          if (id.includes("/vue/") || id.includes("/@vue/")) return "vue-runtime";
          return "vendor";
        },
      },
    },
  },
  test: {
    exclude: ["test/browser/**", "node_modules/**", "dist/**"],
  },
  server: {
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
});
