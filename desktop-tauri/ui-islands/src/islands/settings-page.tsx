import * as React from 'react'
import { flushSync } from 'react-dom'
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@ui'
import {
  CATEGORIES,
  NOTES,
  PROMPT_MODES,
  QUEUE_FIELDS,
  RETENTION_FIELDS,
  RETRY_FIELDS,
  STATES,
  TIPS,
  TIMEOUT_FIELDS,
  formatBytes,
  formatCount,
  shared,
  type NumberField,
} from './settings-model'
import {
  addRetryCode,
  applyUnits,
  clearDegrade,
  dropLastRetryCode,
  exportAccounts,
  importAccounts,
  load,
  panelLogout,
  refreshDebug,
  refreshPrompt,
  refreshQueue,
  refreshRetention,
  refreshRetry,
  refreshSanitize,
  refreshStorage,
  refreshTimeouts,
  removeRetryCode,
  renderDebug,
  renderPrompt,
  renderRetention,
  renderRetry,
  renderSanitize,
  renderSettings,
  renderStorage,
  resolveRetentionConfirm,
  restoreCategory,
  saveCaptcha,
  saveDebug,
  savePromptFile,
  savePromptMode,
  saveQueueField,
  saveRetentionField,
  saveRetryField,
  saveSanitize,
  saveTimeoutField,
  saveToggle,
  selectCategory,
  showCategory,
  useSettings,
  type DebugState,
  type LoadStatus,
  type NumericState,
  type PromptState,
  type SettingsSnapshot,
  type StorageState,
} from './settings-state'

/**
 * Agent2API · 设置页（React 岛）。
 *
 * 替换 ui/settings-panel.js（那份自持状态、按 id 读写 DOM、用 innerHTML 拼导入失败明细的
 * 老实现）。对外接口与原实现**逐字一致**（见文件末尾）：调用点一行都不用改 ——
 * app.js:135 load()、upgrade-panel.js:74 load()、islands/update-panel.tsx:972 showCategory('about')。
 *
 * ── 三块文件的分工 ──────────────────────────
 * settings-page.tsx（本文件）= 视图 + 挂载 + 对外契约；settings-state.ts = 快照 store 与全部
 * 读写流程；settings-model.ts = 桥类型 / 字段表 / 页面文案。后两个是 .ts，不会被
 * `islands/*.tsx` 的 glob 当岛加载 —— 设置页的岛只有本文件一个。
 *
 * ── ⚠ 「关于」分类的面板不归本文件 ───────────────
 * `.settings-pane[data-cat="about"]` 是**另一个岛**（update-panel.tsx）的挂载点：它在模块
 * 加载期就 `document.querySelector('.settings-pane[data-cat="about"]')`，找到才把 React root
 * 建上去。所以这里必须做到两件事：
 *   ① 原样渲染出一个**空的** `<div class="settings-pane" data-cat="about" />` —— 里面一个子
 *      节点都不能放（会被那个岛清掉），React 也不能在后续渲染里动它的 DOM 子树。React 对
 *      「没有 children 的宿主元素」不会去碰它的子节点，所以只要**始终**渲染这个 div、
 *      不给它 children、不改变它在兄弟中的位置，它的内容就一直是那个岛的；
 *   ② 让它在**模块加载期就同步存在于 DOM 里** —— 见 mount() 的注释（flushSync）。
 * 分类切换（`.active`）走 React 的 className：切到「关于」时这个 div 会拿到 active，
 * 那个岛的面板跟着显示，与旧实现命令式切 class 等价。
 *
 * ── 页面骨架照抄 index.html，只换控件 ────────────
 * 布局类名原样保留（`.settings-layout` / `.settings-nav` / `.settings-nav-item` /
 * `.settings-panes` / `.settings-pane` / `.panel` / `.panel-head` / `.panel-body` /
 * `.head-actions` / `.settings-switches` / `.settings-state` / `.retention-list` /
 * `.retention-row` / `.retention-input` / `.unit` / `.hint` / `.retention-note` /
 * `.prompt-input` / `.tag-input` / `.tag-chip` / `.tag-x` / `.storage-line` /
 * `.storage-path` / `.storage-counts` / `.storage-count` / `.danger-zone` / `.io-result`），
 * 它们是这一页的排版而不是「组件」（样式在 ui/css/page-settings.css）。
 * 控件换组件库：原生 input → Input、原生 checkbox → Switch、原生 select → Select 一族、
 * button → Button、`.badge` → Badge、`#retention-modal` → Dialog。
 *
 * 三处细节：
 *   · 问号仍用 `[data-tip]`（10 条说明动辄几百字，tooltip.js 的自动增强仍在页面上跑，
 *     含 MutationObserver 接住 React 动态插入的元素）—— 不换成 Tooltip 是刻意的：换了要
 *     把十条长文各包一层组件，观感与行为却完全一样；
 *   · 数字框的宽度 / 居中 / 等宽数字写成工具类：组件库的 Input 自带 `w-full`（工具类带
 *     !important），page-settings.css 里 `.retention-input input[type="number"]` 的 92px
 *     只保得住 max-width，宽度得自己带（与任务面板的间隔框同一处理）；
 *   · 显隐一律**条件渲染**，不写 hidden / style.display —— 组件库的 Tailwind 工具类分层且
 *     带 !important，会压掉 tokens.css 里未分层的 `[hidden]{display:none!important}`。
 */

