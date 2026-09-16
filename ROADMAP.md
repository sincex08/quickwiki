# QuickWiki 路线图

## 当前状态（Phase 1：本地优先）✅

- **形态**：纯静态 Web 应用（Next.js 14 `output: 'export'`），可部署到任意静态托管/CDN
- **数据**：浏览器 IndexedDB（Dexie），内容以 **Markdown 原生存储**
- **能力**：三模式 Markdown 编辑（所见即所得/源码/预览）、每笔记附件库（图片唯一来源 + 抽屉管理）、表格/任务清单/链接、中文全文搜索（增量索引+持久化）、笔记本（可嵌套分组，「文件夹」= 容器笔记本）/标签/置顶、侧栏树状导航（笔记本→笔记，桌面双栏布局）、MD 与 ZIP 导出、PWA 离线、深色模式、响应式
- **架构保障**：所有数据访问经由 `NoteRepository` / `NotebookRepository` 抽象层（`apps/web/lib/data/repository.ts`），UI 不直接依赖 Dexie —— 这是后续上云的切换点

## Phase 2：云端同步（多设备）—— Supabase 已上线 ✅

> 路线（2026-09-08 定）：前端直连 Supabase（新加坡区域），不建 BFF；
> 自建 Express + PostgreSQL 方案保留为后续备选（需要服务端业务逻辑时再启用）。

### 已实现

| 模块 | 实现 | 位置 |
|------|------|------|
| 表结构 + RLS + 存储桶 | `profiles` / `notebooks` / `notes` / `attachments`（uuid 主键复用本地 ID、`tags text[]`、`deleted_at` 墓碑、`updated_at` 客户端写入、`server_updated_at`/`version` 服务端触发器维护）+ 行级安全 + `note-images` 桶 | `supabase/schema.sql` |
| 存量库迁移 | 2026-09-11 同步加固：服务端权威时间戳 + 乐观锁版本号 + Realtime publication；2026-09-12 附件表；2026-09-15 笔记本嵌套（`notebooks.parent_id`） | `supabase/migrations/2026-09-11-sync-hardening.sql`、`supabase/migrations/2026-09-12-attachments.sql`、`supabase/migrations/2026-09-15-notebook-nesting.sql` |
| 客户端初始化 | 未配置环境变量时返回 null；但登录门禁（`RequireAuth`）会停在 /login 的「云同步未配置」提示，即**本地跑通功能必须自备 `.env.local`** | `apps/web/lib/supabase/client.ts` |
| 同步引擎 | outbox 推送（乐观锁条件更新 `.eq version`，冲突按「本地编辑时间 vs 服务端 `server_updated_at`」LWW 裁决）/ 增量拉取（`server_updated_at > cursor` 服务端时钟游标 + 分页循环，与设备时钟无关）/ 墓碑删除带时间裁决（本地更新的编辑可复活）/ 删除走乐观锁 / 队列单条失败不阻塞 | `apps/web/lib/sync/sync-engine.ts` |
| Realtime | 订阅 notes/notebooks/attachments 变更，远端写入 1.5s 防抖自动拉取，多设备秒级收敛 | 同上 |
| 附件二进制 | 元数据走 `attachments` 表（乐观锁/墓碑，冲突一律远端胜出）；blob 上传 `note-images/<uid>/<noteId>/<attId>.<ext>`（内容不可变、upsert 幂等、永不冲突），第二台设备按需懒下载回填本地 | 同上 |
| 认证与账号 | 强制登录（登录门禁 `require-auth`，未登录仅见登录页）；**仅邮箱登录**（不做第三方 OAuth）：注册不设密码（邮箱链接即建号，首次点开链接完成注册+登录），密码在账号管理里设置，之后邮箱 + 密码登录；账号中心页（密码是否已设，可设置/修改） | `app/(auth)/login/page.tsx`、`app/(main)/account/page.tsx` |
| 数据隔离 | 本地 IndexedDB 按登录用户分库（`QuickWikiDB:<uid>`），多账号互不可见 | `lib/db/index.ts` |
| 状态 UI | 头部同步芯片：同步中转圈 / 已同步时间 / 失败重试 / 退出登录 | `components/layout/header.tsx` |
| 本地元数据 | DB v4：`outbox` 出站队列；`attachments` 附件表（元数据 + blob 内联）；`meta` 存拉取水位（正文与附件各自独立游标） | `apps/web/lib/db/index.ts` |
| 附件库（图片唯一来源） | 每笔记附件抽屉（上传/网格/预览/插入/重命名/删除/清理未引用，PC 右侧/手机底部响应式）；正文以 `quickwiki-att://` 协议引用，本地与云端同内容零改写；blob 直存 IndexedDB，云端 `attachments` 表 + `note-images` 桶镜像；压缩按次开关（默认压缩，原图 ≤10MB）；删笔记级联删附件；旧 data URL 双副本改写管线已移除 | `lib/attachments/`、`components/attachments/`、`lib/data/attachment-repository.ts` |

