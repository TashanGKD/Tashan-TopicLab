# WorldWeave 超时与东盟专题可靠性修复清单

状态：主要修复及东盟点击复发专项修复已完成，保留 4 项非阻塞观察/瘦身工作
建立日期：2026-08-09
最新复测：2026-08-10
生产站点：`https://world.tashan.chat`
生产项目：`/var/www/github-actions/repos/worldweave`

## 目标

1. WorldWeave Web 服务冷启动后尽快可用，不再等待全量刷新。
2. 刷新任务拥有真实总超时、取消传播、single-flight 和可解释状态。
3. 东盟专题使用缓存优先、后台异步刷新，不再由页面请求承担全量抓取。
4. 容器可以优雅停止，不再被固定 cron 强制杀死并产生退出码 137。
5. 修改按“项目源码、GitHub Actions/workflow、env.deploy、仅远程服务器”分类交付。

## 已确认的生产基线

- `tashan-topiclab-worldweave-1`：健康运行，未发生 OOM。
- `tashan-topiclab-worldweave-refresh-1`：内存限制 6 GiB，检查时仅使用约 236 MiB，`OOMKilled=false`。
- root crontab 存在：`0 4 */2 * * docker restart tashan-topiclab-worldweave-refresh-1`。
- Docker 停止刷新容器 10 秒后强制 SIGKILL，历史退出码为 137。
- 刷新 daemon 固定等待 12 秒后才启动刷新循环。
- 最近 30 轮刷新平均 587.613 秒，P95 646.361 秒，19/30 为失败或降级。
- 2026-08-09 20:00（Asia/Shanghai）一轮刷新耗时 670.711 秒。
- 同一轮五个重型 World 端点依次超时 120/90/90/30/60 秒。
- 东盟 `fresh=1` 请求在 60 秒超时后，底层任务仍继续写缓存；专题 RSS 缓存比主任务结束晚约 5 分钟写完。
- 当前 `withTimeout` 使用 `Promise.race`，不会取消底层任务。
- `--timeout-minutes` 当前只解析和显示，没有包裹整轮 `runOnce()`。

## A. 项目源码修改

### A1. WorldWeave 刷新任务

- [x] `WW-SRC-01` 为整轮刷新增加真实 deadline 和 `AbortController`。
- [x] `WW-SRC-02` 将整轮、单端点、容器关闭信号合并并向下传递。
- [x] `WW-SRC-03` 超时后停止抓取、批处理、缓存构建和写入。
- [x] `WW-SRC-04` 统一状态为 `queued/running/success/degraded/timed_out/canceled/failed`。
- [x] `WW-SRC-05` 增加 `run_id/trigger/deadline_at/heartbeat_at/error_code`。
- [x] `WW-SRC-06` 为刷新循环增加 single-flight，重复触发复用当前任务。
- [x] `WW-SRC-07` 将只读快照有限并发，重型写任务保持互斥。
- [x] `WW-SRC-08` 停止把独立东盟刷新排在全部全局重型任务之后。
- [x] `WW-SRC-09` 将固定 12 秒 sleep 改为内部服务健康探针。
- [x] `WW-SRC-10` daemon 使用独立进程组优雅终止并清理子孙进程、PID 和锁。
- [x] `WW-SRC-11` 原子写入状态和缓存，避免半文件覆盖。

主要文件：

- `worldweave/scripts/world-source-refresh.mjs`
- `worldweave/scripts/world-source-refresh-daemon.mjs`
- `worldweave/scripts/world-start.mjs`
- World API 路由及其加载器

### A2. 东盟专题

