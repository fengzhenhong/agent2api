import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
} from '@ui'

/**
 * Agent2API · 设置页「软件更新」面板 + 「检测到更新」弹窗（React 岛）。
 *
 * 替换 ui/update-panel.js。对外接口与原实现**完全一致**：
 *   `window.wbUpdatePanel = { load, check, syncFromCache, openAndDownload }`
 * 调用点一行都不用改：ui/settings-panel.js:177 → load()（切到设置页时）；
 * ui/app.js:845 → syncFromCache()（DOMContentLoaded，首屏用后端缓存回填）；
 * 「检测到更新」弹窗的「去更新」→ openAndDownload(info)（弹窗已归本文件）。
 * 另多导出一个 showUpdateModal(info)：旧 app.js 的定时轮询（pollUpdateStatus）是「隔
 * 一会儿再弹一次」的唯一推手，它原来走 wbApp.updateUpdateBadge → app.js 的
 * maybeShowUpdateModal；静态弹窗 DOM 一删那条路就断了，所以判定逻辑搬进本文件。
 *
 * ── 两块形态：常驻面板 + 按需弹窗（与 port-panel.tsx 同一套分工）─────
 * 第一块 `<div class="settings-pane" data-cat="about">` 是**常驻**的，模块加载时就把
 *   React root 建在**这个 div 本身**上（清掉原有静态子节点后），不套宿主：它的显隐由
 *   settings-panel.js 在它自己身上切 `.active`，子节点归本文件；中间插一层 wrapper 会
 *   让 `.panel` 的外边距与圆角裁切多出一层盒子，布局与接入前不等价。
 * 第二块弹窗是**按需**的：旧实现是 index.html 的 `#update-modal` 一族静态 DOM + app.js
 *   的开关函数；这里改成命令式外壳（照 port-panel）：需要时建宿主 div 挂 body、
 *   createRoot，关闭即 unmount + remove。**不读写 `#update-modal*` 任何 id**，结构走
 *   组件库 Dialog 一族（Esc / 点遮罩 / 焦点陷阱 / 滚动锁定全部内建）。
 *
 * ── 两条贯穿全文件的约定（细节见各自函数）────────────────────
 * · 页面布局类名照旧、只换控件：`.panel` / `.panel-head` / `.panel-body` /
 *   `.head-actions` / `.update-version` / `.version-pill` / `.detail` / `.update-author` /
 *   `.update-log*` / `.rel-note*` / `.md-body` 全部保留（样式在 page-settings.css 与
 *   update-notes.css）—— 它们是这一页的排版而不是「组件」，换成 Tailwind 会让「软件更新」
 *   与设置页其它面板长得不一样。里面的**控件**才换：button → Button（`class="primary"` →
 *   `variant="default"`、无 class → `variant="outline"`、`class="sm"` → `size="sm"`）、
 *   .badge → Badge（bad/warn/ok → destructive/warning/success，无修饰 → outline）、
 *   .progress → Progress。
 * · 显隐一律**条件渲染**，不写 hidden / style.display：组件库的 Tailwind 工具类是分层
 *   + !important，会压掉 tokens.css 里未分层的 `[hidden]{display:none!important}`
 *   （important 的层序反转），内联 style 同样被压。命令式流程（四个契约方法 + 1 秒下载
 *   轮询）改的是模块级快照，React 侧用 useSyncExternalStore 订阅（照 port-panel）。
 */

/* ─── 类型 ─────────────────────────────────── */

/** 更新检查结果（checkUpdate 的壳命令返回 / getUpdateStatus 的缓存）。字段按可选收：
 *  后端在「仓库暂无发布版本」「版本号无法解析」等情形下会给 null */
type UpdateInfo = {
  currentVersion?: string | null
  latestVersion?: string | null
  /** true / false / null（版本号无法比较时后端给 null，界面显示「无法比较」） */
  hasUpdate?: boolean | null
  /** 最新一版的发布说明（Markdown 原文，渲染交给 wbMarkdown） */
  notes?: string | null
  /** UTC 的 ISO 串 */
  publishedAt?: string | null
  /** GitHub 发布页（外链，交给 openReleasePage 打开） */
  pageUrl?: string | null
  prerelease?: boolean
  /** 可下载资产；没有资产时「下载并安装」不给 */
  asset?: { url?: string; name?: string } | null
  /** owner/repo：作者主页与仓库地址由它现拼，代码里不写死账号 */
  repository?: string
  /** 'nsis'（Windows，要 UAC 提权）/ 'dmg'（macOS，挂载后手动拖） */
  installerKind?: string
  /** 检查时刻（后端给的；前端不用本地时钟冒充） */
  checkedAt?: number
  /** 仅 getUpdateStatus 有：后端定时任务还没查过时为 false */
  checked?: boolean
}

/** 下载任务快照（downloadUpdate / updateProgress 的返回） */
type DownloadTask = {
  active?: boolean
  done?: boolean
  canceled?: boolean
  error?: string | null
  filename?: string
  path?: string | null
  received?: number
  total?: number
  percent?: number
}

/** 本岛用到的壳侧接口（见 bridge.rs 的「软件更新」一节） */
type UpdateBridge = {
  /** 壳命令：当前版本号只有壳知道，由壳带上去交给后端比较 */
  checkUpdate(): Promise<UpdateInfo | null | undefined>
  /** 后端缓存里的最近一次检查结果（定时任务写入） */
  getUpdateStatus(): Promise<UpdateInfo | null | undefined>
  downloadUpdate(payload: { url: string; name?: string }): Promise<DownloadTask | null | undefined>
  updateProgress(): Promise<DownloadTask | null | undefined>
  cancelUpdate(): Promise<{ canceled?: boolean } | null | undefined>
  runInstaller(
    path: string,
    restart: boolean,
  ): Promise<{ launched?: boolean; path?: string; restart?: boolean } | null | undefined>
  /** 打开外链的唯一出口（只放行 http(s)，见 commands.rs） */
  openReleasePage(url: string): Promise<{ url?: string } | null | undefined>
}

