# 账号管理子页面 + 注册阻断 + 移除 Google 登录（实施计划）

> 状态：执行中（生成于 2026-09-10）。
> 本文与实际代码改动同步维护：已完成的项目在下方清单中标注。

## 需求描述

1. 先用邮箱链接（Magic Link）登录的用户，下次用同邮箱+密码"注册"时应阻断并提示已有账号；该用户能在「账号管理」（新增模块）里补充密码，之后可直接用邮箱+密码登录；并能在账号管理里直接绑定 GitHub。
2. 先用 GitHub 注册的用户，下次用同邮箱"注册"时阻断；可直接使用邮箱链接登录；同样能在账号管理里补充登录密码。
3. 移除 Google 第三方登录，只保留 GitHub。

## 背景机制（决定方案的关键事实）

- Supabase 单邮箱单用户：邮箱密码、Magic Link、GitHub（同验证邮箱）最终归到同一个 auth 用户（Automatic Identity Linking 默认开启，GitHub 与邮箱链接返回的邮箱都是已验证的）。
- 已注册邮箱再次 `signUp`：Supabase 不报错，返回 `session: null` + `identities: []` 的防枚举混淆用户 → 需据此阻断并提示"该邮箱已注册"。
- 已登录用户可 `updateUser({ password })` 补设/修改密码，之后即可用邮箱+密码登录。
- 已登录用户可 `linkIdentity({ provider: 'github' })` 绑定 GitHub（需控制台开启 Manual Linking；未开启时 API 报错，降级引导：退出后用登录页 GitHub 按钮登录，同邮箱自动关联）。

## 改动清单（均在 apps/web）

1. 登录页 `app/(auth)/login/page.tsx`：注册阻断 + 移除 Google 按钮
2. 头部 `components/layout/header.tsx`：右上角账号下拉模块（账号管理 / 立即同步 / 退出登录）
3. 新增账号管理子页面 `app/(main)/account/page.tsx`（身份列表 / 设密码 / 绑 GitHub）
4. `components/common/features-dialog.tsx`：功能说明同步（去 Google、补账号管理说明）

## Supabase 控制台一次性操作（需人工在控制台完成）

- Authentication → Sign In / Providers → 开启 **Enable Manual Linking**（`linkIdentity` 需要；不开则走降级路径，自动关联仍可用）。
- Google Provider 可顺手 Disable（前端已无入口）。
- 核对 Redirect URLs 已包含线上域名（现有 OAuth 已依赖，确认即可）。

## 验证方案

1. `pnpm typecheck` + `pnpm lint` + `pnpm build`（apps/web）。
2. 浏览器实测（需 .env.local 已配置）：
   - 登录页只剩 GitHub 一个第三方按钮。
   - Magic Link 新账号 → 退出 → 同邮箱密码"注册" → 显示"该邮箱已注册"而非"注册成功"。
   - 登录后右上角账号模块 → 下拉含 账号管理 / 立即同步 / 退出登录。
   - 账号管理页显示邮箱与登录方式；设置密码 → 退出 → 邮箱+密码登录成功。
   - 绑定 GitHub → 授权回来 → 显示已绑定；退出后 GitHub 登录进同一账号（笔记数据一致）。
   - GitHub 先注册 → 同邮箱密码"注册"被阻断；Magic Link 登录成功；账号管理补设密码成功。
3. 未登录直接访问 `/account` → 自动跳回 `/login`。
4. 通过后提交推送，Cloudflare Pages 自动发布。

## 不在本次范围

- 解绑 GitHub（`unlinkIdentity`）、合并已分裂的历史账号、Google 绑定。