- [x] `ASEAN-SRC-01` GET 专题接口只读取最后有效缓存，不直接执行 `fresh=1` 全量抓取。
- [x] `ASEAN-SRC-02` 新增异步刷新提交接口，返回 `202 + run_id`。
- [x] `ASEAN-SRC-03` 新增刷新状态接口，支持轮询和取消。
- [x] `ASEAN-SRC-04` 将 `withTimeout` 改为真正可取消的执行器。
- [x] `ASEAN-SRC-05` 将 signal 传入 Metaso、RSS、公共风险和数据指标加载器。
- [x] `ASEAN-SRC-06` 为四类数据源增加 single-flight、跨容器锁和过期锁恢复。
- [x] `ASEAN-SRC-07` 外部请求使用有限并发、失败回退和总预算。
- [x] `ASEAN-SRC-08` 空结果、严重缩水和超时不得覆盖最后有效缓存。
- [ ] `ASEAN-SRC-09` 已拆分 `page_generated_at/data_refreshed_at`；`latest_partial_refresh_at` 尚未增加，列为非阻塞观察项。
- [x] `ASEAN-SRC-10` 页面按钮立即进入排队/刷新状态，不阻塞页面。
- [ ] `ASEAN-SRC-11` 大型指标和研究结果按需加载尚未实施；缓存化后页面已降至约 0.42 秒，单独列入后续瘦身。
- [x] `ASEAN-SRC-12` 修复 React hydration error #418。
- [x] `ASEAN-SRC-13` 研究 SSE 先建立响应，再构建研究上下文。

主要文件：

- `worldweave/src/app/api/v1/world/asean/route.ts`
- `worldweave/src/app/api/v1/world/asean/research/route.ts`
- `worldweave/src/lib/world/asean-page-data.ts`
- `worldweave/src/lib/world/asean-metaso-search.ts`
- `worldweave/src/lib/world/asean-source-feeds.ts`
- `worldweave/src/lib/world/asean-public-risk-events.ts`
- `worldweave/src/lib/world/asean-dataset-metrics.ts`
- `worldweave/src/app/demo/asean/asean-demo-client.tsx`

## B. Docker Compose / GitHub Actions / workflow 修改

- [x] `WF-01` 刷新容器使用 exec-form `node ...`，不再经过 shell 包装层。
- [x] `WF-02` 配置 `init: true`、`stop_signal: SIGTERM` 和 45 秒 `stop_grace_period`。
- [x] `WF-03` 健康检查只验证受管 worker 的 PID、命令行和端口，不等待全量刷新完成。
- [x] `WF-04` Compose 替换容器时按 45 秒优雅停止窗口等待刷新安全退出。
- [x] `WF-05` 部署后执行 Web、东盟缓存读取和刷新状态 smoke test；生命周期故障注入在线上人工验收完成。
- [x] `WF-06` CI 增加超时、取消、single-flight、原子写和子孙进程清理测试。
- [x] `WF-07` 部署失败时将 `worldweave:rollback` 恢复为活动镜像。

主要文件待核对：

- `docker-compose.yml`
- `docker-compose.override.yml`（生产服务器）
- `.github/workflows/*`
- WorldWeave 部署脚本

## C. env.deploy 修改

- [x] `ENV-01` 整轮刷新硬超时默认 12 分钟。
- [x] `ENV-02` 内部 worker readiness 默认 30 秒、500 毫秒轮询。
- [x] `ENV-03` 只读端点并发 3、重型任务每轮 1 个、目录抓取并发 3。
- [x] `ENV-04` 东盟整轮 120 秒，Metaso/RSS/风险各 15 秒，指标单次 8 秒。
- [x] `ENV-05` RSS 并发 4、指标并发 4、指标尝试 2 次；失败时回退最后有效缓存。
- [x] `ENV-06` 服务 ready 后后台执行；refresh daemon 不依赖 Web 容器完成全量刷新。
- [x] `ENV-07` 已同步独立 `worldweave/.env.example` 和本清单，未记录任何密钥值。

## D. 仅远程服务器修改

