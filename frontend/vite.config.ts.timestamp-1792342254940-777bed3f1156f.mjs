// vite.config.ts
import { defineConfig, loadEnv } from "file:///D:/panshi11/work/topiclab/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///D:/panshi11/work/topiclab/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
function adminApiProxyPrefix(viteBasePath) {
  const withSlash = viteBasePath.endsWith("/") ? viteBasePath : `${viteBasePath}/`;
  return `${withSlash}api/admin`.replace(/\/{2,}/g, "/");
}
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || "/";
  const adminPrefix = adminApiProxyPrefix(base);
  const worldWeaveTarget = env.VITE_WORLDWEAVE_PROXY_TARGET || `http://127.0.0.1:${env.WORLDWEAVE_PORT || "3020"}`;
  const topicLabTarget = env.VITE_TOPICLAB_PROXY_TARGET || "http://127.0.0.1:8001";
  const adminPrefixRe = new RegExp(
    `^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  return {
    base,
    plugins: [react()],
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts"
    },
    server: {
      port: 3e3,
      proxy: {
        // Must be before `/api` -> Resonnet; admin lives on topiclab-backend :8001
        [adminPrefix]: {
          target: topicLabTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(adminPrefixRe, "/admin")
        },
        "/api/auth": {
          target: topicLabTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "")
        },
        "/api/source-feed": {
          target: topicLabTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "")
        },
        "/api/topics": {
          target: topicLabTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "")
        },
        "/api/v1/topics": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/topiclink": {
          target: topicLabTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "")
        },
        "/worldweave": {
          target: worldWeaveTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/worldweave/, "")
        },
        "/_next": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/api/v1/world": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/api/v1/openclaw": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/mcp-hub": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/skill-hub": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/topiclink": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/agent4s": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/youth-ted": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/inspiration": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/site": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/profile-import": {
          target: topicLabTarget,
          changeOrigin: true
        },
        "/api/v1/livebench": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/api/v1/source-knowledge": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/api/v1/signals": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/signals": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/source-knowledge": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/demo": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/daily": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/livebench": {
          target: worldWeaveTarget,
          changeOrigin: true
        },
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "")
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxwYW5zaGkxMVxcXFx3b3JrXFxcXHRvcGljbGFiXFxcXGZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxwYW5zaGkxMVxcXFx3b3JrXFxcXHRvcGljbGFiXFxcXGZyb250ZW5kXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9wYW5zaGkxMS93b3JrL3RvcGljbGFiL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSAndml0ZSdcclxuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xyXG5cclxuLyoqIEJyb3dzZXIgY2FsbHMgYCR7YmFzZX1hcGkvYWRtaW4vKmA7IHRvcGljbGFiLWJhY2tlbmQgc2VydmVzIGAvYWRtaW4vKmAuICovXHJcbmZ1bmN0aW9uIGFkbWluQXBpUHJveHlQcmVmaXgodml0ZUJhc2VQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIGNvbnN0IHdpdGhTbGFzaCA9IHZpdGVCYXNlUGF0aC5lbmRzV2l0aCgnLycpID8gdml0ZUJhc2VQYXRoIDogYCR7dml0ZUJhc2VQYXRofS9gXHJcbiAgcmV0dXJuIGAke3dpdGhTbGFzaH1hcGkvYWRtaW5gLnJlcGxhY2UoL1xcL3syLH0vZywgJy8nKVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XHJcbiAgY29uc3QgZW52ID0gbG9hZEVudihtb2RlLCBwcm9jZXNzLmN3ZCgpLCAnJylcclxuICBjb25zdCBiYXNlID0gZW52LlZJVEVfQkFTRV9QQVRIIHx8ICcvJ1xyXG4gIGNvbnN0IGFkbWluUHJlZml4ID0gYWRtaW5BcGlQcm94eVByZWZpeChiYXNlKVxyXG4gIGNvbnN0IHdvcmxkV2VhdmVUYXJnZXQgPVxyXG4gICAgZW52LlZJVEVfV09STERXRUFWRV9QUk9YWV9UQVJHRVQgfHxcclxuICAgIGBodHRwOi8vMTI3LjAuMC4xOiR7ZW52LldPUkxEV0VBVkVfUE9SVCB8fCAnMzAyMCd9YFxyXG4gIGNvbnN0IHRvcGljTGFiVGFyZ2V0ID0gZW52LlZJVEVfVE9QSUNMQUJfUFJPWFlfVEFSR0VUIHx8ICdodHRwOi8vMTI3LjAuMC4xOjgwMDEnXHJcbiAgY29uc3QgYWRtaW5QcmVmaXhSZSA9IG5ldyBSZWdFeHAoXHJcbiAgICBgXiR7YWRtaW5QcmVmaXgucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKX1gLFxyXG4gIClcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGJhc2UsXHJcbiAgICBwbHVnaW5zOiBbcmVhY3QoKV0sXHJcbiAgICB0ZXN0OiB7XHJcbiAgICAgIGVudmlyb25tZW50OiAnanNkb20nLFxyXG4gICAgICBzZXR1cEZpbGVzOiAnLi9zcmMvdGVzdC9zZXR1cC50cycsXHJcbiAgICB9LFxyXG4gICAgc2VydmVyOiB7XHJcbiAgICAgIHBvcnQ6IDMwMDAsXHJcbiAgICAgIHByb3h5OiB7XHJcbiAgICAgICAgLy8gTXVzdCBiZSBiZWZvcmUgYC9hcGlgIC0+IFJlc29ubmV0OyBhZG1pbiBsaXZlcyBvbiB0b3BpY2xhYi1iYWNrZW5kIDo4MDAxXHJcbiAgICAgICAgW2FkbWluUHJlZml4XToge1xyXG4gICAgICAgICAgdGFyZ2V0OiB0b3BpY0xhYlRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoYWRtaW5QcmVmaXhSZSwgJy9hZG1pbicpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvYXV0aCc6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvYXBpLywgJycpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvc291cmNlLWZlZWQnOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHRvcGljTGFiVGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgucmVwbGFjZSgvXlxcL2FwaS8sICcnKSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvYXBpL3RvcGljcyc6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvYXBpLywgJycpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvdjEvdG9waWNzJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiB0b3BpY0xhYlRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvYXBpL3RvcGljbGluayc6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvYXBpLywgJycpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy93b3JsZHdlYXZlJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiB3b3JsZFdlYXZlVGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgucmVwbGFjZSgvXlxcL3dvcmxkd2VhdmUvLCAnJyksXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL19uZXh0Jzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiB3b3JsZFdlYXZlVGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvdjEvd29ybGQnOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHdvcmxkV2VhdmVUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2FwaS92MS9vcGVuY2xhdyc6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2FwaS92MS9tY3AtaHViJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiB0b3BpY0xhYlRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvYXBpL3YxL3NraWxsLWh1Yic6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2FwaS92MS90b3BpY2xpbmsnOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHRvcGljTGFiVGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvdjEvYWdlbnQ0cyc6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2FwaS92MS95b3V0aC10ZWQnOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHRvcGljTGFiVGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvdjEvaW5zcGlyYXRpb24nOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHRvcGljTGFiVGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvdjEvc2l0ZSc6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2FwaS92MS9wcm9maWxlLWltcG9ydCc6IHtcclxuICAgICAgICAgIHRhcmdldDogdG9waWNMYWJUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2FwaS92MS9saXZlYmVuY2gnOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHdvcmxkV2VhdmVUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2FwaS92MS9zb3VyY2Uta25vd2xlZGdlJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiB3b3JsZFdlYXZlVGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgJy9hcGkvdjEvc2lnbmFscyc6IHtcclxuICAgICAgICAgIHRhcmdldDogd29ybGRXZWF2ZVRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvc2lnbmFscyc6IHtcclxuICAgICAgICAgIHRhcmdldDogd29ybGRXZWF2ZVRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvc291cmNlLWtub3dsZWRnZSc6IHtcclxuICAgICAgICAgIHRhcmdldDogd29ybGRXZWF2ZVRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvZGVtbyc6IHtcclxuICAgICAgICAgIHRhcmdldDogd29ybGRXZWF2ZVRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvZGFpbHknOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHdvcmxkV2VhdmVUYXJnZXQsXHJcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICAnL2xpdmViZW5jaCc6IHtcclxuICAgICAgICAgIHRhcmdldDogd29ybGRXZWF2ZVRhcmdldCxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgICcvYXBpJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiAnaHR0cDovLzEyNy4wLjAuMTo4MDAwJyxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoL15cXC9hcGkvLCAnJyksXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgfVxyXG59KVxyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWtTLFNBQVMsY0FBYyxlQUFlO0FBQ3hVLE9BQU8sV0FBVztBQUdsQixTQUFTLG9CQUFvQixjQUE4QjtBQUN6RCxRQUFNLFlBQVksYUFBYSxTQUFTLEdBQUcsSUFBSSxlQUFlLEdBQUcsWUFBWTtBQUM3RSxTQUFPLEdBQUcsU0FBUyxZQUFZLFFBQVEsV0FBVyxHQUFHO0FBQ3ZEO0FBRUEsSUFBTyxz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
