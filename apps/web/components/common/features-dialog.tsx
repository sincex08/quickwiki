"use client";

import {
  AlertTriangle,
  BookOpen,
  Cloud,
  Download,
  FileText,
  Image as ImageIcon,
  MonitorSmartphone,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * 功能清单面板（帮助文档）。
 * 约定：新增/修改/移除用户可见功能时，必须在同一次改动里同步本文件；
 * 只写已实现的功能与真实位置，不写计划中的功能。
 * 最近更新：2026-09-11（强制登录 + 本地数据按账号分库隔离）
 */

interface FeatureGroup {
  icon: React.ReactNode;
  title: string;
  items: string[];
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    icon: <FileText className="h-4 w-4" />,
    title: "笔记管理",
    items: [
      "新建 / 编辑 / 删除（二次确认）/ 置顶（列表置顶优先）",
      "自动保存：编辑后 1 秒防抖落盘，切换笔记立即保存，头部显示保存状态",
      "标题：默认自动提取正文首行；可改为自定义标题，清空或点「自动」回退",
      "笔记本：8 色标识、重命名 / 删除（删除笔记本保留笔记）、按笔记本过滤",
      "标签：编辑器内添加 / 移除，小写规范化与计数，侧边栏点标签过滤",
      "列表：更新时间倒序 + 置顶优先、加载更多分页；手机左滑卡片置顶 / 删除",
      "深链 ?note=<id>：刷新或分享链接后恢复打开的笔记",
    ],
  },
  {
    icon: <BookOpen className="h-4 w-4" />,
    title: "Markdown 编辑（三模式）",
    items: [
      "所见即所得：工具栏含撤销/重做、加粗/斜体/删除线/行内代码、H1/H2、无序/有序/任务清单、引用、代码块、图片、链接、表格、清除格式",
      "Markdown 源码：等宽文本编辑全文源码，Tab 插入两空格",
      "混合预览：渲染视图点击任意块直接编辑该块源码（失焦或 Ctrl+Enter 提交、Esc 取消），文末可追加块；编辑栏「点击编辑」开关可切为纯只读",
      "粘贴 Markdown 文本自动转富文本；复制内容输出 Markdown",
      "快捷输入见下方速查表",
      "内容以 Markdown 原生存储，与 Obsidian / ShowDoc 等工具互通",
    ],
  },
  {
    icon: <ImageIcon className="h-4 w-4" />,
    title: "图片与富元素",
    items: [
      "图片：粘贴 / 拖拽 / 工具栏插入；自动压缩（≤1600px、webp、单张 ≤3MB，超限提示）后离线内嵌",
      "表格：工具栏插入 3×3、列宽拖拽；光标在表格内时「表格操作」菜单增删行/列、删除表格",
      "任务清单：可勾选、Tab 嵌套",
      "链接：对话框插入 / 编辑 / 移除，自动补全 https://，拦截 javascript: 等危险协议",
      "限制：不支持边打字边建表（粘贴 Markdown 表格文本可转换）；输入法整段提交含 * 时快捷键可能不触发（用工具栏或源码模式）",
    ],
  },
  {
    icon: <Search className="h-4 w-4" />,
    title: "全文搜索",
    items: [
      "中文二元组分词 + 英文前缀/模糊匹配，标题加权",
      "增量索引 + 持久化，刷新后秒级就绪",
      "结果摘要自动剥离 Markdown 标记与图片数据",
      "搜索时清除标签过滤；手机端自动退回列表展示结果",
    ],
  },
  {
    icon: <Download className="h-4 w-4" />,
    title: "数据导出",
    items: [
      "单篇导出 .md（含 YAML front matter：标题/时间/标签）",
      "全量导出 ZIP：每篇一个 .md，内嵌图片抽取为 images/ 目录并改写相对链接",
      "数据存储在浏览器 IndexedDB，请定期导出备份",
    ],
  },
  {
    icon: <Cloud className="h-4 w-4" />,
    title: "云同步（Supabase · 验证中）",
    items: [
      "登录后使用：未登录只能看到登录页；本地 IndexedDB 按账号分库隔离存储",
      "登录方式：邮箱密码 / Magic Link 免密链接（含 6 位验证码兜底）/ GitHub",
      "同一邮箱只对应一个账号：重复「注册」会提示已注册，改用登录即可",
      "账号管理（右上角头像菜单 → 账号管理）：查看登录方式、补设/修改密码、绑定 GitHub",
      "同步触发：保存后自动（5 秒防抖）/ 头部刷新按钮手动 / 恢复联网时",
      "离线优先：断网继续写本地，恢复后按队列补推；删除以墓碑同步",
      "冲突按最后写入胜出；图片自动上传云存储并改写引用",
      "免费版保活：仓库内置 GitHub Actions 每日打卡（配置 Secrets 即生效），防 7 天不活跃被暂停",
      "未配置时头部不显示同步入口；配置见仓库 supabase/schema.sql 与 apps/web/.env.example",
    ],
  },
  {
    icon: <MonitorSmartphone className="h-4 w-4" />,
    title: "系统能力",
    items: [
      "PWA：可安装到桌面/主屏，离线可用",
      "响应式：桌面三栏 / 平板双栏 / 手机单栏（底部导航 + 抽屉侧边栏）",
      "深色模式：深蓝灰 slate 色板，跟随系统或手动切换",
      "所有图标按钮/开关均有悬停描述，不靠图标猜功能",
      "触屏优化：手机/平板菜单常显、触摸目标加大（≥36px）",
    ],
  },
];