- [x] `REMOTE-01` root crontab 已备份到 `/var/backups/topiclab-worldweave-20260809-reliability/root.crontab`。
- [x] `REMOTE-02` 固定 `docker restart tashan-topiclab-worldweave-refresh-1` cron 已删除，当前匹配数为 0。
- [ ] `REMOTE-03` 未清理旧日志：为保证回滚证据完整，本次只备份、不删除。
- [x] `REMOTE-04` 生产 override 已核对并缩减为仅保留代理所需配置，原件已备份。
- [x] `REMOTE-05` 新镜像、Compose 停机参数和健康检查已在线验证。
- [ ] `REMOTE-06` 故障注入和人工 restart 已确认无 137；仍需跨过下一次原 04:00 cron 时点做自然观察。

## E. 验收与线上测试

- [x] `TEST-01` 本地单元测试覆盖总超时、取消传播、锁回收、原子写和进程组清理。
- [ ] `TEST-02` 已覆盖全超时、无缓存保护和锁恢复；尚未为 HTTP 429 与人为损坏缓存增加独立用例。
- [x] `TEST-03` 本地 29/29 单测、TypeScript 和生产构建通过，Compose 配置验证通过。
- [x] `TEST-04` 线上缓存 API 5 次为 0.180–0.232 秒，后续重复测试仍为 0.176–0.251 秒。
- [x] `TEST-05` 线上异步刷新完成超过 3 轮；最终连续三轮约 25.220、25.281、25.227 秒。
- [x] `TEST-06` 跨容器并发重复启动复用同一 `run_id`，`reused=true`。
- [x] `TEST-07` 线上优雅停止中任务状态为 `canceled/CANCELED`、容器退出码 0、`OOMKilled=false`。
- [x] `TEST-08` 线上页面显示真实数据日期；点击立即显示“已排队”；控制台 0 错误、0 警告。
- [ ] `TEST-09` 已以进程组故障注入确认旧 worker/子孙进程消失；尚未执行独立的“超时后静置 5 分钟比较全部缓存 mtime”测试。
- [x] `TEST-10` 已记录部署前后耗时、失败率和缓存日期对比。

建议验收线：

- 容器冷启动到 ready：P95 ≤ 15 秒。
- 东盟缓存读取 API：P95 ≤ 1 秒。
- 异步刷新提交：≤ 500 毫秒。
- 东盟后台刷新：硬上限 120 秒。
- WorldWeave 全量刷新：首阶段 P95 ≤ 8 分钟，并且无 deadline 后残留任务。
- 连续测试中无退出码 137、无重复任务、无旧缓存被空结果覆盖。

## F. 最终交付分类

最终报告必须分别列出：

1. 仅远程服务器修改及其备份/回滚方法。
2. 本项目 Docker Compose、GitHub Actions 和 workflow 修改。
3. WorldWeave 子模块源码修改。
4. `.env.deploy` 与 `.env.deploy.example` 修改的键名和取值策略，不披露密钥。
5. 本地与线上每轮测试结果。
6. 未完成项、剩余风险和后续观察项。

## G. 根因结论

1. **WorldWeave 经常“自己关掉”不是 OOM。** 生产机 root crontab 每两天 04:00 固定执行 `docker restart tashan-topiclab-worldweave-refresh-1`；旧容器只有 10 秒停机窗口，刷新进程又经过 shell 包装，未在窗口内退出时会被 SIGKILL，形成退出码 137。检查时刷新容器约 236 MiB/6 GiB，`OOMKilled=false`。
2. **整轮超时原本没有生效。** `--timeout-minutes` 只被解析和打印，没有包裹 `runOnce()`；端点层使用的 `Promise.race` 只让调用者返回，底层抓取和缓存写入仍继续，所以会出现任务结束后数分钟仍改写缓存日期。
3. **World 刷新尾延迟来自串行重型任务叠加。** 最近 30 轮平均 587.613 秒、P95 646.361 秒，19/30 失败或降级；单轮五个重型端点可连续消耗 120/90/90/30/60 秒。
4. **东盟“只有刚打开才快”是明显的冷/热缓存差异。** 修复前首次 `fresh=1` 超过 10 秒仍无响应，下一次约 8.128 秒，热缓存约 0.542 秒；页面请求直接承担多来源刷新，且超时后底层任务未取消。
5. **跨容器和 Next 路由模块不能依赖内存单例。** 最终使用共享缓存卷中的原子状态文件与带 hostname/PID/deadline 的锁，Web、refresh 容器和兼容路由复用同一任务，不再互相覆盖状态。