/**
 * window 上由其它脚本 / 其它岛挂载的共享桥。
 *
 * 刻意用「局部窄类型 + 转型」而不是 declare global 往 Window 上加属性：
 * workbuddyDesktop / wbApp / wbMarkdown 是多个岛共用的桥，各岛各 declare 一份会因同名
 * 属性类型不一致直接报 TS2717。本文件只声明自己独占的 wbUpdatePanel。
 */
type SharedWindow = {
  workbuddyDesktop?: UpdateBridge
  wbApp?: {
    toast?: (message: string, kind?: 'err' | 'ok') => void
    /** 把「有新版本」翻译成「设置」导航项上的「新」提示（app.js 的出口） */
    updateUpdateBadge?: (info: unknown) => void
    /** 切页：弹窗「去更新」要跳到设置页（与旧 app.js 的实现同一条路） */
    showPage?: (name: string, options?: { persist?: boolean }) => void
    /** 当前页标识：人已经在设置页时不弹窗（照抄旧 app.js 的判定） */
    readonly currentPage?: string
  }
  /** 设置页自己的分类切换（「去更新」要显式切到「关于」） */
  wbSettingsPanel?: { showCategory?: (category: string) => void }
  /** 更新日志的 Markdown 渲染（保持调用，不在这里重写它） */
  wbMarkdown?: { render?: (text: string) => string }
}

function shared(): SharedWindow {
  return window as unknown as SharedWindow
}

/* ─── 常量 ─────────────────────────────────── */

/** 进度轮询间隔：下载 25MB 左右，1 秒足够顺滑又不会太密（照旧实现） */
const POLL_MS = 1000

/**
 * 「跳过此次更新」记在 localStorage 的键（值 = 跳过的版本号）。
 *
 * 键名与旧 app.js 的 UPDATE_SKIP_KEY 逐字一致，别改：同一个用户升级过程中跳过的版本
 * 不该因为换了实现又弹一遍。按**版本号**记 —— 跳过的那个版本不再弹，将来更新的版本
 * 照常弹（「取消」什么都不记，见会话守卫 promptedUpdateVersion）。
 */
const UPDATE_SKIP_KEY = 'workbuddy-desktop-update-skip'

/** 徽章语义色记号（app.js 的 renderTopbarStatus 优先读 data-tone，见其 mirror 注释） */
type BadgeTone = '' | 'ok' | 'warn' | 'bad'

/** 记号 → 组件库 Badge 的 variant（与旧 .badge.ok / .warn / .bad 一一对应） */
const BADGE_VARIANT: Record<BadgeTone, 'outline' | 'success' | 'warning' | 'destructive'> = {
  '': 'outline',
  ok: 'success',
  warn: 'warning',
  bad: 'destructive',
}

/** 下载 / 安装的界面阶段：决定那颗按钮的文案与显隐 */
type DownloadPhase = 'idle' | 'downloading' | 'failed' | 'ready'

/** 面板快照：React 侧只读它，命令式流程只写它 */
type Snapshot = {
  /** 最近一次检查结果（null = 未检查 / 检查失败；更新日志也由它渲染） */
  info: UpdateInfo | null
  /** 上次检查的时刻（0 = 没有；以后端返回的 checkedAt 为准） */
  checkedAt: number
  /** owner/repo，来自接口：作者行由它拼出来 */
  repository: string
  badgeText: string
  badgeTone: BadgeTone
  /** 状态行文案（旧 #update-state） */
  stateText: string
  /** 状态行是否按错误着色（旧实现是 style.color = var(--danger)） */
  stateError: boolean
  /** 下载进度 0-100；旧实现只在 0 < percent < 100 时露出进度条 */
  percent: number
  phase: DownloadPhase
  /** 已就绪的安装包路径（空串 = 没有）；非空时按钮变「安装并重启 / 打开安装包」 */
  readyPath: string
  /** 检查更新在途（按钮文案切「检查中…」并禁用） */
  checking: boolean
  /** 下载 / 安装请求在途：按钮临时禁用（与旧实现置 DOM disabled 等价） */
  actionBusy: boolean
}

const INITIAL_SNAPSHOT: Snapshot = {
  info: null,
  checkedAt: 0,
  repository: '',
  // 初值与 index.html 静态骨架逐字一致：首屏在 load() 跑起来之前就长这样
  badgeText: '未检查',
  badgeTone: '',
  stateText: '点击「检查更新」查询最新发布版本。',
  stateError: false,
  percent: 0,
  phase: 'idle',
  readyPath: '',
  checking: false,
  actionBusy: false,
}

/* ─── 工具 ─────────────────────────────────── */

