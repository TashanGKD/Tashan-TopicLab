# WorldWeave 超时与东盟专题可靠性修复清单

状态：主要修复已完成，保留 4 项非阻塞观察/瘦身工作
建立日期：2026-08-09
生产站点：`https://world.tashan.chat`
生产项目：`/var/www/github-actions/repos/Tashan-TopicLab`

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
- 主仓库只需更新子模块指针；已在分支 `codex/worldweave-asean-reliability` 提交 `dfa7165`，指向 `worldweave@8d295c8`，分支 CI 成功。未直接合并到 `main`，避免仅为指针更新触发 TopicLab 全栈停机部署。

### H3. 环境变量

- 独立 `worldweave/.env.example` 已记录所有非密钥默认值：12 分钟整轮 deadline、30 秒 readiness、45 秒 Compose 停机窗口、重型批次 1、watchdog 15 秒/2 次、目录抓取 3/40、东盟 120 秒总预算及各来源预算/并发。
- 新增迁移键：`WORLDWEAVE_BIND_HOST`、`WORLDWEAVE_HOST_PORT`、`WORLDWEAVE_CACHE_VOLUME_NAME`、`WORLDWEAVE_CACHE_VOLUME_EXTERNAL`。
- 本地忽略文件 `.env.deploy` 保留本次非密钥调优键；未提交或输出任何密钥值。
- 生产独立栈 `.env` 只从旧部署筛选 WorldWeave/API 相关键，并追加绑定、端口和缓存卷配置；文件权限为 600，验收输出只包含键名和键数量。

### H4. 仅远程服务器

- 备份目录：`/var/backups/topiclab-worldweave-20260809-reliability`；包含原 crontab、容器 inspect、镜像/Compose/override 记录及逐轮热修备份。
- 删除固定 restart cron；恢复命令仅在确需回退旧策略时使用：`crontab /var/backups/topiclab-worldweave-20260809-reliability/root.crontab`。
- 生产机已建立独立仓库 `/var/www/github-actions/repos/worldweave`，当前提交 `8d295c8`。
- 新容器为 `worldweave-worldweave-1` 与 `worldweave-worldweave-refresh-1`，共享原卷 `tashan-topiclab_worldweave-cache`；旧内嵌容器保持 stopped，未删除，可快速回滚。
- 回滚到旧容器：先在独立仓库执行 `docker compose down`，再依次 `docker start tashan-topiclab-worldweave-1`、`docker start tashan-topiclab-worldweave-refresh-1`。旧镜像和 inspect 备份均保留。

## I. 验收证据

- 本地最终：29/29 单测通过，TypeScript 通过，Next.js 生产构建通过，独立 Compose 配置验证通过。
- GitHub：`worldweave@8d295c8` 的 CI 与 Deploy 均成功；Deploy 内部 Web、refresh、source status、东盟缓存/状态检查通过，`world.tashan.chat/worldweave` 公网 smoke 通过。
- TopicLab 分支：`dfa7165` CI 成功。
- 迁移前缓存 API 连续 5 次 0.180–0.232 秒；迁移后冷启动窗口连续 5 次 0.407–0.485 秒，均低于 1 秒验收线。
- 迁移后东盟页面连续 3 次 0.486–0.696 秒；响应约 556 KiB。
- 迁移后 3 次并发提交全部复用 `asean-20260809145610637-41a62d53`，两次返回 `reused=true`；任务 25.258 秒成功，80 条线索、217 项指标。刷新期间缓存读取 0.445–0.500 秒。
- 更早的最终连续三轮东盟刷新约 25.220、25.281、25.227 秒；另有取消、超时恢复和跨容器锁测试。
- 独立 refresh 在真实 World 任务运行 97.684 秒时被停止：状态 `canceled`、`error_code=CANCELED`、容器退出 0、`OOMKilled=false`；重新启动后健康。
- World 超时/恢复实测包含 191.743 秒、176.376 秒和 95.976 秒降级轮次；超时端点后 worker 均被回收并获得新 PID，最终健康探针为 6–7 毫秒。
- watchdog 故障注入中，连续两次探针失败后自动替换被 `SIGSTOP` 的 worker；Docker health failing streak 恢复为 0。
- Playwright 最终页面显示“数据更新 08/09 22:19”，点击立即显示“已排队”，任务 25.227 秒成功；控制台 0 错误、0 警告，研究 SSE 首字节 0.134 秒。

## J. 剩余非阻塞项

1. 增加 `latest_partial_refresh_at`，进一步区分部分来源成功与整轮数据日期。
2. 将约 556 KiB 的东盟初始页面继续拆分为按需指标/研究结果；当前缓存化后延迟已达标。
3. 增加独立的 HTTP 429、故意损坏缓存，以及“超时后静置 5 分钟比较全部缓存 mtime”自动化用例。
4. 跨过下一次原 04:00 cron 时点再做一次自然观察；当前 crontab 匹配数为 0，人工和故障注入均未再出现 refresh 退出码 137。