## H. 最终修改分类

### H1. WorldWeave 源码与独立部署仓库

- `8324edf`：真实 deadline/cancel、single-flight、原子写、进程组清理、worker watchdog、东盟异步刷新 API、缓存保护和页面非阻塞交互。
- `2247d5c`：独立 Compose 的优雅停止、健康检查、12 分钟/120 秒预算、回滚镜像及真实站点 smoke test。
- `e8a9898`：增加可配置绑定地址和缓存卷名，以便从 TopicLab 内嵌栈无损迁移。
- `8d295c8`：将迁移复用的缓存卷显式声明为 external，消除项目归属歧义。
- 上述提交均已推送到 `TashanGKD/worldweave` 的 `main`。

### H2. TopicLab 主仓库

- 最新 `public/main` 已在本次处理期间把 WorldWeave 改为独立部署，并会拒绝重新加入旧的内嵌 Compose 服务。因此没有把过时的内嵌 `docker-compose.yml`/deploy patch 合入主线。
- 主仓库只需更新子模块指针；分支 `codex/worldweave-asean-reliability` 已继续从 `worldweave@8d295c8` 更新到线上 `worldweave@96ffb63`，并在草稿 PR #67 中增加部署一致性预检。

### H3. 环境变量

- 独立 `worldweave/.env.example` 已记录所有非密钥默认值：12 分钟整轮 deadline、30 秒 readiness、45 秒 Compose 停机窗口、重型批次 1、watchdog 15 秒/2 次、目录抓取 3/40、东盟 120 秒总预算及各来源预算/并发。
- 新增迁移键：`WORLDWEAVE_BIND_HOST`、`WORLDWEAVE_HOST_PORT`、`WORLDWEAVE_CACHE_VOLUME_NAME`、`WORLDWEAVE_CACHE_VOLUME_EXTERNAL`。
- 本地忽略文件 `.env.deploy` 保留本次非密钥调优键；未提交或输出任何密钥值。
- 生产独立栈 `.env` 只从旧部署筛选 WorldWeave/API 相关键，并追加绑定、端口和缓存卷配置；文件权限为 600，验收输出只包含键名和键数量。

### H4. 仅远程服务器

- 备份目录：`/var/backups/topiclab-worldweave-20260809-reliability`；包含原 crontab、容器 inspect、镜像/Compose/override 记录及逐轮热修备份。
- 删除固定 restart cron；恢复命令仅在确需回退旧策略时使用：`crontab /var/backups/topiclab-worldweave-20260809-reliability/root.crontab`。
- 生产机已建立独立仓库 `/var/www/github-actions/repos/worldweave`，当前提交 `96ffb63`。
- 新容器为 `worldweave-worldweave-1` 与 `worldweave-worldweave-refresh-1`，共享原卷 `tashan-topiclab_worldweave-cache`；旧内嵌容器保持 stopped，未删除，可快速回滚。
- 回滚到旧容器：先在独立仓库执行 `docker compose down`，再依次 `docker start tashan-topiclab-worldweave-1`、`docker start tashan-topiclab-worldweave-refresh-1`。旧镜像和 inspect 备份均保留。

## I. 验收证据