### 启用步骤

1. Supabase 控制台创建项目（区域选新加坡）
2. SQL Editor 执行 `supabase/schema.sql`（全新安装）；已有旧版数据库的存量库按顺序执行 `supabase/migrations/2026-09-11-sync-hardening.sql`、`supabase/migrations/2026-09-12-attachments.sql` 与 `supabase/migrations/2026-09-15-notebook-nesting.sql`
3. 复制 Project URL 与 anon 公钥到 `apps/web/.env.local`（模板 `.env.example`）
4. 重启 dev / 重新构建（静态导出下 `NEXT_PUBLIC_*` 构建时内联）
5. 部署后打开应用即进入登录页，注册/登录 → 自动首同步（新版客户端首次启动会全量重拉一次，属游标切换的预期行为）

### 已知限制

- 冲突仍为 LWW 覆盖，无三路合并/提示（固有语义；多端最终一致）
- 真正写冲突时的裁决含跨时钟启发式比较（本地编辑时间 vs 服务端时间），常规路径已不依赖设备时钟
- 附件 blob 为不可变内容，无同步冲突；第二台设备元数据先行、blob 按需懒下载回填本地，离线可看

### 会话保持（2026-09-13 加固）

移动端「第二天打开要重新登录」的两类成因与对策：

1. **客户端侧（已在代码中修复）**
   - `lib/supabase/client.ts` 显式配置 auth：`persistSession` / `autoRefreshToken` /
     `detectSessionInUrl`、`flowType: "pkce"`（比 implicit 更能抵御移动端 URL fragment 丢失）、
     固定 `storageKey: "quickwiki-auth"` 防止不同预览域名互相覆盖。
     注意**不要**传自定义 `lock`：客户端库已内置单飞刷新，自定义 lock 会退化到旧兼容路径。
   - 新增 `ensureFreshSession()`：启动时与页面重新可见（`visibilitychange`）时，
     若 access token 已过期（留 60s 余量）则主动 `refreshSession()`，续期成功再同步。
   - Service Worker（`public/sw.js`，v2）**不再缓存** `/login`、`/account` 以及带
     `code` / `error` 参数的导航：否则邮箱登录链接的回跳会被缓存页吞掉，
     导致会话无法建立。
2. **服务端侧（需在 Supabase 控制台确认，代码无法覆盖）**
   - Auth → Sessions：**JWT 有效期**默认 3600s（1 小时）。有 `autoRefreshToken` +
     `ensureFreshSession` 时保持默认即可；不建议低于 5 分钟。
   - **不要开启** Time-box / Inactivity timeout / Single session per user：
     这三项（Pro 计划起）会强制缩短会话寿命，是「隔天掉登录」最常见的配置原因。
   - 若开启过上述任一项，会话的实际寿命 = 配置超时 + JWT 有效期，改回后需等下一次
     刷新才生效。

### 免费版防暂停保活（已内置）

- Supabase 免费项目 **7 天无 API 请求会自动暂停**；打开应用即产生活动（同步），
  长期不开应用则由仓库内置的 `.github/workflows/keepalive.yml`
  每日（UTC 3:00 = 新加坡 11:00）匿名 ping 一次 REST 接口，重置暂停计时
- 启用：仓库 Settings → Secrets and variables → Actions 添加 `SUPABASE_URL` 与
  `SUPABASE_ANON_KEY` 两个 Secret 即自动生效（匿名请求受 RLS 保护，仅返回空集）
- 注意：GitHub 会对 60 天无动态的仓库自动停用定时工作流，届时到 Actions 页面手动
  Run workflow 一次即可；若项目已被暂停，在 Supabase 控制台点 Restore 恢复

### 备选：自建服务端（后续）

若需要服务端业务逻辑（分享链接、协作、全文检索服务等），启用 `apps/server`
（Express + Prisma + PostgreSQL），同步引擎改为对接自建 API；
Repository 抽象与本地 outbox 机制可复用。

## Phase 3：桌面客户端（Tauri）

- 复用 90% Web 组件（`packages/desktop` 直接引用）
- 数据层切换为第三个 `NoteRepository` 实现：Tauri invoke → Rust → SQLite
- 增量能力：系统托盘、全局快捷键、本地目录直接读写、原生文件对话框
- 与云端账号打通：桌面端同样走 API Repository

## Phase 4：移动端 App

- 首选 Capacitor 打包现有 Web 应用（零重写，PWA 能力直接继承）
- 数据层可切换 Capacitor SQLite 实现，或直接使用云端 API
- 若体验要求提高，再评估 React Native 重写（届时 shared 包的类型与协议定义可直接复用）