/* ─── 小组件 ───────────────────────────────── */

/** 三态徽章：`.badge`（检测中…）/ `.badge.ok` / `.badge.bad` → Badge 的 variant */
function StatusBadge({ tone, children }: { tone: 'idle' | 'ok' | 'bad'; children: React.ReactNode }) {
  const variant = tone === 'ok' ? 'success' : tone === 'bad' ? 'destructive' : 'outline'
  return <Badge variant={variant}>{children}</Badge>
}

type PanelHeadProps = {
  title: string
  /** 标题右侧问号的说明全文（沿用 `[data-tip]`） */
  tip?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
}

/** 面板标题栏：标题 + 问号 + 徽章 + 右侧操作（DOM 顺序与静态骨架一致） */
function PanelHead({ title, tip, badge, actions }: PanelHeadProps) {
  return (
    <div className='panel-head'>
      <h2>{title}</h2>
      {tip ? <span className='tip-q' data-tip={tip}></span> : null}
      {badge}
      {actions ? <div className='head-actions'>{actions}</div> : null}
    </div>
  )
}

type SwitchRowProps = {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (next: boolean) => void
}

/**
 * 一行开关。开关与文字同在一个 `<label class="switch">` 里（与旧模板同构）：Base UI 的
 * Switch 会渲染一个隐藏 checkbox，label 的原生激活行为照样把点击转给它 —— 点文字也能拨动。
 */
function SwitchRow({ id, label, checked, disabled, onCheckedChange }: SwitchRowProps) {
  return (
    <label className='switch'>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={next => onCheckedChange(next)} />
      <span>{label}</span>
    </label>
  )
}

type NumberRowProps = {
  field: NumberField
  /** 生效值；null = 没读到（输入框保持禁用，旧实现同） */
  value: number | null
  /** 面板忙碌（提交在途）：本次操作期间禁用，与旧实现置 DOM disabled 等价 */
  disabled: boolean
  onCommit: (raw: string) => Promise<void>
}

/**
 * 一行数字设置（保留期 / 重试 / 超时共用）。
 *
 * 未提交的编辑是**本组件的草稿**：聚焦时把生效值抄进草稿，失焦 / 回车提交，提交结束
 * （无论成败）把草稿收掉、显示回到生效值 —— 这就是旧实现那套「正在编辑的那一项不回填 +
 * 失败回滚 + 保存后按后端值规范化」的等价物，只是状态只存在于这一处。
 */
function NumberRow({ field, value, disabled, onCommit }: NumberRowProps) {
  const [draft, setDraft] = React.useState<string | null>(null)
  const text = draft !== null ? draft : value === null ? '' : String(value)

  async function commit(): Promise<void> {
    const raw = draft
    if (raw === null) return
    try { await onCommit(raw) } finally { setDraft(null) }
  }

  return (
    <div className='retention-row'>
      <label htmlFor={field.id}>{field.label}</label>
      <span className='retention-input'>
        <Input
          id={field.id}
          type='number'
          min={field.min}
          max={field.max}
          step={1}
          inputMode='numeric'
          className='w-[92px] max-w-[92px] text-center tabular-nums'
          value={text}
          disabled={disabled || value === null}
          onChange={event => setDraft(event.target.value)}
          onFocus={() => setDraft(String(value ?? ''))}
          onBlur={() => void commit()}
          // 回车等价于「失焦提交」：不同内核里 Enter 是否派发 change 并不一致，
          // 这里主动 blur 一次把它统一成「值已提交」这一条路径
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
        <span className='unit'>{field.unit}</span>
      </span>
      <div className='hint'>{field.hint}</div>
    </div>
  )
}

/** 数字面板的徽章：首屏「检测中…」、读到「已生效」、读不到「不可用」 */
function numericBadge(state: NumericState): React.ReactNode {
  if (state.status === 'ready') return <StatusBadge tone='ok'>已生效</StatusBadge>
  if (state.status === 'unavailable') return <StatusBadge tone='bad'>不可用</StatusBadge>
  return <StatusBadge tone='idle'>检测中…</StatusBadge>
}

/** 刷新按钮（无修饰的 button → Button 的 outline 档，与静态骨架的观感一致） */
function RefreshButton({ id, onClick }: { id: string; onClick: () => void }) {
  return <Button id={id} variant='outline' onClick={onClick}>刷新</Button>
}

/* ─── 通用分类 ─────────────────────────────── */