- 本地最终：29/29 单测通过，TypeScript 通过，Next.js 生产构建通过，独立 Compose 配置验证通过。
- GitHub：`worldweave@8d295c8` 的 CI 与 Deploy 均成功；Deploy 内部 Web、refresh、source status、东盟缓存/状态检查通过，`world.tashan.chat/worldweave` 公网 smoke 通过。
- TopicLab 分支最终 head `4ff79fe`：WorldWeave checks、前端代理测试和总 CI 均成功。
- 迁移前缓存 API 连续 5 次 0.180–0.232 秒；迁移后冷启动窗口连续 5 次 0.407–0.485 秒，均低于 1 秒验收线。
- 迁移后东盟页面连续 3 次 0.486–0.696 秒；响应约 556 KiB。
- 最终 `/info/source`、东盟页面、东盟缓存 API 分别为 0.123、0.589、0.473 秒，HTTP 均为 200。
- 迁移后 3 次并发提交全部复用 `asean-20260809145610637-41a62d53`，两次返回 `reused=true`；任务 25.258 秒成功，80 条线索、217 项指标。刷新期间缓存读取 0.445–0.500 秒。
- 更早的最终连续三轮东盟刷新约 25.220、25.281、25.227 秒；另有取消、超时恢复和跨容器锁测试。
- 独立 refresh 在真实 World 任务运行 97.684 秒时被停止：状态 `canceled`、`error_code=CANCELED`、容器退出 0、`OOMKilled=false`；重新启动后健康。
- World 超时/恢复实测包含 191.743 秒、176.376 秒和 95.976 秒降级轮次；超时端点后 worker 均被回收并获得新 PID，最终健康探针为 6–7 毫秒。
- 迁移后的独立栈首轮完整 World 任务在 149.062 秒内以 `degraded/REFRESH_DEGRADED` 有界结束；随后 Web/refresh 均为 healthy，`RestartCount=0`、`OOMKilled=false`、`StopTimeout=45`。
- watchdog 故障注入中，连续两次探针失败后自动替换被 `SIGSTOP` 的 worker；Docker health failing streak 恢复为 0。
- Playwright 最终页面显示“数据更新 08/09 22:19”，点击立即显示“已排队”，任务 25.227 秒成功；控制台 0 错误、0 警告，研究 SSE 首字节 0.134 秒。

## J. 剩余非阻塞项

1. 增加 `latest_partial_refresh_at`，进一步区分部分来源成功与整轮数据日期。
2. 将约 556 KiB 的东盟初始页面继续拆分为按需指标/研究结果；当前缓存化后延迟已达标。
3. 增加独立的 HTTP 429、故意损坏缓存，以及“超时后静置 5 分钟比较全部缓存 mtime”自动化用例。
4. 跨过下一次原 04:00 cron 时点再做一次自然观察；当前 crontab 匹配数为 0，人工和故障注入均未再出现 refresh 退出码 137。

## K. 2026-08-10 东盟点击复发专项修复

### K1. 本轮复现出的独立根因

1. 顶部“东盟专题”原本使用 Next.js 客户端 RSC 导航；点击时会与仪表盘 `/api/v1/world/subworlds` 请求竞争。该请求对当前页面没有实际用途。
2. 仪表盘每 60 秒自动读取完整 `/api/v1/world/state`。生产状态文件约 213 MiB，点击恰好与该请求重叠时，东盟文档曾在 60.210 秒后返回 504。这解释了“刚打开快，放一会儿又慢”。
3. 东盟页面加载后立即请求 `/api/v1/world/asean/decision-model`；该 GET 曾在缓存过期时隐式启动刷新，造成页面虽然已返回，交互仍被后续重活拖住。
4. 东盟专题服务端渲染会重复解析五份缓存文件，且初始 HTML 约 556 KiB；在没有进程内快照缓存时，重复点击的延迟容易受磁盘和公网抖动放大。
5. 仪表盘时间格式依赖服务端时区，造成 React hydration #418；这不是主延迟来源，但会干扰浏览器端稳定性判断。

### K2. 已完成修改