const SHORTCUTS: Array<[string, string]> = [
  ["# + 空格", "一级标题"],
  ["## + 空格", "二级标题"],
  ["### + 空格", "三级标题"],
  ["- + 空格", "无序列表"],
  ["1. + 空格", "有序列表"],
  ["- [ ] + 空格", "任务清单"],
  ["> + 空格", "引用"],
  ["``` + 回车", "代码块"],
  ["--- + 回车", "分隔线"],
  ["**文字**", "加粗"],
  ["`文字`", "行内代码"],
  ["[文字](链接)", "超链接"],
  ["![描述](地址)", "图片（推荐直接粘贴）"],
  ["Tab", "任务清单嵌套（任务项内）"],
  ["Ctrl/Cmd+Enter", "提交块源码编辑（混合预览）"],
  ["Esc", "取消块源码编辑"],
];

export interface FeaturesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 功能清单面板：右上角「功能说明」按钮打开 */
export function FeaturesDialog({ open, onOpenChange }: FeaturesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>QuickWiki 功能清单</DialogTitle>
          <p className="text-xs text-muted-foreground">
            本地优先的 Markdown 笔记 · 数据存储在浏览器，可完整导出 · 更新于 2026-09-11
          </p>
        </DialogHeader>

        {/* 待办置顶：启用云同步的步骤（配置后自动消失） */}
        {!isSupabaseConfigured ? (
          <section className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              待办：启用云同步还差 4 步
            </h3>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed">
              <li>
                在 Supabase 控制台创建项目（区域选
                <strong className="mx-0.5">新加坡</strong>）
              </li>
              <li>
                在其 SQL Editor 中执行仓库根目录的
                <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  supabase/schema.sql
                </code>
                （建表 + 权限 + 图片存储桶）
              </li>
              <li>
                把 Project URL 与 anon 公钥填入
                <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  apps/web/.env.local
                </code>
                （模板见 .env.example），重启 dev 或重新构建
              </li>
              <li>
                在 Auth → Providers 中确认登录方式：Email 默认已开（Magic
                Link / 验证码走它）；要用 GitHub 登录需启用并填入
                Client ID / Secret；Redirect URLs 需包含你的访问地址（如
                <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  http://localhost:3000/login
                </code>
                ）；如需在「账号管理」内直接绑定 GitHub，还需在 Auth →
                Sign In / Providers 开启 Manual Linking
              </li>
            </ol>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              完成后页面顶部会出现「登录同步」入口，登录即可开始多设备同步。
              可选加固：在 GitHub 仓库 Settings → Secrets 配置 SUPABASE_URL 与
              SUPABASE_ANON_KEY，仓库自带的每日保活工作流会自动打卡，防止免费项目
              7 天不活跃被暂停。
            </p>
          </section>
        ) : (
          <p className="rounded-lg border border-green-600/30 bg-green-600/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">
            云同步已配置：在页面顶部点「登录同步」登录后即生效。
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURE_GROUPS.map((group) => (
            <section
              key={group.title}
              className="rounded-lg border bg-card p-3"
            >
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                <span className="text-primary">{group.icon}</span>
                {group.title}
              </h3>
              <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold">Markdown 快捷输入速查</h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {SHORTCUTS.map(([syntax, desc]) => (
              <div key={syntax} className="flex items-baseline justify-between gap-2 text-xs">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {syntax}
                </code>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="text-center text-[11px] text-muted-foreground">
          规划中：云端 Realtime 实时推送 · 桌面客户端（Tauri）· 移动端 App —— 详见仓库 ROADMAP.md
        </p>
      </DialogContent>
    </Dialog>
  );
}