function GeneralPane({ snap }: { snap: SettingsSnapshot }) {
  const app = snap.app
  const appState = app.status === 'unavailable'
    ? STATES.appUnavailable
    : app.status === 'loading'
      ? STATES.appLoading
      : app.closeToTray ? STATES.appTrayOn : STATES.appTrayOff

  return (
    <>
      <section className='panel'>
        <PanelHead
          title='启动与托盘'
          tip={TIPS.tray}
          badge={app.status === 'ready'
            ? <StatusBadge tone='ok'>已应用</StatusBadge>
            : app.status === 'unavailable'
              ? <StatusBadge tone='bad'>不可用</StatusBadge>
              : <StatusBadge tone='idle'>检测中…</StatusBadge>}
        />
        <div className='panel-body'>
          <div className='settings-switches'>
            {/* 主进程没返回启动设置时开关仍可拨（照旧实现）：拨了直接发全量 patch，
                保存成功即回到「已应用」，不必让用户重开程序 */}
            <SwitchRow
              id='settings-close-to-tray'
              label='关闭窗口时最小化到托盘'
              checked={app.closeToTray}
              disabled={snap.busy === 'app'}
              onCheckedChange={next => void saveToggle('tray', next)}
            />
            <SwitchRow
              id='settings-autostart'
              label='开机自动启动'
              checked={app.autostart}
              disabled={snap.busy === 'app'}
              onCheckedChange={next => void saveToggle('autostart', next)}
            />
          </div>
          <div className='settings-state'>{appState}</div>
        </div>
      </section>

      <section className='panel'>
        <PanelHead title='计量单位' tip={TIPS.units} />
        <div className='panel-body'>
          <div className='settings-switches'>
            <SwitchRow
              id='settings-chinese-units'
              label='使用中文单位（亿 / 万）'
              checked={snap.unitsChinese}
              onCheckedChange={applyUnits}
            />
          </div>
          <div className='settings-state'>
            {snap.unitsChinese ? STATES.unitsOn : STATES.unitsOff}
          </div>
        </div>
      </section>
    </>
  )
}

/* ─── 网关分类 ─────────────────────────────── */

/** 「指定错误码直接换号」的标签输入（GitHub Topics 同款：徽章 + 行内输入框） */
function RetryCodesField({ codes, status, busy }: {
  codes: number[] | null
  status: LoadStatus
  busy: boolean
}) {
  const [text, setText] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  // 读不到重试设置时整框禁用（旧实现：field.disabled + .disabled 类 + 占位符换「—」）
  const locked = status === 'unavailable'

  return (
    <div className='retention-row'>
      <label htmlFor='settings-retry-no-codes-input'>指定错误码直接换号</label>
      <div className='retention-input'>
        {/* 点框体空白处 = 聚焦输入框（整框是一个输入控件的观感，旧实现同） */}
        <div
          className={locked ? 'tag-input disabled' : 'tag-input'}
          onClick={() => inputRef.current?.focus()}
        >
          {(codes || []).map(code => (
            <span className='tag-chip' key={code}>
              <span className='v'>{code}</span>
              {/* 徽章上的 ✕：小号圆角热区，悬停加深 —— 用组件库的小件档 + 语义色，
                  「能点删」的视觉暗示与旧实现一致 */}
              <Button
                type='button'
                variant='ghost'
                size='icon-2xs'
                className='tag-x text-muted-foreground hover:bg-destructive-soft hover:text-destructive'
                title={`删除 ${code}`}
                aria-label={`删除状态码 ${code}`}
                onClick={event => { event.stopPropagation(); void removeRetryCode(code) }}
              >
                ✕
              </Button>
            </span>
          ))}
          <Input
            ref={inputRef}
            id='settings-retry-no-codes-input'
            type='text'
            // 框的描边由外层 .tag-input 出，这里把组件库 Input 的边框 / 底色 / 内边距
            // 用工具类压平（.tag-input-field 的老规则是非分层的，压不过工具类）
            className='tag-input-field h-auto border-0 bg-transparent px-0 shadow-none focus:shadow-none'
            placeholder={locked ? '—' : '输入状态码，回车添加'}
            inputMode='numeric'
            autoComplete='off'
            value={text}
            disabled={locked || busy}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void addRetryCode(text)
                setText('') // 提交后立即清空输入框（旧实现同）
                return
              }
              // 与 GitHub Topics 一致：输入框为空时退格删掉最后一枚
              if (event.key === 'Backspace' && !text) void dropLastRetryCode()
            }}
          />
        </div>
      </div>
      <div className='hint'>{NOTES.retryCodes}</div>
    </div>
  )
}