- [x] `ASEAN-NAV-01` 顶部东盟入口改为硬文档导航，避免 RSC 路由与后台请求竞争。
- [x] `ASEAN-NAV-02` 删除未使用的 `/api/v1/world/subworlds` 页面请求。
- [x] `ASEAN-NAV-03` 移除仪表盘 60 秒 `/world/state` 自动刷新，以及初始后台、focus、online、AI 摘要和地图的隐式全状态读取；保留人工刷新和时间线标签页按需读取。
- [x] `ASEAN-NAV-04` 默认场景改为 `geo-politics-daily`，首屏 SSR 已包含所需地图数据。
- [x] `ASEAN-NAV-05` 时间格式统一按 UTC+8 确定性计算，消除 hydration #418。
- [x] `ASEAN-NAV-06` 决策模型 GET 默认只读缓存；只有显式刷新请求才允许更新数据。
- [x] `ASEAN-NAV-07` 为东盟原始专题数据增加基于五份缓存文件 `size + mtimeMs` 指纹的进程内快照缓存和 single-flight；文件原子更新后自动失效，刷新/force/signal 路径绕过缓存。
- [x] `ASEAN-NAV-08` 为客户端安全化后的专题数据增加 `WeakMap` 复用，避免同一请求重复转换大对象。
- [x] `ASEAN-NAV-09` 增加 Web 健康脚本；新镜像启动时完整预热一次 `/demo/asean`，之后健康检查只访问轻量 Skill 接口。

对应 WorldWeave 提交：

- `3caed62`：导航竞争、无用 subworlds 请求和时区 hydration 修复。
- `84e99b1`：移除 60 秒全状态刷新链路、默认场景调整和容器健康预热。
- `96ffb63`：东盟快照缓存、决策接口缓存只读及客户端转换复用。

以上提交均已推送到 `TashanGKD/worldweave` 的 `main`，生产独立仓库和容器当前均运行 `96ffb63`。

### K3. 本轮验证证据

- 本地最终：31/31 单测通过，TypeScript 通过，Next.js 生产构建通过，Compose 配置验证通过。
- GitHub `96ffb63` 的 CI（run `31323452146`）和 Deploy（run `31323452139`）均成功。
- 冷镜像第一次线上浏览器点击：文档 1.138 秒、决策接口 0.428 秒，HTTP 均为 200。
- 等待超过 60 秒后执行“东盟 → 整体态势 → 东盟”第二次往返：文档 0.173 秒、决策接口 0.066 秒。
- 两轮之间未再出现 `/api/v1/world/state` 或 `/api/v1/world/subworlds` 请求；未出现 504。
- 最终 Playwright 控制台：0 错误、0 警告。
- 服务器 localhost 连续 10 次东盟页面请求：总耗时 0.037–0.055 秒；随后公网连续测试稳定段为 0.250–0.285 秒。
- 新 Web 与 refresh 容器均为 `healthy`、`RestartCount=0`；部署后 7 分钟持续健康，未再出现服务自行终止。
- WorldWeave 本地与远程仓库均为 `96ffb63`，`main...origin/main` 无差异。

### K4. 本轮修改归类

1. **WorldWeave 源码**：导航、仪表盘刷新策略、东盟决策 GET、专题快照缓存、确定性时间格式和相关测试。
2. **WorldWeave Compose/部署**：新增专用 Web 健康/预热脚本并调整 `docker-compose.yml` 健康检查。
3. **仅远程服务器**：拉取 `96ffb63`、重建镜像并无损重建两个独立容器；未新增手工热补丁。
4. **TopicLab 主项目**：性能修复本身没有修改 TopicLab 运行源码；子模块锁与部署一致性配置见 K6。
5. **GitHub Actions/workflow**：WorldWeave 性能修复本身没有修改 workflow；随后在 K6 增加 TopicLab 部署版本预检。
6. **环境变量**：本轮没有修改 `.env.deploy` 或生产 `.env`，也未新增密钥。

### K5. 运行镜像与公网链路反向核验