/** 脚注 / toast 的统一出口（运行期读 wbApp，不在模块顶层解构） */
function toast(message: string, kind?: 'err' | 'ok'): void {
  shared().wbApp?.toast?.(message, kind)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 两位补零。与 logs-panel 的时间格式同一套写法（手工 pad + 本地时区），不用
 *  toLocaleString：它的输出随系统区域设置变，面板里的其它时间都是定宽格式 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 发布 / 拉取时间 → `YYYY-MM-DD HH:mm`（publishedAt 是 UTC 的 ISO 串，转本地时区） */
function formatDateTime(value: unknown): string {
  const date = new Date(String(value ?? ''))
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 「上次检查」只要时刻：同一天内的检查看几点几分几秒就够了 */
function formatClock(value: number): string {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 外链白名单：只放行 http(s)（与后端 open_release_page 的口径一致，这里先挡一道） */
function safeExternal(value: unknown): string {
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? url : ''
}

/**
 * 安装包形态由后端按**编译目标平台**给出（checkUpdate 的 installerKind）。兜底读 UA
 * 的理由：load() 里「发现上次遗留的下载任务」那条路可能早于任何一次 checkUpdate（那时
 * info 还是 null），只看 installerKind 会让 macOS 用户看到「会弹出 UAC 确认框」这种在
 * 那台机器上根本不存在的东西。有后端值时一律以后端为准。
 */
function isMacInstaller(info: UpdateInfo | null): boolean {
  if (info?.installerKind) return info.installerKind === 'dmg'
  return /Mac|iPhone|iPad/.test(navigator.userAgent || '')
}

/** 「开始下载」时的提示：说明下载完会发生什么 */
function downloadHint(info: UpdateInfo | null): string {
  return isMacInstaller(info)
    ? '正在下载安装包…（下载完成后会挂载磁盘映像，把应用拖进「应用程序」即可完成安装）'
    : '正在下载安装包…（下载完成后启动安装程序需要管理员权限，会弹出 UAC 确认框）'
}

/** 「安装包已就绪」的提示：说明下一步该做什么 */
function readyHint(info: UpdateInfo | null, name: string): string {
  return isMacInstaller(info)
    ? `安装包已就绪：${name}。点击「打开安装包」后会挂载磁盘映像，把应用拖进「应用程序」即可完成安装。`
    : `安装包已就绪：${name}。点击「安装并重启」后需要管理员权限，会弹出 UAC 确认框。`
}

/** 安装按钮的文案：macOS 不重启（dmg 与运行中的进程没有文件冲突） */
function installButtonText(info: UpdateInfo | null): string {
  return isMacInstaller(info) ? '打开安装包' : '安装并重启'
}

/** 更新日志正文：渲染交给 wbMarkdown（本文件不重写它），只做缺失兜底 */
function markdownHtml(notes: string): string {
  return shared().wbMarkdown?.render?.(notes) || ''
}

/** 读「跳过此次更新」的版本号（隐私模式等取不到就当作没跳过） */
function readSkippedVersion(): string {
  try { return localStorage.getItem(UPDATE_SKIP_KEY) || '' } catch { return '' }
}

/** 记「跳过此次更新」（写不进去只影响下次启动，不影响本次会话） */
function writeSkippedVersion(version: string): void {
  try { localStorage.setItem(UPDATE_SKIP_KEY, version) } catch { /* 忽略：下次照常弹 */ }
}

/* ─── 共享快照（外部 store）──────────────────── */

let snapshot: Snapshot = INITIAL_SNAPSHOT

/** 快照的订阅者（当前只有面板那一个 root） */
const subscribers = new Set<() => void>()

function getSnapshot(): Snapshot {
  return snapshot
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener)
  return () => { subscribers.delete(listener) }
}

/** 打补丁并通知界面：useSyncExternalStore 靠引用比较判变化，必须换新对象 */
function publish(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of subscribers) listener()
}

/* ─── 模块级流程状态 ─────────────────────────── */

/**
 * 「一次只干一件事」的互斥锁（旧实现的 busy）。
 *
 * 刻意放在模块级而不是快照里：openAndDownload 的重试循环与事件回调都要**同步**读到它
 * （同一刻的第二下、轮询与保存撞车都靠它早退）。界面上的禁用另用 checking / actionBusy
 * 两个字段表达，两者不混。
 */
let busy = false

/**
 * 已经自动装过的安装包路径。
 *
 * 下载完成即自动安装（点「下载并安装」的意图就是要更新，不该再让人手动点第二次），
 * 无论下载是不是本次进入面板发起的、中途有没有切过页。这个变量只挡**重复自动装**：
 * UAC 被拒 / 安装程序没起来时任务仍停在「已完成」，页面重入（load）会再次看到它，
 * 没有这道闸就会每切一次页弹一次 UAC。装过一次后界面改为给出按钮，由用户手动重试。
 */
let autoInstalledPath: string | null = null

/** 下载进度轮询定时器；null = 没在轮询 */
let pollTimer: number | null = null

/** 本会话内已弹过提示的版本号（「取消」不写 localStorage，靠它防同一版本连弹） */
let promptedUpdateVersion = ''

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

/* ─── 面板状态写入（旧实现的 setBadge / setState / renderXxx）── */

function setBadge(text: string, tone: BadgeTone = ''): void {
  publish({ badgeText: text, badgeTone: tone })
}

function setState(text: string, isError = false): void {
  publish({ stateText: text, stateError: isError })
}

/**
 * 把最近一次检查结果铺到面板上：检查成功后与「重新进入设置页」复用同一段。
 *
 * 旧实现里的 renderVersions / renderChangelog / toggleActions 在本文件没有对应函数
 * —— 它们要写的东西（两个版本号、更新日志、元信息、下载按钮的显隐）都是 info /
 * checkedAt / repository / phase 的**纯派生**，React 侧由快照自动重绘。这里只负责那两处
 * 「不是派生」的读数：徽章与状态行。
 */
function renderCheckResult(): void {
  const { info, checkedAt } = snapshot
  if (!info) return
  const at = checkedAt ? `（检查于 ${formatClock(checkedAt)}）` : ''
  if (info.hasUpdate === true) {
    setBadge('有新版本', 'warn')
    setState(`发现新版本 ${info.latestVersion}（当前 ${info.currentVersion}）。${at}`)
  } else if (info.hasUpdate === false) {
    setBadge('已是最新', 'ok')
    setState(`当前已是最新版本（${info.currentVersion}）。${at}`)
  } else {
    // hasUpdate 为 null：版本号无法比较（本地是开发版或 tag 非语义化）
    setBadge('无法比较', 'warn')
    setState(info.latestVersion
      ? `最新发布版本为 ${info.latestVersion}，但当前版本号「${info.currentVersion || '未知'}」无法解析，未做新旧判断。${at}`
      : `仓库暂无发布版本。${at}`)
  }
}

/** 仓库全名（owner/repo）来自接口；形态不对就不用，免得拼出个乱七八糟的链接 */
function applyRepository(value: unknown): void {
  const repo = String(value || '').trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return
  publish({ repository: repo })
}

/* ─── 下载 ───────────────────────────────────── */

/**
 * 下载任务状态 → 界面文案（旧实现的 renderTask，逐字照搬）。
 *
 * 返回 false 表示这条快照既不是进行中、也没有收尾信息（例如后端刚起的空任务），
 * 界面保持原样、轮询继续。
 */
function renderTask(task: DownloadTask | null | undefined): boolean {
  if (!task) return false

  if (task.active) {
    const percent = Math.max(0, Math.min(100, Number(task.percent) || 0))
    const mb = (Number(task.received) || 0) / 1024 / 1024
    const totalMb = (Number(task.total) || 0) / 1024 / 1024
    publish({ phase: 'downloading', percent })
    setBadge('下载中', 'warn')
    setState(`正在下载 ${task.filename || '安装包'}：${percent}%（${mb.toFixed(1)} / ${totalMb.toFixed(1)} MB）`)
    return true
  }

  stopPolling()
  publish({ percent: 0 })

  if (task.error) {
    setBadge('下载失败', 'bad')
    setState(`下载失败：${task.error}`, true)
    publish({ phase: 'failed' })
    return true
  }
  if (task.canceled) {
    setBadge('已取消', 'warn')
    setState('下载已取消，可重新点击「下载并安装」。')
    // 回到 idle：按钮文案变回「下载并安装」（旧实现同样只改文案，不动显隐）
    publish({ phase: 'idle' })
    return true
  }
  if (task.done && task.path) {
    const path = task.path
    const name = task.filename || path
    setBadge('可安装', 'ok')
    publish({ phase: 'ready', readyPath: path })
    // 下载完成即自动安装（含「下载中切走、回来时已经下完」这条重入路径）。只有同一
    // 路径已经自动装过一次才不再重复触发 —— 那时任务仍停在「已完成」（UAC 被拒 /
    // 安装程序没起来），反复自动触发等于反复弹 UAC。
    if (path !== autoInstalledPath) {
      autoInstalledPath = path
      setState(isMacInstaller(snapshot.info)
        ? '安装包已下载完成，正在挂载磁盘映像…'
        : '安装包已下载完成，正在启动安装程序（需要管理员权限，会弹出 UAC 确认框）…')
      void install(path)
    } else {
      setState(readyHint(snapshot.info, name))
    }
    return true
  }
  return false
}

/**
 * 轮询一拍。
 *
 * 与旧实现的一处**有意偏差**：任务快照为空（后端重启过 / 任务被清掉）时停表，而不是
 * 像旧实现那样继续每秒打一次 —— 旧实现的 renderTask(null) 直接 return false，没人
 * 收表，会一直空转到页面重载。界面保持最后一次读数，用户仍可用按钮重试。
 */
async function pollProgress(): Promise<void> {
  try {
    const task = await shared().workbuddyDesktop?.updateProgress()
    if (!task) {
      stopPolling()
      return
    }
    renderTask(task)
  } catch (error) {
    stopPolling()
    setState(`读取下载进度失败：${errorMessage(error)}`, true)
  }
}

function startPolling(): void {
  stopPolling()
  pollTimer = window.setInterval(() => { void pollProgress() }, POLL_MS)
}

/**
 * 安装：启动安装包；Windows 上由壳退出本程序，让出文件占用。
 *
 * 返回值里的 restart 是**壳按平台定的**：Windows 覆盖安装前必须先退出，macOS 挂载 dmg
 * 则不需要（也不该）退出 —— 所以这里不假设重启，按壳回传的取值决定提示语（否则 macOS
 * 用户会等一个不会发生的退出）。
 */
async function install(path: string): Promise<void> {
  const api = shared().workbuddyDesktop
  if (!api) return
  try {
    const result = await api.runInstaller(path, true)
    const willRestart = result?.restart !== false
    setState(willRestart
      ? '安装程序已启动，本程序将退出以便完成覆盖安装。安装程序需要管理员权限，会弹出 UAC 确认框，请选择「是」。'
      : '安装包已挂载，请在弹出的窗口里把应用拖进「应用程序」完成安装。安装完成后重新打开本程序即可。')
  } catch (error) {
    setBadge('启动失败', 'bad')
    // UAC 被拒时壳侧返回的提示已经说明「可重新点击安装并重启」，这里原样透出，不额外
    // 包装 —— 用户照着做就能重试成功（按钮仍在，见 phase === 'ready'）
    setState(`启动安装程序失败：${errorMessage(error)}`, true)
  }
}

/* ─── 弹窗与外链 ─────────────────────────────── */

/**
 * 弹与不弹的判定（从旧 app.js 的 maybeShowUpdateModal 原样搬来）：
 *   · 只有确实有新版本、且最新版本号非空才弹；
 *   · 「跳过此次更新」记的是**版本号**：该版本不再弹，将来更新的版本照常弹；
 *   · 「取消」什么都不记，但本会话内同一版本也不再弹（promptedUpdateVersion）——
 *     后端的定时检查到点会再次发现它，没有这道闸就会隔一分钟弹一次；
 *   · 人已经在设置页时不弹 —— 软件更新面板就在眼前，再盖一层弹窗纯属打扰。
 *
 * 调用点与旧实现一致：check / syncFromCache / openAndDownload 结束时各一次（check 那条
 * 实际上永远被「人已在设置页」挡住，留着是为了与旧路径一一对应），另外作为契约方法供
 * app.js 的定时轮询转发。
 */
function showUpdateModal(info: UpdateInfo | null | undefined): void {
  if (!info || info.hasUpdate !== true) return
  const latest = String(info.latestVersion || '').trim()
  if (!latest) return
  if (shared().wbApp?.currentPage === 'settings') return
  if (latest === readSkippedVersion() || latest === promptedUpdateVersion) return
  promptedUpdateVersion = latest

  unmountUpdateModal()
  modalHost = document.createElement('div')
  document.body.append(modalHost)
  modalRoot = createRoot(modalHost)
  modalRoot.render(<UpdateModal info={info} onClose={unmountUpdateModal} />)
}

/** 打开外链：一律交给系统浏览器。webview 里直接导航会白屏，而且本程序持有桥接权限，
 *  外部链接不该在应用内部打开 */
async function openExternal(url: string): Promise<void> {
  const target = safeExternal(url)
  if (!target) {
    toast('链接地址不受支持', 'err')
    return
  }
  try {
    await shared().workbuddyDesktop?.openReleasePage(target)
  } catch (error) {
    toast(`打开链接失败：${errorMessage(error)}`, 'err')
  }
}

/**
 * 事件委托：更新日志与 Markdown 正文里的外链是动态渲染出来的，逐个绑定既费事又容易漏。
 * 挂在面板根节点上（React 合成事件会冒泡到这里），弹窗正文里也挂一份 —— 旧实现只管
 * 面板那一份，弹窗里的链接会直接让 webview 导航（白屏），这里补上。
 */
function handleExternalClick(event: React.MouseEvent<HTMLElement>): void {
  const target = event.target as HTMLElement | null
  const trigger = target?.closest?.('[data-external]') as HTMLElement | null
  if (!trigger) return
  event.preventDefault() // 掐掉 webview 自己的导航（跳过去只会白屏）
  void openExternal(trigger.dataset.external || '')
}

/* ─── 面板流程（对外契约的实现）────────────────── */

/** 检查更新：用户主动发起的一次请求（受后端最短间隔与失败冷却约束） */
async function check(): Promise<UpdateInfo | null> {
  if (busy) return null
  busy = true
  publish({ checking: true })
  setBadge('检查中', 'warn')
  setState('正在查询 GitHub 上的最新发布版本…')
  let result: UpdateInfo | null = null
  try {
    const api = shared().workbuddyDesktop
    if (!api) throw new Error('后端桥不可用')
    const info = await api.checkUpdate()
    result = info ?? null
    // 时刻以后端返回的为准：这一下可能落在定时任务刚查完的缓存上，用本地时钟会把
    // 几分钟前的结果标成「刚刚查的」
    publish({ info: result, checkedAt: Number(result?.checkedAt) || Date.now() })
    if (result?.repository) applyRepository(result.repository)
    renderCheckResult()
  } catch (error) {
    result = null
    // 失败：版本号回到「—」、日志回到未检查态（都是派生，清空 info 即可）
    publish({ info: null, checkedAt: 0 })
    setBadge('检查失败', 'bad')
    setState(`检查更新失败：${errorMessage(error)}`, true)
  } finally {
    busy = false
    publish({ checking: false })
  }
  // 左侧导航的提示：只有确实有新版本才亮，失败与「已是最新」都静默
  shared().wbApp?.updateUpdateBadge?.(result)
  showUpdateModal(result)
  return result
}

/**
 * 铺面板：读**后端缓存**里的最近一次检查结果，不自己打 GitHub。
 *
 * 查询由后端的定时任务负责（默认每 20 分钟一次，结果落库）。前端每次加载都自己再查
 * 一遍是重复劳动，代价还很高：dev 热重载下页面一天要重载几十次，匿名限额（60 次/小时，
 * 按出口 IP 计）很快见底，见底之后连定时任务也一起失败 —— 见底后本该做的只是等下一个
 * 检查窗口。缓存里没有结果时（后端刚起、或用户关掉了这条定时任务）按「未检查」显示。
 */
async function syncFromCache(): Promise<void> {
  if (snapshot.info) {
    renderCheckResult()
    return
  }
  let cached: UpdateInfo | null = null
  try {
    cached = (await shared().workbuddyDesktop?.getUpdateStatus()) ?? null
  } catch {
    /* 后端未就绪：按未检查处理 */
  }
  if (cached && cached.checked !== false) {
    publish({ info: cached, checkedAt: Number(cached.checkedAt) || 0 })
    if (cached.repository) applyRepository(cached.repository)
    renderCheckResult()
    // 导航提示与 check() 同一出口：定时任务查到新版本时也能亮起来
    shared().wbApp?.updateUpdateBadge?.(cached)
    // 首屏这条路径正是「定时任务发现新版本 → 弹一次提示」的唯一入口（旧 app.js 同）
    showUpdateModal(cached)
    return
  }
  setBadge('未检查')
  setState('点击「检查更新」查询 GitHub 上的最新发布版本。')
}

/**
 * 那颗按钮的两种语义：下载 / 取消，以及安装包就绪后的安装。
 *
 * 显隐照旧实现的 toggleActions：有更新且真的有可下载资产时才给。额外保留「下载中 /
 * 已就绪」两种状态下的显隐 —— 那时即便 info 变了也得让用户能取消或安装（旧实现靠
 * 「不重铺 toggleActions」实现同一效果，这里写成显式条件）。
 */
async function downloadOrCancel(): Promise<void> {
  if (busy) return
  const current = getSnapshot()

  // 已有就绪的安装包：按钮在这一步是「安装并重启 / 打开安装包」
  if (current.phase !== 'downloading' && current.readyPath) {
    busy = true
    publish({ actionBusy: true })
    try {
      await install(current.readyPath)
    } finally {
      busy = false
      publish({ actionBusy: false })
    }
    return
  }

  // 正在下载时按钮变成「取消下载」
  if (current.phase === 'downloading') {
    try {
      await shared().workbuddyDesktop?.cancelUpdate()
      setState('正在取消下载…')
    } catch (error) {
      toast(`取消失败：${errorMessage(error)}`, 'err')
    }
    return
  }

  const asset = current.info?.asset
  if (!asset?.url) {
    toast('没有可下载的安装包', 'err')
    return
  }
  // 按钮不可见就不该从这里发起下载（openAndDownload 的自动触发也走这条路）
  if (!downloadButton(current)) return

  busy = true
  publish({ actionBusy: true })
  try {
    await shared().workbuddyDesktop?.downloadUpdate({ url: asset.url, name: asset.name })
    // 新一轮下载：清掉上一轮的「已自动装过」记录 —— 同一个安装包重新下载后仍应在
    // 下载完成时自动安装
    autoInstalledPath = null
    publish({ phase: 'downloading', readyPath: '', percent: 0 })
    setBadge('下载中', 'warn')
    setState(downloadHint(current.info))
    startPolling()
  } catch (error) {
    setBadge('下载失败', 'bad')
    setState(`下载失败：${errorMessage(error)}`, true)
  } finally {
    busy = false
    publish({ actionBusy: false })
  }
}

/** 面板数据入口（切入设置页时由 settings-panel.js 调用） */
async function load(): Promise<void> {
  // 日志与版本号同源：先按当前结果铺一次（含启动时那次自动检查的结果与检查时刻），
  // 切回来时不会白着一块等接口
  renderCheckResult()

  // 先看有没有上次遗留的下载任务（页面切走再回来时进度不丢）
  try {
    const task = await shared().workbuddyDesktop?.updateProgress()
    if (task?.active) {
      // 遗留任务照样自动装（见 autoInstalledPath 的说明）：这里不再区分「本次会话
      // 发起」与「切页回来碰上」，下载完成的处理只有一条路
      renderTask(task)
      startPolling()
      return
    }
    if (task?.done && task.path) {
      renderTask(task)
      return
    }
  } catch {
    /* 后端未就绪：按未检查处理 */
  }

  // 启动时已经自动检查过一次的话，把那次结果原样铺回来（含检查时刻）。这里曾经无条件
  // 重置成「未检查」，那样等于把启动检查的结果白白丢掉
  if (snapshot.info) {
    renderCheckResult()
    return
  }

  // 本次会话还没有结果：读后端缓存（定时任务按间隔查一次、结果落库的那一份）。
  // 这里**不再自己打 GitHub** —— 理由见 syncFromCache。
  await syncFromCache()
}

/**
 * 「检测到更新」弹窗点「去更新」时进入：带着弹窗已有的检查结果进来，并把界面铺好之后
 * **直接开始下载**。
 *
 * 为什么不在这里再调一次 check()：弹窗里的版本号、更新日志就是那次 checkUpdate 的结果，
 * 再查一次既多一次网络往返，又可能出现「弹窗说有新版、面板却查到没有」的不一致。直接
 * 把结果交进来，两边永远同源。
 *
 * 已有遗留任务 / 已下载完成时不重复下载，交给 load() 的既有逻辑接管 —— 重复触发下载会
 * 把正在下的任务顶掉。
 */
async function openAndDownload(checkedInfo?: UpdateInfo | null): Promise<void> {
  if (checkedInfo?.hasUpdate === true) {
    // 这里的时刻取本地时钟（照旧实现）：弹窗那份结果刚拿到手，标成「刚刚查的」才准
    publish({ info: checkedInfo, checkedAt: Date.now() })
    if (checkedInfo.repository) applyRepository(checkedInfo.repository)
    renderCheckResult()
    shared().wbApp?.updateUpdateBadge?.(checkedInfo)
    // 此刻人已被「去更新」带到设置页，这次调用会被「人已在设置页」挡住（旧路径同）
    showUpdateModal(checkedInfo)
  }
  await load()
  // 已有下载在跑或安装包已就绪：那两种状态下按钮分别是「取消下载」与「安装并重启」，
  // 自动再触发一次语义就错了
  const current = getSnapshot()
  if (current.phase === 'downloading' || current.readyPath) return
  if (!current.info?.hasUpdate) return
  // downloadOrCancel 开头有 `if (busy) return`，而 busy 在**别的**检查 / 下载正在进行时
  // 为真（后端的定时检查到点才跑，正好卡在这个瞬间的话，这一下会被静默吞掉，人看到的
  // 就是「点了没反应」）。每轮先等再判，给在跑的那件事让出时间；三轮仍占用就放弃 ——
  // 按钮本来就在面板上，用户手点一下即可。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (busy) {
      await new Promise<void>(resolve => { window.setTimeout(resolve, 400) })
      continue
    }
    await downloadOrCancel()
    return
  }
}

