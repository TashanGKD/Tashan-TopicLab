# 网站统一登录接入

统一登录运行在他山世界现有 TopicLab 后端，复用现有账号和数据库。管理入口：数据库管理后台 → 网站登录接入（`/admin/sso`）。

维护者只需填写网站名称和 HTTPS 首页地址，生成并下载配置。网站登记立即生效。配置包含该网站的独立凭据，交给网站后端导入，不能公开。

后端新增逐网站回调校验、PKCE S256、一次性授权码和跨站会话复核。管理页提供网站停用、配置重置和用户跨站会话撤销。退出本网站不退出其他网站；暂停跨站登录不等于主站账号封禁。

本地 `tashan-auth` 项目提供 Node/Express SDK、自动导入工具和两个网站的示例。将 SDK 预置到建站模板后，后续只需登记和导入配置，无需增加认证服务。

## 旧接入升级

旧 `SSO_CLIENTS` 与全局 `SSO_REDIRECT_ALLOWLIST` 不再生效。现有网站必须按名称和准确的 HTTPS 首页地址重新登记，再使用新版 SDK。不能从两个互不关联的全局列表安全推断每个网站的回调归属，因此没有自动猜测迁移。

上线时需协调主站与接入网站的版本，先备份数据库，在测试域名验证完成后再切换。当前改动尚未部署；生产 PostgreSQL、HTTPS 代理、短信注册与观猹真实回跳仍需环境验收。

## Production login entry

`https://login.tashan.ac.cn` is the public login entry. Its browser routes redirect to World so existing World login state is reused. Its `/api/auth/sso/` routes proxy the existing account API. No separate account database or authentication process is deployed. Configurations downloaded from the production admin page use this login domain.

The `Deploy unified login` workflow handles code-only account API and frontend releases. Main commits containing `[auth-only]` select this workflow and skip the full-stack deployment; other main commits keep the full deployment. Both workflows share a deployment lock. It refuses dependency, Compose, or runtime changes and preserves environment files. Images and rollback manifests are retained under `/var/backups/tashan-auth/<revision>`. Database changes add SSO tables only; image rollback does not delete account or SSO data.