/** 系统提示词：文件路径输入框（草稿机制与数字框同款，失焦 / 回车才提交） */
function PromptFileRow({ prompt, locked, busy }: {
  prompt: PromptState
  locked: boolean
  busy: boolean
}) {
  const [draft, setDraft] = React.useState<string | null>(null)

  async function commit(): Promise<void> {
    const raw = draft
    if (raw === null) return
    try { await savePromptFile(raw) } finally { setDraft(null) }
  }

  return (
    <div className='retention-row'>
      <label htmlFor='settings-prompt-file'>提示词文件</label>
      <span className='prompt-input'>
        <Input
          id='settings-prompt-file'
          type='text'
          placeholder='留空 = 用内置默认提示词'
          value={draft !== null ? draft : prompt.file}
          disabled={locked || busy}
          onChange={event => setDraft(event.target.value)}
          onFocus={() => setDraft(prompt.file)}
          onBlur={() => void commit()}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
      </span>
      <div className='hint'>{NOTES.promptFile}</div>
    </div>
  )
}

/** 提示词状态行：模式说明 + 来源与行数 + 文件读取告警 */
function promptStateText(prompt: PromptState): string {
  if (prompt.status === 'loading') return STATES.appLoading
  if (prompt.status === 'unavailable') return STATES.promptUnavailable
  const source = prompt.source === 'file'
    ? '提示词文件'
    : prompt.source === 'builtin'
      ? '内置默认提示词'
      : ''
  const parts: string[] = []
  if (prompt.mode === 'passthrough') {
    parts.push('客户端 system 原样出站（只靠指纹脱敏改写模板句）。')
  } else {
    parts.push(
      `${prompt.mode === 'custom' ? '替换' : '追加'}生效：上游收到的 system 来自${source}`
      + `${prompt.lines ? `（${prompt.lines} 行）` : ''}。`,
    )
  }
  if (prompt.fileError) parts.push(`⚠️ ${prompt.fileError}`)
  return parts.join('')
}

/** 降级行的说明：只在真的处于降级期时出现（平时它是一行与用户无关的状态噪音） */
function degradeHint(prompt: PromptState): string {
  return '已自动切换到最小中性提示词（撞了上游内容拦截，多半是 system 指纹误报），'
    + `到 ${prompt.degradeUntilText || STATES.degradeUntilFallback} 自动解除。`
    + '期间本模式自己的提示词不会发出；把提示词改好后可以立即解除。'
}