- 两个运行容器的 Compose 标签均指向 `/var/www/github-actions/repos/worldweave/docker-compose.yml`，不是 TopicLab 父仓库中的旧子模块目录。
- 生产仓库、GitHub `worldweave/main` 和本地 WorldWeave 均为 `96ffb63acbf7e96d4cb2aa6efe90eaa846ba4879`。
- Web 与 refresh 容器共同运行镜像 `sha256:3d926d6801220f9b7e39d63ed45c7f840015514f6e9531ad75e101e34f36d191`；镜像创建于 00:20:55，晚于提交时间 00:18:31。
- 运行容器内 7 个本轮关键文件与生产仓库逐文件 SHA-256 完全一致，覆盖仪表盘、导航、东盟页面、决策路由、快照缓存和健康脚本。
- 容器内 Next Build ID 为 `sqKGpBdvTt_IXD4hL-E_Y`，构建时间 00:19:33；编译产物中包含新增 `cacheOnly` 路径，证明不是只复制新源码却继续运行旧构建产物。
- TopicLab 前端容器的实际 Nginx 配置将 `/worldweave/` 与 `/api/v1/world/` 代理至 `host.docker.internal:3020`；运行 Web 容器正绑定宿主机 `3020 -> 5000`。
- 新独立浏览器会话从公开 `/info/source` 点击东盟：页面 0.147 秒、决策接口 0.078 秒；等待超过 60 秒并往返后为 0.602 秒和 0.378 秒，均为 200。
- 两轮浏览器请求均无 `/api/v1/world/state`、无 `/api/v1/world/subworlds`、无控制台错误或警告。
- 公开决策 GET 前后五份生产缓存文件的大小与 mtime 完全一致，证明 GET 不再隐式触发数据刷新。
- 同一时刻容器内直连连续 5 次总耗时 0.034–0.095 秒，公网连续 5 次 0.295–0.392 秒；Web/refresh 均为 `healthy`、`RestartCount=0`。

### K6. TopicLab 与线上版本同步配置

- TopicLab 的 `worldweave` gitlink 已从 `8d295c8` 更新为线上实际运行的 `96ffb63`。
- `.gitmodules` 已经配置独立仓库 `https://github.com/TashanGKD/worldweave.git` 和 `branch = main`，无需修改。
- `.env.example`、`.env.deploy.example`、Compose 默认值及线上容器均已使用 `host.docker.internal:3020`，无需新增环境变量或改动密钥。
- TopicLab 部署新增同机版本预检：父仓库 gitlink 必须等于 `<DEPLOY_PATH>/worldweave` 的 HEAD，且独立仓库不得包含已跟踪的本地热补丁；不一致时停止部署。
- TopicLab 部署 smoke test 新增东盟页面和决策接口，避免只验证 WorldWeave 首页可达。
- 版本顺序固定为“先部署并验收独立 WorldWeave，再更新 TopicLab gitlink，最后部署 TopicLab”，避免父仓库与线上运行版本漂移。

## L. 2026-08-16 信源日期停滞与部署再对齐

### L1. 本轮根因

1. `/info/source` 的 TopicLab 前端入口与 `/worldweave/` 代理配置已经生效；页面显示旧日期的直接原因是 WorldWeave API 快照没有按预期更新，并非浏览器缓存或旧前端 bundle。
2. 生产服务器直连 `world-monitor.com` 会超时，宿主机代理可正常访问；refresh 容器此前没有使用该代理，导致真实信源刷新不稳定。
3. 旧调度把 5 个重端点按 `batch=1` 轮转，而每天只有 3 个刷新时点。地缘与 AI 各自可能约 40 小时才轮到一次，不能满足专题日期持续更新要求。
4. 旧重端点的 30/60 秒超时低于真实完整刷新耗时，任务容易在已经取得部分结果时被终止。
5. `generated_at` 原先在读取信号前赋值；当信号缓存的完成时间晚于该时间时，AI 状态会被误判为陈旧。

### L2. 已完成修改清单

