# OpenClaw Monitor Plugin

这个目录是一个独立的静态监视插件，不依赖额外后端专用路由。

适合的接入目标：

- 作为 `TopicLab` 里的一个独立监视页
- 不重构现有前端页面
- 不新增后端聚合 service
- 只复用现有 `admin` 数据接口

## 访问方式

- 线上或本地站点运行后，直接打开 `/plugins/openclaw-monitor/index.html`
- 预览演示数据可用 `/plugins/openclaw-monitor/index.html?demo=1&stage=8`

如果只是本地看效果，也可以在 `frontend/public` 下起一个静态服务后直接访问这个路径。

## 实时数据来源

插件直接读取现成后台接口：

- `/api/admin/openclaw/agents`
- `/api/admin/openclaw/events`

需要浏览器里已有 `admin_panel_token`，也就是先登录后台。

这意味着：

- 不需要给这个插件单独加后端路由
- 不需要额外改数据库
- 不需要额外的构建流程

## 如何接入主项目

默认情况下，这个插件目录放进仓库后就已经能工作。

开发者只需要确认两件事：

1. 这个目录被保留在 `frontend/public/plugins/openclaw-monitor`
2. 部署后的站点能正常访问 `/plugins/openclaw-monitor/index.html`

也就是说，最小接入方式其实就是：

- 合并这个目录
- 部署前端
- 从已有后台登录态打开插件页

## 如果想给用户一个入口

这个插件当前故意没有强行改主站别的页面。

如果项目维护者希望把它挂进产品里，建议只做一种很轻的接入：

- 在后台页或内部工具页放一个普通链接，指向 `/plugins/openclaw-monitor/index.html`

不建议：

- 为了这个插件去改主站路由结构
- 为了这个插件增加专门的后端聚合接口
- 把插件逻辑拆回 React 主工程里

## 开发者验证步骤

1. 启动项目现有前后端
2. 登录后台，确保浏览器里已有 `admin_panel_token`
3. 打开 `/plugins/openclaw-monitor/index.html`
4. 确认能看到实时成员和时间线

如果只是验视觉，不想依赖后台登录：

1. 打开 `/plugins/openclaw-monitor/index.html?demo=1&stage=8`
2. 这会使用插件内置演示数据

## 这次 PR 的边界

这个插件的目标是“新增一个独立文件夹”。

按当前整理后的状态：

- 主要改动都在这个目录里
- 插件运行时只消费现有 admin 接口
- 没有要求主项目必须额外新增后端能力
- 没有要求主项目必须新增导航或路由

所以开发者审 PR 时，可以把它理解成：

- 一个独立的静态监视插件
- 一套裁剪后的场景与角色素材
- 一页直接可打开的内部可视化

## 常见问题

### 1. 为什么打开后没有数据？

因为实时模式依赖后台登录态。先登录后台，让浏览器里有 `admin_panel_token`，再打开这个页面。

### 2. 为什么 demo 模式和 live 模式看起来人数可能不同？

`demo=1` 走的是插件内置演示数据，主要用于看布局、动效和像素风格；live 模式才会读取真实 OpenClaw 活跃成员。

### 3. 角色为什么是随机的？

插件会从裁剪后的 Stanford 角色池里给当前舞台成员分配不重复角色，避免同屏撞脸，同时保留一定随机感。

## 目录约定

- `index.html` 页面壳
- `monitor.js` 取数、聚合、交互与 Phaser 场景逻辑
- `layout.js` 场景资产和区域布局
- `monitor.css` HUD 与面板样式
- `assets/` 裁剪后的实际素材
- `vendor/` 第三方运行时

这样整理后，和监视插件相关的内容都只在这个新增目录里。
