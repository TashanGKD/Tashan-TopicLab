# WorldWeave 独立部署

WorldWeave 的公网应用与信源刷新进程独立部署，不再由 TopicLab 的 Docker Compose 或主部署工作流启动。TopicLab 只保留两条可配置连接：

- `WORLDWEAVE_BASE_URL`：`topiclab-backend` 读取信源快照的服务地址。
- `WORLDWEAVE_UPSTREAM`：TopicLab 前端 Nginx 的同源反向代理上游。

两个变量通常指向同一个 WorldWeave 公网源站，例如 `https://worldweave.example.com`。

## 服务器要求

- 能稳定访问 npm 官方仓库、模型 API、搜索与新闻信源。
- Docker 和 Docker Compose 可用。
- 建议至少 8 GB 内存；公网容器默认限制 2 GB，刷新容器默认限制 5 GB。
- 仅将反向代理端口暴露到公网，WorldWeave 应监听 `127.0.0.1:5000` 或由防火墙限制来源。

部署前先在目标服务器检查外网连通性；HTTP 状态可以是鉴权失败，但不能是超时或 `000`：

```bash
curl -I --max-time 20 https://registry.npmjs.org/
curl -I --max-time 20 https://api.scnet.cn/
```

## 独立部署

目标服务器的 WorldWeave 部署目录需要一份仅由服务器读取的 `.env`，至少包含模型和信源密钥。不要把真实密钥提交到仓库。

`TashanGKD/worldweave` 的 `main` 分支会触发独立 GitHub Actions 部署。仓库需要配置 `DEPLOY_HOST`、`DEPLOY_USER`、`SSH_PRIVATE_KEY` 和 `DEPLOY_ENV` Secrets。部署工作流会构建并启动两个容器：

- `worldweave`：绑定 `127.0.0.1:5000` 的公网缓存优先 Web/API 服务。
- `worldweave-refresh`：运行 `world-source-refresh-daemon.mjs` 的后台刷新服务及内部重任务 worker。

可通过服务器环境覆盖资源预算：

```bash
WORLDWEAVE_MEM_LIMIT=2g
WORLDWEAVE_REFRESH_MEM_LIMIT=5g
WORLDWEAVE_NODE_OPTIONS=--max-old-space-size=1536
WORLDWEAVE_REFRESH_NODE_OPTIONS=--max-old-space-size=4096
```

## 反向代理与验收

在独立服务器上将一个 HTTPS 域名反向代理到 `127.0.0.1:5000`。部署后至少验证：

```bash
curl -fsS https://<worldweave-domain>/api/v1/openclaw/skill.md >/dev/null
curl -fsS 'https://<worldweave-domain>/api/v1/world/state?scene=global' >/dev/null
curl -fsS https://<worldweave-domain>/api/v1/world/source-knowledge/status >/dev/null
```

还需检查两个 Compose 服务均为 `healthy`，并确认刷新日志持续推进，没有重复 OOM：

```bash
docker compose ps
docker compose logs --tail=120 worldweave-refresh
```

## 接入 TopicLab

确认独立服务通过验收后，再更新 TopicLab 的 `DEPLOY_ENV`：

```bash
WORLDWEAVE_BASE_URL=https://<worldweave-domain>
WORLDWEAVE_UPSTREAM=https://<worldweave-domain>
VITE_WORLDWEAVE_FRONTEND_URL=/worldweave/
```

TopicLab 前端继续对浏览器提供 `/worldweave/`、`/_next/*`、`/api/v1/world/*`、`/signals` 和 LiveBench 等同源路径，但请求会转发到独立服务器。TopicLab 主部署失败或重启时不会再停止 WorldWeave；WorldWeave 发布也不再重建 TopicLab 容器。
