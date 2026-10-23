import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
plugins: [react()],
define: {
"import.meta.env.API_URL": JSON.stringify(process.env.API_URL || ""),
},
server: {
proxy: {
"/api": "http://localhost:8000",
},
},
});