function PromptPanel({ snap }: { snap: SettingsSnapshot }) {
  const prompt = snap.prompt
  const locked = prompt.status !== 'ready'
  const busy = snap.busy === 'prompt'
  const modeLabel = PROMPT_MODES.find(item => item.value === prompt.mode)?.optionLabel ?? prompt.mode

  return (
    <section className='panel'>
      <PanelHead
        title='系统提示词'
        tip={TIPS.prompt}
        badge={prompt.status === 'ready'
          ? <StatusBadge tone='ok'>{prompt.mode === 'passthrough' ? '透传' : '已接管'}</StatusBadge>
          : prompt.status === 'unavailable'
            ? <StatusBadge tone='bad'>不可用</StatusBadge>
            : <StatusBadge tone='idle'>检测中…</StatusBadge>}
        actions={<RefreshButton id='btn-prompt-refresh' onClick={() => void refreshPrompt()} />}
      />
      <div className='panel-body'>
        <div className='retention-list'>
          <div className='retention-row'>
            <label htmlFor='settings-prompt-mode'>模式</label>
            <span className='prompt-input'>
              {/* 旧实现是原生 <select>（select.js 增强 + wbSelect.sync）；这里换成组件库的
                  Select：触发器是按钮，page-settings.css 的 `.prompt-input select{width:240px}`
                  不再命中，宽度得用工具类补回（否则触发器按内容宽度缩成一团）。
                  展示文案显式给 SelectValue，不依赖 value 自动显示。 */}
              <Select value={prompt.mode} onValueChange={next => void savePromptMode(String(next))}>
                <SelectTrigger
                  id='settings-prompt-mode'
                  className='w-[240px]'
                  disabled={locked || busy}
                  aria-label='系统提示词模式'
                >
                  <SelectValue>{modeLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_MODES.map(item => (
                    <SelectItem key={item.value} value={item.value}>{item.optionLabel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
            <div className='hint'>{NOTES.promptMode}</div>
          </div>

          <PromptFileRow prompt={prompt} locked={locked} busy={busy} />

          {/* 降级行只在真的处于降级期时渲染（旧实现是切 hidden） */}
          {prompt.status === 'ready' && prompt.degradeActive ? (
            <div className='retention-row'>
              <label>内容拦截降级</label>
              <span className='prompt-input'>
                <Button
                  id='btn-prompt-clear-degrade'
                  variant='outline'
                  disabled={busy}
                  onClick={() => void clearDegrade()}
                >
                  立即解除
                </Button>
              </span>
              <div className='hint'>{degradeHint(prompt)}</div>
            </div>
          ) : null}
        </div>
        <div className='settings-state'>{promptStateText(prompt)}</div>
        <div className='hint retention-note'>{NOTES.prompt}</div>
      </div>
    </section>
  )
}

/** 调试模式的状态行：条数只在后端给了两个整数时才提 */
function debugStateText(debug: DebugState): string {
  if (debug.status === 'loading') return STATES.appLoading
  if (debug.status === 'unavailable') return STATES.debugUnavailable
  const stored = debug.count !== null && debug.limit !== null
    ? `已保存 ${debug.count} / ${debug.limit} 条报文（超出后丢弃最旧的）。`
    : ''
  return debug.on ? `${STATES.debugOn}${stored}凭据类请求头已脱敏。` : STATES.debugOff
}

function GatewayPane({ snap }: { snap: SettingsSnapshot }) {
  return (
    <>
      <section className='panel'>
        <PanelHead
          title='请求超时'
          tip={TIPS.timeouts}
          badge={numericBadge(snap.timeouts)}
          actions={<RefreshButton id='btn-timeouts-refresh' onClick={() => void refreshTimeouts()} />}
        />
        <div className='panel-body'>
          <div className='retention-list'>
            {TIMEOUT_FIELDS.map(field => (
              <NumberRow
                key={field.key}
                field={field}
                value={snap.timeouts.values?.[field.key] ?? null}
                disabled={snap.busy === 'timeouts'}
                onCommit={raw => saveTimeoutField(field, raw)}
              />
            ))}
          </div>
          <div className='hint retention-note'>{NOTES.timeouts}</div>
        </div>
      </section>

      <section className='panel'>
        <PanelHead
          title='排队等待'
          tip={TIPS.queue}
          badge={numericBadge(snap.queue)}
          actions={<RefreshButton id='btn-queue-refresh' onClick={() => void refreshQueue()} />}
        />
        <div className='panel-body'>
          <div className='retention-list'>
            {QUEUE_FIELDS.map(field => (
              <NumberRow
                key={field.key}
                field={field}
                value={snap.queue.values?.[field.key] ?? null}
                disabled={snap.busy === 'queue'}
                onCommit={raw => saveQueueField(field, raw)}
              />
            ))}
          </div>
          <div className='hint retention-note'>{NOTES.queue}</div>
        </div>
      </section>

      <section className='panel'>
        <PanelHead
          title='请求重试'
          tip={TIPS.retry}
          badge={numericBadge(snap.retry)}
          actions={<RefreshButton id='btn-retry-refresh' onClick={() => void refreshRetry()} />}
        />
        <div className='panel-body'>
          <div className='retention-list'>
            {RETRY_FIELDS.map(field => (
              <NumberRow
                key={field.key}
                field={field}
                value={snap.retry.values?.[field.key] ?? null}
                disabled={snap.busy === 'retry'}
                onCommit={raw => saveRetryField(field, raw)}
              />
            ))}
            <RetryCodesField
              codes={snap.retryCodes}
              status={snap.retry.status}
              busy={snap.busy === 'codes' || snap.busy === 'retry'}
            />
          </div>
          <div className='hint retention-note'>{NOTES.retry}</div>
        </div>
      </section>

      <section className='panel'>
        <PanelHead
          title='指纹脱敏'
          tip={TIPS.sanitize}
          badge={snap.sanitize.status === 'ready'
            ? <StatusBadge tone='ok'>已生效</StatusBadge>
            : snap.sanitize.status === 'unavailable'
              ? <StatusBadge tone='bad'>不可用</StatusBadge>
              : <StatusBadge tone='idle'>检测中…</StatusBadge>}
          actions={<RefreshButton id='btn-sanitize-refresh' onClick={() => void refreshSanitize()} />}
        />
        <div className='panel-body'>
          <div className='settings-switches'>
            <SwitchRow
              id='settings-sanitize'
              label='剥离上游审核黑名单指纹（改写请求体里的模板句与表头）'
              checked={snap.sanitize.on}
              // 读到后端值之前不许切（否则会出现「切了但不知道后端原本是什么」，回滚也没依据）
              disabled={snap.sanitize.status !== 'ready' || snap.busy === 'sanitize'}
              onCheckedChange={next => void saveSanitize(next)}
            />
          </div>
          <div className='settings-state'>
            {snap.sanitize.status === 'loading'
              ? STATES.appLoading
              : snap.sanitize.status === 'unavailable'
                ? STATES.sanitizeUnavailable
                : snap.sanitize.on ? STATES.sanitizeOn : STATES.sanitizeOff}
          </div>
          <div className='hint retention-note'>{NOTES.sanitize}</div>
        </div>
      </section>

      <PromptPanel snap={snap} />

      <section className='panel'>
        <PanelHead
          title='调试模式'
          tip={TIPS.debug}
          badge={snap.debug.status === 'ready'
            ? <StatusBadge tone='ok'>已生效</StatusBadge>
            : snap.debug.status === 'unavailable'
              ? <StatusBadge tone='bad'>不可用</StatusBadge>
              : <StatusBadge tone='idle'>检测中…</StatusBadge>}
          actions={<RefreshButton id='btn-debug-refresh' onClick={() => void refreshDebug()} />}
        />
        <div className='panel-body'>
          <div className='settings-switches'>
            <SwitchRow
              id='settings-debug-mode'
              label='保存上游原始报文（请求头、请求体、响应头、响应体）'
              checked={snap.debug.on}
              disabled={snap.debug.status !== 'ready' || snap.busy === 'debug'}
              onCheckedChange={next => void saveDebug(next)}
            />
          </div>
          <div className='settings-state'>{debugStateText(snap.debug)}</div>
          <div className='hint retention-note'>{NOTES.debug}</div>
        </div>
      </section>
    </>
  )
}

/* ─── 安全分类 ─────────────────────────────── */

function SecurityPane({ snap }: { snap: SettingsSnapshot }) {
  // 「退出登录」成功后整页跳回登录页，那时组件已不在；只有失败才需要把按钮解禁
  const [loggingOut, setLoggingOut] = React.useState(false)

  async function onLogout(): Promise<void> {
    setLoggingOut(true)
    const ok = await panelLogout()
    if (!ok) setLoggingOut(false)
  }

  return (
    <>
      <section className='panel'>
        <PanelHead title='机器人校验' />
        <div className='panel-body'>
          <SwitchRow
            id='settings-captcha'
            label='登录 / 注册需要通过 ALTCHA 人机验证（工作量证明）'
            checked={snap.captcha.enabled}
            disabled={!snap.captcha.available || snap.busy === 'captcha'}
            onCheckedChange={next => void saveCaptcha(next)}
          />
          <div className='hint'>{NOTES.captcha}</div>
        </div>
      </section>

      {/* 面板登录：仅网页端（桌面壳的面板跟着应用走，没有「登录面板」的概念） */}
      {snap.panelLogin ? (
        <section className='panel' id='panel-login-section'>
          <PanelHead title='面板登录' />
          <div className='panel-body'>
            <div className='hint'>{NOTES.panelLogin}</div>
            <div className='mt-2.5'>
              <Button
                id='btn-panel-logout'
                variant='outline'
                disabled={loggingOut}
                onClick={() => void onLogout()}
              >
                退出登录
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}

/* ─── 数据分类 ─────────────────────────────── */

/** 数据存储面板的一格计数（键在上、值在下） */
function StorageCount({ label, value }: { label: string; value: string }) {
  return (
    <div className='storage-count'>
      <span className='k'>{label}</span>
      <span className='v'>{value}</span>
    </div>
  )
}

function storageBadge(state: StorageState): React.ReactNode {
  if (state.status === 'loading') return <StatusBadge tone='idle'>检测中…</StatusBadge>
  if (state.status === 'unavailable') return <StatusBadge tone='bad'>不可用</StatusBadge>
  // 「数据库不可用」是读到了概况但库打不开，与「读不到」不是一回事（旧实现同）
  return <StatusBadge tone={state.available ? 'ok' : 'bad'}>
    {state.available ? '已生效' : '数据库不可用'}
  </StatusBadge>
}

function DataPane({ snap }: { snap: SettingsSnapshot }) {
  const io = snap.busy
  const storage = snap.storage
  // 库打不开时各计数都是后端回落出来的 0，与「真的没有数据」在数字上无法区分 ——
  // 整排显示「—」，不误导用户以为数据丢了；路径仍然照显（文件位置是已知的）
  const ready = storage.status === 'ready'
  const counts = ready && storage.available
  const path = ready && storage.file ? storage.file : '—'
  const count = (value: number | null): string => (counts && value !== null ? formatCount(value) : '—')

  return (
    <>
      <section className='panel'>
        <PanelHead
          title='账号导入 / 导出'
          tip={TIPS.io}
          actions={
            <>
              {/* 忙碌守卫与旧实现的 guard() 同形：点下去的那个按钮禁用并换文案，
                  另一个保持可点但会被守卫挡下 */}
              <Button
                id='btn-settings-export'
                variant='outline'
                disabled={io === 'export'}
                onClick={() => void exportAccounts()}
              >
                {io === 'export' ? '导出中…' : '导出账号'}
              </Button>
              <Button
                id='btn-settings-import'
                variant='default'
                disabled={io === 'import'}
                onClick={() => void importAccounts()}
              >
                {io === 'import' ? '导入中…' : '导入账号'}
              </Button>
            </>
          }
        />
        <div className='panel-body'>
          <div className='danger-zone'>
            <strong>导出文件内含 accessToken / refreshToken / apiKey 等凭证与自定义提供商定义</strong>
            ，可直接用于登录。请妥善保管，不要外传或上传到公共位置。
          </div>
          {/* 失败明细（旧实现写 innerHTML 并 display:none 收起空结果，这里条件渲染） */}
          {snap.ioFailure ? (
            <div className='io-result'>
              <span className='text-destructive'>
                失败 {snap.ioFailure.failed} 个：{snap.ioFailure.detail}
                {snap.ioFailure.more ? ' 等' : ''}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <section className='panel'>
        <PanelHead
          title='数据保留'
          tip={TIPS.retention}
          badge={numericBadge(snap.retention)}
          actions={<RefreshButton id='btn-retention-refresh' onClick={() => void refreshRetention()} />}
        />
        <div className='panel-body'>
          <div className='retention-list'>
            {RETENTION_FIELDS.map(field => (
              <NumberRow
                key={field.key}
                field={field}
                value={snap.retention.values?.[field.key] ?? null}
                disabled={snap.busy === 'retention'}
                onCommit={raw => saveRetentionField(field, raw)}
              />
            ))}
          </div>
          <div className='hint retention-note'>{NOTES.retention}</div>
        </div>
      </section>

      <section className='panel'>
        <PanelHead
          title='数据存储'
          tip={TIPS.storage}
          badge={storageBadge(storage)}
          actions={<RefreshButton id='btn-storage-refresh' onClick={() => void refreshStorage()} />}
        />
        <div className='panel-body'>
          <div className='retention-list'>
            <div className='retention-row'>
              <label htmlFor='storage-db-path'>数据库文件</label>
              <span className='storage-line'>
                {/* 悬停看完整路径（元素上是折行显示的，长路径会被截成好几行） */}
                <span className='storage-path' id='storage-db-path' title={path}>{path}</span>
              </span>
              <div className='hint'>{NOTES.storageFile}</div>
            </div>
            <div className='retention-row'>
              <label htmlFor='storage-db-size'>占用大小</label>
              <span className='storage-line'>
                <span className='storage-path' id='storage-db-size'>
                  {counts ? formatBytes(storage.bytes) : '—'}
                </span>
              </span>
              <div className='hint'>{NOTES.storageSize}</div>
            </div>
          </div>
          <div className='retention-list storage-counts'>
            <StorageCount label='账号' value={count(storage.accounts)} />
            <StorageCount label='事件日志' value={count(storage.logs)} />
            <StorageCount label='请求记录' value={count(storage.requests)} />
            <StorageCount label='报表天数' value={count(storage.dailyDays)} />
            <StorageCount label='调试报文' value={count(storage.debug)} />
          </div>
          <div className='hint retention-note'>{NOTES.storage}</div>
        </div>
      </section>
    </>
  )
}

/* ─── 保留期改小的确认框 ───────────────────── */

/**
 * 缩短保留天数的二次确认（旧实现是 index.html 的 `#retention-modal` + 一堆 class 开关）。
 *
 * 用 Dialog 而不是 AlertDialog：旧实现的五条出口（确认 / 取消 / 右上角 ✕ / 点遮罩 / Esc）里
 * 有四条都算「取消」，即它是**可以糊弄过去**的普通弹窗，不是 AlertDialog 那种必须表态的框。
 * 焦点落在「取消」而不是危险键：这是不可恢复的删除操作，敲回车不该等于同意删除。
 */
function RetentionConfirmDialog({ confirm }: { confirm: { head: string } | null }) {
  const cancelRef = React.useRef<HTMLButtonElement | null>(null)

  return (
    <Dialog open={confirm !== null} onOpenChange={next => { if (!next) resolveRetentionConfirm(false) }}>
      {/* 旧 .modal-confirm 把宽度收到 440px（这类框只有一段话加两个按钮，620px 太宽） */}
      <DialogContent className='w-[min(440px,calc(100vw-48px))]' initialFocus={cancelRef}>
        <DialogHeader>
          <DialogTitle>确认缩短保留天数</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className='danger-zone'>
            {confirm?.head}
            <br />
            <strong>超出的历史数据会被立即删除，且不可恢复。</strong>确定继续？
          </div>
        </DialogBody>
        <DialogFooter>
          <div className='mr-auto' />
          <Button ref={cancelRef} variant='outline' onClick={() => resolveRetentionConfirm(false)}>
            取消
          </Button>
          <Button variant='destructive' onClick={() => resolveRetentionConfirm(true)}>
            继续并清理
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── 页面 ─────────────────────────────────── */

function SettingsPage() {
  const snap = useSettings()
  const panesRef = React.useRef<HTMLDivElement | null>(null)

  // 切换分类后把内容栏滚回顶部（旧实现是命令式写 scrollTop）：否则上一类的滚动位置会
  // 带到新分类上，打开「关于」却停在半截。scrollReset 每次 showCategory 都递增，
  // 于是「切回同一分类」（页面重入时 load → restoreCategory）同样会滚回顶部。
  React.useEffect(() => {
    const panes = panesRef.current
    if (panes) panes.scrollTop = 0
  }, [snap.scrollReset])

  const paneClass = (cat: string): string => (snap.category === cat ? 'settings-pane active' : 'settings-pane')

  return (
    <div className='settings-layout'>
      <nav className='settings-nav' id='settings-nav'>
        {CATEGORIES.map(item => (
          <button
            key={item.id}
            type='button'
            className={snap.category === item.id ? 'settings-nav-item active' : 'settings-nav-item'}
            data-cat={item.id}
            onClick={() => selectCategory(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className='settings-panes' ref={panesRef}>
        <div className={paneClass('general')} data-cat='general'>
          <GeneralPane snap={snap} />
        </div>
        <div className={paneClass('gateway')} data-cat='gateway'>
          <GatewayPane snap={snap} />
        </div>
        <div className={paneClass('security')} data-cat='security'>
          <SecurityPane snap={snap} />
        </div>
        <div className={paneClass('data')} data-cat='data'>
          <DataPane snap={snap} />
        </div>
        {/*
          「关于」的面板由另一个岛（update-panel.tsx）接管：它按这个选择器找挂载点，
          找到就把 React root 建在这个 div 上。所以这里必须是**空的**、且永远保持同一个
          元素（不给 children、不改它在兄弟中的位置、不条件渲染）——
          React 对没有 children 的宿主元素不会去动它的 DOM 子树，那个岛的渲染结果才留得住。
          显隐照旧：className 上的 active 由本文件按当前分类切。
        */}
        <div className={paneClass('about')} data-cat='about' />
      </div>

      <RetentionConfirmDialog confirm={snap.retentionConfirm} />
    </div>
  )
}

/* ─── 挂载：接管 index.html 里既有的设置页 section ─── */

const PAGE_SELECTOR = '.page[data-page="settings"]'

let pageRoot: ReturnType<typeof createRoot> | null = null

/**
 * 把 React root 直接建在 `.page[data-page="settings"]` 上（不套宿主 div：页面 CSS 用
 * `.page[data-page="settings"]` 的直接子选择器分配高度与滚动归属）。
 *
 * ── 为什么必须 flushSync ──────────────────────
 * `.settings-pane[data-cat="about"]` 是 update-panel.tsx 的挂载点，它在**自己的模块加载期**
 * 就 `document.querySelector` 这个选择器，找到才建 root。React 19 的 `createRoot().render()`
 * 是并发调度，提交可能落在下一个宏任务 —— 那一刻这个 pane 还没进 DOM，update-panel 只会
 * 退化成等 DOMContentLoaded，而那时它早已过了注册窗口，「设置 → 关于」会整块空白。
 * 两个岛的求值顺序由 glob 的文件名字典序决定（settings-page.tsx 排在 update-panel.tsx 前），
 * 所以这里同步提交之后，它一定能查到。
 *
 * 先 replaceChildren()：React 不替我们清容器，留着静态骨架会与它的接管打架。
 */
function mount(): void {
  if (pageRoot) return
  const section = document.querySelector<HTMLElement>(PAGE_SELECTOR)
  if (!section) return
  section.replaceChildren()
  pageRoot = createRoot(section)
  flushSync(() => { pageRoot?.render(<SettingsPage />) })
}

// 首屏就按上次的选择展开（旧实现在模块加载期做同一件事），不必等 load() 回来；
// load() 里还会再校准一次，覆盖「页面切回来时状态被重置」的情况。
restoreCategory()

// 脚本排在页面骨架之后（index.html 里 islands/ui.js 在各 section 之后），正常直接挂；
// 万一将来被挪到前面，退化成等 DOM 解析完再挂。
if (document.querySelector(PAGE_SELECTOR)) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })

/* ─── 注册：对外契约 ─────────────────────────── */

declare global {
  interface Window {
    /**
     * 设置页（替换 ui/settings-panel.js，九个方法与原实现逐字一致）。
     * 调用点：app.js:135 切到设置页时 load()；upgrade-panel.js:74 迁移完成后 load()；
     * update-panel.tsx:972 的「去更新」showCategory('about')。
     */
    wbSettingsPanel?: {
      load(): Promise<void>
      /** 铺启动与托盘设置（旧实现叫 renderSettings，对外名字是 render） */
      render(data?: unknown): void
      renderRetention(data?: unknown): void
      renderRetry(data?: unknown): void
      renderDebug(data?: unknown): void
      renderSanitize(data?: unknown): void
      renderPrompt(data?: unknown): void
      renderStorage(data?: unknown): void
      showCategory(category?: string | null): void
    }
  }
}

window.wbSettingsPanel = {
  load,
  render: renderSettings,
  renderRetention,
  renderRetry,
  renderDebug,
  renderSanitize,
  renderPrompt,
  renderStorage,
  showCategory,
}

// 首屏自持加载：app.js 的 showPage 在脚本加载前已执行过，若上次停留在设置页，
// 这里补一次加载，避免徽标一直停在「检测中…」
if (shared().wbApp?.currentPage === 'settings') void load()
