"use client";

import {
  BookOpen,
  Cloud,
  Download,
  FileText,
  Images,
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

/**
 * 功能清单面板（帮助文档）。
 * 约定：新增/修改/移除用户可见功能时，必须在同一次改动里同步本文件；
 * 只写已实现的功能与真实位置，不写计划中的功能。
 * 注意：本面板渲染于公网页面，JS 字符串可被任何访客从构建产物中读到，
 * 严禁写入部署指引、后端配置细节、运维机制（保活/Secrets/区域等）内部信息，
 * 此类内容请写在仓库 ROADMAP.md。
 * 最近更新：2026-09-17（搜索改为顶部悬浮结果面板：不再替换左栏树，结果含笔记本归属、关键字高亮与上下文摘要；
 * 支持 ↑↓ / Enter / Esc，点击结果打开笔记并切换到它所在的笔记本）
 * 上一版 2026-09-16：移除「全部笔记」视图与笔记本管理页；未选中笔记本时显示默认页，再点已选中项即取消选中；
 * 顶部「新建笔记」默认落在当前打开笔记所属的笔记本；笔记本 ⋯ 菜单新增「新建子笔记本」；
 * 笔记支持手动调整展示顺序：桌面拖动 / 手机长按拖动 / 拖到笔记本改分类 / 菜单上移下移 / 恢复默认顺序；
 * 移除 GitHub 登录与绑定，登录方式收敛为邮箱一条链路；
 * 注册改为无密码（邮箱链接即建号，密码在账号管理里设）；
 * 账号管理显示密码状态并可设置 / 修改；打开/新建笔记不再整页闪烁：地址栏同步改为不触发路由导航；
 * 编辑区正文与标题统一左右留白；侧栏角标与树同源，新增笔记即时更新；
 * 2026-09-15：侧边栏改为「笔记本 → 笔记」树状导航，桌面端列表栏并入侧栏；
 * 笔记本支持嵌套分组（文件夹）；笔记本角标与列表口径统一；标签计数随云同步维护）
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
      "笔记本可嵌套分组：编辑笔记本时选择「父级」，文件夹式层级不限；删除笔记本时子笔记本自动上移",
      "笔记本行的 ⋯ 菜单：新建笔记 / 新建子笔记本 / 重命名·移动 / 删除",
      "侧边栏树状导航（笔记本 → 笔记）：点笔记直接打开，点笔记本展开并过滤；桌面端列表已并入侧栏，编辑区更宽",
      "调整笔记顺序：按住拖动即可（桌面直接拖侧栏或列表里的笔记；手机长按约 0.4 秒进入拖动，有轻振动提示），拖到笔记本行上＝移入该笔记本",
      "也可以不用拖动：笔记菜单里的「上移 / 下移」逐条微调，「恢复默认顺序」还原为按更新时间排列",
      "顺序按笔记本各自独立：只在调整过的笔记本内生效，其余仍按更新时间排列",
      "笔记本行尾数字＝该笔记本直属的笔记数，与该笔记本下展开的条目一致，新增 / 删除 / 移动即时更新",
      "侧边栏「未分类」：只看不属于任何笔记本的笔记；选中某笔记本只显示该笔记本下的笔记",
      "未选中笔记本时显示默认页：侧栏点一下进入某个笔记本，再点一次取消选中回到默认页；打开应用会回到上次查看的位置",
      "顶部「新建笔记」默认建在当前打开笔记所属的笔记本（新建后在编辑区头部的「移动到笔记本」可随时改）",
      "标签：编辑器内添加 / 移除，小写规范化与计数，侧边栏点标签过滤（计数随云同步自动修正）",
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
    icon: <Images className="h-4 w-4" />,
    title: "附件库（图片管理）",
    items: [
      "每篇笔记一个附件库，是全应用插图的唯一来源；编辑器头部「附件」按钮打开抽屉（PC 右侧 / 手机底部）",
      "上传入口统一：抽屉按钮 / 拖拽文件进抽屉 / 粘贴 / 拖拽进正文 / 工具栏插入，都是「先入库、再插入引用」",
      "网格显示缩略图、文件名、大小与时间；角标标注「原」（未压缩）与「未引用」",
      "每张可预览大图、插入正文（编辑模式插在光标处，预览与源码模式追加到文末）、下载、重命名、删除",
      "过滤：全部 / 已引用 / 未引用；溢出菜单提供「全部下载」与「清理未引用」",
      "压缩开关按次生效并被记住：默认压缩（单张 ≤3MB），关闭则保留原图（单张 ≤10MB）",
      "删除已被正文引用的附件时会提示同时移除引用；删除笔记会级联删除其附件",
      "正文以 quickwiki-att:// 引用附件（不再内嵌 base64 图片），本地与云端内容一致；换设备打开时图片按需后台下载回填",
    ],
  },
  {
    icon: <ImageIcon className="h-4 w-4" />,
    title: "图片与富元素",
    items: [
      "图片：统一由「附件库」管理（见上），正文只存引用，图片本体留在本机，断网也能看",
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
      "结果在顶部搜索框下方悬浮展示，左栏树与当前列表保持原样，不会被搜索打乱",
      "手机 / 平板上面板展开成整条宽度、桌面则与搜索框对齐，窄屏也能读全摘要",
      "每条结果标出所属笔记本（嵌套显示为「父 / 子」）、高亮关键词并展示命中位置的上下文",
      "↑ ↓ 选择、Enter 打开、Esc 清空；点击结果即打开笔记并切到它所在的笔记本",
      "搜索是全局的：覆盖全部笔记本的标题与正文，不限当前笔记本 / 标签",
    ],
  },
  {
    icon: <Download className="h-4 w-4" />,
    title: "数据导出",
    items: [
      "单篇导出 .md（含 YAML front matter：标题/时间/标签；图片内嵌为 data URL，保持单文件可移植）",
      "全量导出 ZIP：每篇一个 .md，图片（附件库图片与内嵌图）抽取到 images/ 目录并改写为相对链接",
      "数据存储在浏览器 IndexedDB，请定期导出备份",
    ],
  },
  {
    icon: <Cloud className="h-4 w-4" />,
    title: "云同步（多设备）",
    items: [
      "登录后使用：未登录只能看到登录页；数据按账号隔离存储",
      "注册无需设置密码：填邮箱收链接即完成建号（首次点开链接即注册并登录）",
      "登录方式：仅邮箱（不做第三方登录）：邮箱链接免密登录（含 6 位验证码兜底）/ 邮箱 + 密码",
      "账号管理（右上角头像菜单 → 账号管理）：看得到「是否已设密码」，可就地设置 / 修改密码",
      "同步触发：保存后自动 / 头部刷新按钮手动 / 恢复联网时；其他设备的改动自动推送到本机，无需手动刷新",
      "离线优先：断网继续写本地，恢复后按队列补推；删除会同步到所有设备",
      "登录状态长期保持：手机端切回前台会自动续期会话，无需反复重新登录",
      "冲突按最后写入胜出，多端数据最终一致；图片本体自动上传云存储，正文引用保持不变（不改写正文）",
    ],
  },
  {
    icon: <MonitorSmartphone className="h-4 w-4" />,
    title: "系统能力",
    items: [
      "PWA：可安装到桌面/主屏，离线可用",
      "响应式：桌面双栏（树状导航 + 编辑器）/ 手机单栏（抽屉侧边栏 + 列表）",
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
  ["[toc]", "插入目录（预览模式渲染）"],
  ["Tab", "任务清单嵌套（任务项内）"],
  ["Ctrl/Cmd+Enter", "提交块源码编辑（混合预览）"],
  ["Esc", "取消块源码编辑"],
  ["Ctrl/Cmd+K", "命令面板（命令 + 笔记跳转）"],
  ["Ctrl/Cmd+N", "新建笔记"],
  ["Ctrl/Cmd+F", "搜索笔记"],
  ["Ctrl/Cmd+S", "立即保存"],
  ["Ctrl/Cmd+E", "循环切换 编辑 / 源码 / 预览"],
  ["Ctrl/Cmd+/", "打开本说明"],
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
            本地优先的 Markdown 笔记 · 数据存储在浏览器，可完整导出 · 更新于 2026-09-16
          </p>
        </DialogHeader>

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
          规划中：桌面客户端（Tauri）· 移动端 App
        </p>
      </DialogContent>
    </Dialog>
  );
}
