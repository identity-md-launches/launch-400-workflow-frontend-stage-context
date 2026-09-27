import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "runtime-deployment-in-development",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = req.url?.split("?")[0] ?? "";
          if (
            path !== "/imd-deployment.json" &&
            !/^\/abi\/[\w-]+\.json$/.test(path)
          )
            return next();
          try {
            const body = await readFile(
              new URL(`../dist${path}`, import.meta.url),
            );
            res.setHeader("Content-Type", "application/json");
            res.end(body);
          } catch {
            res.statusCode = 503;
            res.end(
              "Build the static export to prepare runtime configuration.",
            );
          }
        });
      },
    },
  ],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { host: "0.0.0.0" },
});