- [x] `REFRESH-01` 每一轮固定刷新地缘和 AI；全局/技术信源知识同步等维护任务继续轮转，避免重任务互相挤占。
- [x] `REFRESH-02` 整轮 deadline 调整为 20 分钟，维护与专题重端点单项预算调整为 300 秒。
- [x] `REFRESH-03` 辅助快照采用 30 秒预算，并在重 worker 恢复后重试；LiveBench、东盟、全局与 AI 信源状态均要求成功写入快照。
- [x] `REFRESH-04` refresh 容器通过 `host.docker.internal:1081` 使用宿主机 HTTP(S) 代理，部署增加真实出口连通性检查及瞬时失败重试。
- [x] `REFRESH-05` 仪表盘 `generated_at` 改为信号加载完成后的时间，并增加回归测试。
- [x] `DEPLOY-01` 修正 WorldWeave GitHub Actions 的服务器目标与 SSH/`DEPLOY_ENV` Secrets；没有把密钥写入仓库。
- [x] `DEPLOY-02` 独立 WorldWeave 已先部署并验收 `02e8aded490b333b985c95c0f31085f1a86b13b7`。
- [x] `TOPICLAB-01` TopicLab 的 `worldweave` gitlink 从 `96ffb63` 更新为同一线上 SHA；既有部署预检继续强制 gitlink 与同机运行仓库一致。
- [x] `TOPICLAB-02` 修复 TopicLab 部署被既有 Zvec 集合不足阻断的问题：运行集合不健康时先停写入进程，从校验过的锁定压缩包原子重装，再离线验证文档数、向量维度和索引完整度后激活。

对应 WorldWeave 提交：

- `6910264`：固定刷新公共专题、代理出口配置与部署出口门禁。
- `d547256`：部署出口检查增加瞬时失败重试。
- `8eb54b0`：延长重任务预算并增强快照恢复。
- `02e8ade`：按仪表盘实际完成时间记录 `generated_at`。

### L3. 线上验收证据

- WorldWeave 最终 Deploy run `31931861455` 成功，生产仓库与两个运行容器均为 `02e8ade`。
- 最终自动刷新从 `2026-08-16T06:39:48.942Z` 运行至 `06:43:33.177Z`，耗时 224235 ms；`state=success`、`ok=true`、`exit=0`、`timed_out=false`。
- 本轮全局信源知识同步、地缘状态与 AI 状态分别耗时 109854、56523、46434 ms，均返回 200；5 个辅助快照均返回 200 且写入成功。
- 健康脚本显示信源 freshness 为 `fresh`、信号数 326、数据库与快照表正常；AI 与地缘均为 `staleState=false`、`staleVisibleSignals=false`。
- 公网连续 3 轮直连两个专题 API，6 次请求全部 200 且均无 `x-world-stale-snapshot`：地缘 `generated_at=2026-08-16T06:42:40.160Z`、95 条；AI `generated_at=2026-08-16T06:43:26.975Z`、9 条。
- `/worldweave/` 服务端 HTML 显示“最近更新 8月16日 14:42”；`/info/source` 返回 200 且为 `no-cache/no-store`。
- `worldweave-worldweave-1` 与 `worldweave-worldweave-refresh-1` 均为 `healthy`、`RestartCount=0`。
- 本地 WorldWeave 32/32 单测、TypeScript、生产构建、Compose 配置和本次变更文件 lint 均通过；全仓 lint 仍有与本次修改无关的既有 `ecosystem.config.js` CommonJS 规则错误。
- TopicLab 锁定的 Zvec 压缩包已在服务器临时隔离目录重新解压并真实打开：2386 条、4096 维、索引完整度 1.0；修复前运行集合只有 694 条。临时验证目录已自动清理。

### L4. 后续发布不变量

1. 先部署 WorldWeave，并以生产仓库 HEAD、容器镜像、自动刷新状态和公网 API 共同验收。
2. 再把 TopicLab `worldweave` gitlink 更新到该生产 SHA，并提交到 TopicLab `main`。
3. TopicLab Deploy 会在构建前比较 gitlink 与 `$DEPLOY_PATH/worldweave` 的 HEAD；不一致或独立仓库含已跟踪热补丁时直接失败。
4. TopicLab 部署完成后继续直连验证 `/info/source`、`/worldweave/`、东盟页面与决策 API，避免只以 GitHub Actions 绿色状态代替公网验收。