/* ─── 第一块：设置页里的常驻面板 ─────────────── */

/** 面板上那颗按钮的形态；null = 不渲染（显隐一律条件渲染，理由见文件头） */
function downloadButton(snap: Snapshot): { label: string; disabled: boolean } | null {
  // 有更新且真的有可下载资产时才给出「下载并安装」
  const actionable = snap.info?.hasUpdate === true && !!snap.info?.asset?.url
  if (!actionable && snap.phase !== 'downloading' && snap.phase !== 'ready') return null
  const label = snap.phase === 'downloading'
    ? '取消下载'
    : snap.phase === 'failed'
      ? '重试下载'
      : snap.phase === 'ready'
        ? installButtonText(snap.info)
        : '下载并安装'
  return { label, disabled: snap.actionBusy }
}

/** 更新日志（最新一版）：正文与「在 GitHub 查看」都在一张静态卡片里，不再折叠 */
function changelogCard(snap: Snapshot): React.ReactNode {
  const info = snap.info
  const notes = String(info?.notes || '').trim()
  if (!notes) {
    return (
      <div className='update-log-hint'>
        {info ? '这个版本没有填写发布说明。' : '点击「检查更新」后，这里会显示最新版本的更新说明。'}
      </div>
    )
  }
  const html = markdownHtml(notes)
  const pageUrl = safeExternal(info?.pageUrl)
  const published = formatDateTime(info?.publishedAt)
  return (
    <div className='rel-note'>
      <div className='rel-note-head'>
        <span className='rel-tag'>{String(info?.latestVersion || '最新版本')}</span>
        {/* 旧的 .badge.tag.warn → Badge 的 tag 形态 + warning 语义色 */}
        {info?.prerelease === true ? <Badge shape='tag' variant='warning'>预发布</Badge> : null}
        {published ? <span className='rel-date'>{published}</span> : null}
      </div>
      <div className='rel-note-body'>
        {/* 正文是 wbMarkdown 渲染出来的 HTML（保持调用，不重写）：只能走
            dangerouslySetInnerHTML。外围标记仍由 React 渲染，版本号 / 日期 / 链接都是
            文本节点，于是旧实现那几处 esc() 在这里天然不需要。 */}
        {html ? <div className='md-body' dangerouslySetInnerHTML={{ __html: html }} /> : (
          <div className='md-body'>
            <p className='md-body-empty'>这个版本没有填写发布说明。</p>
          </div>
        )}
        {pageUrl ? (
          <div className='rel-foot'>
            <a href={pageUrl} data-external={pageUrl} target='_blank' rel='noopener'>
              在 GitHub 查看完整说明
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 面板本体。root 建在 `.settings-pane[data-cat="about"]` 上，渲染出来的根元素就是原来
 *  那个 `.panel` —— 类名与骨架一一对应，只是控件换成了组件库 */
function UpdatePanel() {
  const snap = React.useSyncExternalStore(subscribe, getSnapshot)
  const button = downloadButton(snap)

  // 面板常驻（root 随应用生命周期），正常不会卸载；万一将来被卸载（骨架变化 / 页面
  // 重载），把进度轮询收掉 —— 悬挂的定时器会一直按 1 秒打后端
  React.useEffect(() => () => { stopPolling() }, [])

  const repo = snap.repository ? `https://github.com/${snap.repository}` : ''
  const owner = snap.repository ? `https://github.com/${snap.repository.split('/')[0]}` : ''
  const latestLabel = snap.info?.latestVersion
    ? `${snap.info.latestVersion}${snap.info.prerelease ? '（预发布）' : ''}`
    : '—'
  const tag = String(snap.info?.latestVersion || '').trim()
  const logMeta = tag ? `${tag}${snap.checkedAt ? ` · 检查于 ${formatClock(snap.checkedAt)}` : ''}` : ''

  return (
    <section className='panel' onClick={handleExternalClick}>
      <div className='panel-head'>
        <h2>软件更新</h2>
        <span
          className='tip-q'
          data-tip='更新包从 GitHub 发布页下载，下载完成后可直接启动安装程序并自动重启本程序。安装包会先校验来源域名与文件完整性；访问 GitHub 较慢时，会自动尝试通过 Clash Verge 的混合端口重试一次。'
        ></span>
        {/* id 保留：app.js 的 renderTopbarStatus 按 id 镜像徽章文案与语义色（配色经
            data-tone 传；设置页顶栏那枚镜像目前还不读它，保持一致没坏处） */}
        <Badge id='update-badge' variant={BADGE_VARIANT[snap.badgeTone]} data-tone={snap.badgeTone}>
          {snap.badgeText}
        </Badge>
        <div className='head-actions'>
          {/* 旧 class="primary" → variant="default"；无 class → variant="outline" */}
          <Button id='btn-update-check' variant='outline' disabled={snap.checking} onClick={() => void check()}>
            {snap.checking ? '检查中…' : '检查更新'}
          </Button>
          {button ? (
            <Button
              id='btn-update-download'
              variant='default'
              disabled={button.disabled}
              onClick={() => void downloadOrCancel()}
            >
              {button.label}
            </Button>
          ) : null}
        </div>
      </div>
      <div className='panel-body'>
        {/* 当前版本 → 最新版本两个读数同一行，窗口放不下时靠 .update-version 的 wrap 换行 */}
        <div className='update-version'>
          <span className='version-pill'>
            <span className='k'>当前版本</span>
            <span className='v' id='update-current'>{snap.info?.currentVersion || '—'}</span>
          </span>
          <span className='version-arrow'>→</span>
          <span className='version-pill new'>
            <span className='k'>最新版本</span>
            <span className='v' id='update-latest'>{latestLabel}</span>
          </span>
        </div>

        {/* 错误态用行内色（旧实现同样是 style.color）：.detail 是页面排版类，
            没有语义色工具类可换 */}
        <div className='detail' id='update-state' style={snap.stateError ? { color: 'var(--danger)' } : undefined}>
          {snap.stateText}
        </div>

        {/* 进度条：旧实现只在 0 < percent < 100 时露出，这里同样条件渲染 */}
        {snap.phase === 'downloading' && snap.percent > 0 && snap.percent < 100
          ? <Progress value={snap.percent} />
          : null}

        {/* 关于作者 + 收藏项目：作者主页与仓库地址都从接口返回的 repository 现拼
            （fork 后自动指向 fork 者），拿到数据前整行不渲染 */}
        {owner && repo ? (
          <div className='update-author' id='update-author'>
            <div className='update-author-text'>
              <strong>关于作者</strong>
              <span>
                本工具由{' '}
                <a id='update-author-link' href={owner} data-external={owner} target='_blank' rel='noopener'>
                  {snap.repository.split('/')[0]}
                </a>{' '}
                个人开发并开源维护，免费使用、不带广告，也不会收集你的账号数据。如果它帮到了你，欢迎到项目仓库点个
                Star 支持一下。
              </span>
            </div>
            <div className='update-author-actions'>
              <Button
                id='btn-update-favorite'
                type='button'
                size='sm'
                variant='outline'
                data-external={repo}
                title='在浏览器中打开项目仓库，点 Star 支持作者'
              >
                收藏项目
              </Button>
            </div>
          </div>
        ) : null}

        {/* 更新日志：只展示最新一次发布的说明，数据来自「检查更新」的结果
            （与上方「最新版本」同源） */}
        <div className='update-log' id='update-notes'>
          <div className='update-log-head'>
            <span className='update-log-title'>更新日志</span>
            <span className='update-log-meta' id='update-log-meta'>{logMeta}</span>
          </div>
          <div className='update-log-body' id='update-log-body'>{changelogCard(snap)}</div>
        </div>
      </div>
    </section>
  )
}

/* ─── 第二块：「检测到更新」弹窗（按需建、关闭即卸）── */

type UpdateModalProps = {
  /** 打开那一刻的检查结果（弹窗里的版本号与日志都是它的，不再重查） */
  info: UpdateInfo
  onClose: () => void
}

function UpdateModal({ info, onClose }: UpdateModalProps) {
  const version = String(info.latestVersion || '')
  const notes = String(info.notes || '').trim()
  const html = notes ? markdownHtml(notes) : ''

  /** 「跳过此次更新」：按版本号记进 localStorage（与旧 app.js 同一个键） */
  function handleSkip(): void {
    writeSkippedVersion(version)
    onClose()
  }

  /**
   * 「去更新」：关窗 → 切到设置页的「关于」分类 → 带着弹窗这份结果直接开始下载。
   *
   * 为什么走 wbApp.showPage + wbSettingsPanel.showCategory：与旧 app.js 的
   * `#update-modal-go` 逐字对应（只切视图、不写分类偏好 —— 这是弹窗带来的深链，
   * 不该改用户手点的默认分类）。
   */
  function handleGo(): void {
    onClose()
    const app = shared()
    app.wbApp?.showPage?.('settings')
    app.wbSettingsPanel?.showCategory?.('about')
    void openAndDownload(info)
  }

  return (
    // 受控 open（恒为 true）：关窗一律由 onClose 收口。Esc / 点遮罩 / 右上角 ✕ 都由
    // Base UI 的 Dialog 内建（旧实现自己听 mask 点击与那个 ✕ 按钮）
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>检测到更新</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className='text-[12.5px] leading-[1.6] text-subtle'>
            新版本 <strong className='text-foreground'>{version}</strong> 已发布（当前{' '}
            {info.currentVersion || '未知'}），更新日志如下：
          </p>
          {/* 正文限高 + 滚动（旧 .update-modal-notes 的 46vh），长日志不会把弹窗撑出一屏；
              overscroll-contain 拦住滚动链，滚到底不带动外层页面 */}
          <div className='max-h-[46vh] overflow-y-auto overscroll-contain pr-1.5' onClick={handleExternalClick}>
            {html ? <div className='md-body' dangerouslySetInnerHTML={{ __html: html }} /> : (
              <div className='md-body'>
                <p className='md-body-empty'>这个版本没有填写发布说明。</p>
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          {/* 旧 .modal-foot 的布局：跳过 | spacer | 取消 + 去更新 */}
          <Button variant='outline' size='sm' onClick={handleSkip}>跳过此次更新</Button>
          <div className='mr-auto' />
          <Button variant='outline' onClick={onClose}>取消</Button>
          <Button variant='default' onClick={handleGo}>去更新</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

let modalRoot: ReturnType<typeof createRoot> | null = null
let modalHost: HTMLElement | null = null

function unmountUpdateModal(): void {
  if (modalRoot) {
    modalRoot.unmount()
    modalRoot = null
  }
  if (modalHost) {
    modalHost.remove()
    modalHost = null
  }
}

/* ─── 挂载：接管 index.html 里既有的设置分类区块 ─── */

const PANE_SELECTOR = '.settings-pane[data-cat="about"]'

let paneRoot: ReturnType<typeof createRoot> | null = null

/**
 * 把 React root 直接建在 `.settings-pane[data-cat="about"]` 上（不套宿主）。
 *
 * 先清掉骨架里的静态子节点（那一张 `.panel`）：下面的 JSX 会按同样的类名重新渲染它，
 * 留着会与 React 的接管打架。createRoot 不替我们清容器，所以手动 replaceChildren()；
 * 容器自身的 class / data-cat 由 settings-panel.js 管，别动。
 *
 * 节点不在（页面骨架变了）就静默跳过：契约方法照常注册，切到设置页时只是没有这一块
 * 面板，不会把整个设置页带崩。
 */
function mountPanel(): void {
  if (paneRoot) return
  const pane = document.querySelector<HTMLElement>(PANE_SELECTOR)
  if (!pane) return
  pane.replaceChildren()
  paneRoot = createRoot(pane)
  paneRoot.render(<UpdatePanel />)
}

// 脚本排在页面骨架之后（index.html 里 islands/ui.js 在各 section 之后），正常直接挂；
// 万一将来被挪到前面，退化成等 DOM 解析完再挂。
if (document.querySelector(PANE_SELECTOR)) mountPanel()
else document.addEventListener('DOMContentLoaded', mountPanel, { once: true })

/* ─── 注册：对外契约 ─────────────────────────── */

declare global {
  interface Window {
    /** 软件更新面板（替换 ui/update-panel.js，四个方法与原实现一致） */
    wbUpdatePanel?: {
      /** settings-panel.js 切到设置页时调用 */
      load(): Promise<void>
      /** 「检查更新」按钮 */
      check(): Promise<UpdateInfo | null>
      /** 首屏读后端缓存回填（不打网络） */
      syncFromCache(): Promise<void>
      /** 弹窗「去更新」/ 定时检查发现新版本后：铺面板并直接开始下载 */
      openAndDownload(info?: UpdateInfo | null): Promise<void>
      /** 本文件新增（旧实现里这段在 app.js 的 maybeShowUpdateModal）：内部已含「跳过
       *  版本 / 本会话已弹过 / 人已在设置页」的全部判定，调用方把 checkUpdate /
       *  getUpdateStatus 的结果直接转发进来即可。app.js 的定时轮询（pollUpdateStatus）
       *  若仍走 wbApp.updateUpdateBadge，需要在那边改成转发到这里，否则「取消后再弹
       *  一轮」会失效 */
      showUpdateModal(info?: UpdateInfo | null): void
    }
  }
}

window.wbUpdatePanel = { load, check, syncFromCache, openAndDownload, showUpdateModal }