## 决策记录

- **为什么深链同步（`?note=<id>`）不用 next/navigation**：`router.replace` 是一次真实的路由导航
  （重新取 RSC payload + 页面级 Suspense 回退到空白），打开/新建笔记时会「整页闪一下」；
  改成 `history.replaceState` 直接读写地址栏：刷新、分享链接、恢复选中语义不变，零重渲染。
  不要「顺手」改回 router，否则闪烁复现。
- **侧栏笔记本角标口径 = 直属笔记数**（与该笔记本下展开的条目、选中后的列表条数三者一致）。
  角标直接由侧栏树已加载的索引（`listIndex` 结果）派生，不再单独查计数：既不会与列表分叉，
  标签过滤时也随之收窄，新增/删除/移动同帧更新。
- **为什么注册不提供密码**：密码注册要先过「确认邮件」再回来登录两道坎，失败时（Supabase 防枚举）
  界面拿不到「这个邮箱已注册」之外的信息。改成**邮箱链接即建号**：注册与登录是同一条通道，
  少一条会卡住的分支；密码留到登录后在账号管理里设置（`updateUser({ password })`），
  之后邮箱 + 密码登录照常可用。
- **「是否设置过密码」只能本机近似判断**：Supabase 的 `user.identities` 只给 provider，
  密码与邮箱链接同属 `email` 身份，服务端不暴露「有没有密码」。因此账号管理用
  「本机记录（localStorage `quickwiki.pwd-set.<uid>`）+ 本次会话 amr 是否为 password」推断；
  判断失准时只影响文案（设置/修改动作是同一个 `updateUser`），不会误操作。
  要精确状态需服务端加字段（如 `profiles.has_password`）或走 Edge Function。
- **不做第三方（OAuth）登录**：项目曾接入 GitHub（登录入口 + 账号管理里的绑定/解绑），
  但服务端未开启时它只会带来「点了才出现的英文报错」，且多一条要维护的身份链路。
  现已整体移除：登录页入口、账号管理的绑定区块、`signInWithOAuth` / `linkIdentity` /
  `unlinkIdentity`、`/auth/v1/settings` 探测与 `use-auth-providers` hook。
  登录方式收敛为**邮箱一条链路**：邮箱链接（免密，注册与登录同通道）+ 邮箱 + 密码（登录后设置）。
  将来若要恢复，需先在 Supabase 控制台打开对应 Provider。
- **注册链接的投递前提**（Supabase 控制台）：内置 SMTP 只能给项目成员邮箱发信；
  要让任意新用户收到注册/登录链接，需在 Authentication → SMTP 配置自有发信服务。
- **为什么 Markdown 原生存储**：服务端可直接存文本；同步冲突可做文本 diff/三方合并；与 Obsidian、ShowDoc、GitHub 等生态互通；导出零转换
- **为什么保留 Next.js 而非换 Vite**：静态导出已满足产物隔离要求；App Router 的文件路由与 shadcn/ui 生态成熟；上云后若需 SSR/BFF 能力可平滑启用
- **为什么不兼容旧 HTML 数据**：应用未上线，历史数据仅为开发测试数据，DB v2 升级时一次性清空，换取更简单的纯 Markdown 代码路径
- **为什么正文以 `quickwiki-att://` 引用附件、而不是把图片转成公开 URL 写回正文**：两端存同一份协议串，push/pull 零改写，本地与服务端内容完全一致；旧方案（本地 base64 + 服务端副本改写 URL + `sync.imgmap` 映射）是双副本补丁，复杂度高且第二台设备离线不可看。代价是 markdown 离开本应用不能直接渲染，由导出负责落地为文件。存量数据不迁移（应用未上线，历史数据均为测试数据），旧管线代码已整体删除（`uploadEmbeddedImages` / `sync.imgmap` / djb2 `hashString` 命名），渲染层对 `data:` / 外链仍原样透传以兜住残留数据

## 公网部署（Vercel · 验证路线）

1. GitHub 建空仓库 → 推送本仓库（首次 commit 后）
2. Vercel「Import Project」选该仓库：Root Directory 填 `apps/web`，框架自动识别，构建命令默认 `next build`
3. Vercel 项目 Settings → Environment Variables 添加（构建时内联，必须）：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Supabase 控制台 Auth → URL Configuration：Site URL 改为 Vercel 分配的公网地址，Redirect URLs 追加该地址（邮箱登录链接回跳需要）
5. 访问 Vercel 域名验证登录与同步

注意：anon 公钥本就是公开值（数据安全靠 RLS），仅 service role key 不可外泄；
`*.vercel.app` 在大陆访问不稳定，正式使用建议绑定自定义域名（Vercel 内配置 + DNS CNAME）。
