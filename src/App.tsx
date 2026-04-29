import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BadgeDollarSign,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Goal,
  LayoutGrid,
  LogOut,
  MoonStar,
  PencilLine,
  PiggyBank,
  ReceiptText,
  RefreshCw,
  Repeat2,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  UserCircle2,
  UserPlus,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { compactDate, currency, todayIso } from './lib/format'
import { exportBudgetToExcel, exportBudgetToPdf } from './lib/export'
import { useBudgetData } from './hooks/useBudgetData'
import { supabase, supabaseEnabled } from './lib/supabase'
import type {
  Account,
  AssetItem,
  AssetType,
  BudgetCategory,
  NavKey,
  RecurringFrequency,
  RecurringTransaction,
  SavingGoal,
  ThemeMode,
  TransactionItem,
  TransactionType,
} from './types'

const baseNavItems = [
  { key: 'home', label: 'Ringkas', icon: LayoutGrid },
  { key: 'history', label: 'Riwayat', icon: ReceiptText },
  { key: 'add', label: 'Catat', icon: BadgeDollarSign },
  { key: 'budget', label: 'Anggaran', icon: Target },
  { key: 'wallet', label: 'Dompet', icon: Wallet },
  { key: 'asset', label: 'Aset', icon: CircleDollarSign },
  { key: 'profile', label: 'Profil', icon: UserCircle2 },
] as const

const adminNavItem = { key: 'setup', label: 'Admin', icon: Settings } as const

const transactionIcons: Record<TransactionType, typeof ArrowUpRight> = {
  expense: ArrowUpRight,
  income: ArrowDownLeft,
  transfer: ArrowRightLeft,
}

type AuthFeedback = {
  tone: 'idle' | 'loading' | 'success' | 'error'
  text: string
}

type HistoryFilters = {
  type: 'all' | TransactionType
  query: string
  account: string
  category: string
  member: string
  startDate: string
  endDate: string
}

const themeStorageKey = 'mybudget:theme-mode'

function toFriendlyAuthMessage(message: string, mode: 'login' | 'register') {
  const text = message.toLowerCase()

  if (text.includes('email not confirmed')) return 'Email belum aktif. Cek inbox lalu verifikasi dulu.'
  if (text.includes('invalid login credentials')) return 'Email atau password belum cocok.'
  if (text.includes('user already registered')) return 'Email ini sudah terdaftar.'
  if (text.includes('password should be at least')) return 'Password minimal 6 karakter.'
  if (text.includes('unable to validate email address')) return 'Format email belum benar.'
  if (text.includes('signup is disabled')) return 'Pendaftaran sedang ditutup.'
  if (text.includes('network')) return 'Koneksi bermasalah. Silakan coba kembali.'

  return mode === 'login' ? 'Belum bisa masuk sekarang.' : 'Belum bisa daftar sekarang.'
}

function defaultTransactionDraft(accounts: string[], categories: string[], member: string): Omit<TransactionItem, 'id'> {
  return {
    title: '',
    amount: 0,
    type: 'expense',
    category: categories[0] ?? 'Umum',
    account: accounts[0] ?? '',
    toAccount: accounts[1] ?? accounts[0] ?? '',
    member,
    date: todayIso(),
    note: '',
  }
}

function defaultRecurringDraft(accounts: string[], categories: string[], member: string): Omit<RecurringTransaction, 'id' | 'lastCreatedAt'> {
  return {
    ...defaultTransactionDraft(accounts, categories, member),
    frequency: 'monthly',
    nextDate: todayIso(),
  }
}

function defaultGoalDraft(accounts: string[]): Omit<SavingGoal, 'id'> {
  return {
    name: '',
    target: 0,
    saved: 0,
    account: accounts[0] ?? '',
    note: '',
  }
}

function defaultAssetDraft(): Omit<AssetItem, 'id'> {
  return {
    name: '',
    type: 'deposito',
    initialAmount: 0,
    currentValue: 0,
    startDate: todayIso(),
    tenorMonths: 12,
    interestRate: 0,
    maturityDate: '',
    estimatedReturn: 0,
    note: '',
  }
}

function readThemeMode() {
  if (typeof window === 'undefined') return 'default' as ThemeMode
  return (window.localStorage.getItem(themeStorageKey) as ThemeMode | null) ?? 'default'
}

function resolveTheme(mode: ThemeMode) {
  if (mode === 'dark') return 'dark'
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function budgetAlert(item: BudgetCategory) {
  if (!item.limit) {
    return { tone: 'safe', label: 'Belum ada limit', percent: 0 }
  }

  const percent = Math.round((item.spent / item.limit) * 100)
  if (percent >= 100) return { tone: 'danger', label: 'Sudah lewat batas', percent }
  if (percent >= 90) return { tone: 'danger', label: 'Hampir habis', percent }
  if (percent >= 80) return { tone: 'warning', label: 'Perlu perhatian', percent }
  return { tone: 'safe', label: 'Masih aman', percent }
}

function uniqueValues(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[]))
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [demoProfileName, setDemoProfileName] = useState('Demo User')
  const [activeTab, setActiveTab] = useState<NavKey>('home')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback>({ tone: 'idle', text: '' })
  const [authLoading, setAuthLoading] = useState(false)
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode)
  const [filters, setFilters] = useState<HistoryFilters>({
    type: 'all',
    query: '',
    account: 'all',
    category: 'all',
    member: 'all',
    startDate: '',
    endDate: '',
  })
  const [editingTransaction, setEditingTransaction] = useState<TransactionItem | null>(null)
  const [editingRecurring, setEditingRecurring] = useState<RecurringTransaction | null>(null)
  const [editingBudget, setEditingBudget] = useState<BudgetCategory | null>(null)
  const [editingGoal, setEditingGoal] = useState<SavingGoal | null>(null)
  const [editingAsset, setEditingAsset] = useState<AssetItem | null>(null)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(themeStorageKey, themeMode)
    const resolved = resolveTheme(themeMode)
    document.documentElement.dataset.theme = resolved
    document.documentElement.dataset.themeMode = themeMode
  }, [themeMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (themeMode !== 'default') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
    }

    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [themeMode])

  const appUserId = session?.user.id ?? (demoMode ? 'demo-user' : undefined)
  const appUserEmail = session?.user.email ?? (demoMode ? 'demo@mybudget.local' : undefined)

  const {
    data,
    loading,
    summary,
    recurringTransactions,
    savingGoals,
    assets,
    dueRecurringCount,
    addAccount,
    addMember,
    deleteMember,
    addBudget,
    updateBudget,
    addTransaction,
    updateTransaction,
    updatePeriod,
    applyBudgetRollover,
    deleteTransaction,
    addRecurringTransaction,
    updateRecurringTransaction,
    deleteRecurringTransaction,
    createTransactionFromRecurring,
    addSavingGoal,
    updateSavingGoal,
    deleteSavingGoal,
    addAsset,
    updateAsset,
    deleteAsset,
  } = useBudgetData(appUserId, appUserEmail, demoMode)

  const isSeedAdmin = session?.user.email?.toLowerCase() === 'admin@kunci.cloud'
  const currentMember = data.members.find((item) => item.email.toLowerCase() === appUserEmail?.toLowerCase())
  const isAdmin = isSeedAdmin || currentMember?.role.toLowerCase() === 'admin'
  const canUseApp = demoMode || !supabaseEnabled || !session || loading || isSeedAdmin || Boolean(currentMember)
  const navItems = isAdmin ? [adminNavItem] : baseNavItems
  const userName =
    (demoMode ? demoProfileName : undefined) ??
    session?.user.user_metadata.full_name ??
    session?.user.user_metadata.name ??
    currentMember?.name ??
    session?.user.email?.split('@')[0] ??
    'Pengguna'

  const memberOptions = useMemo(() => uniqueValues([userName, ...data.members.map((item) => item.name)]), [data.members, userName])
  const chartData = data.budgets.map((item) => ({ name: item.name, value: item.spent, color: item.color }))
  const recentTransactions = useMemo(() => data.transactions.slice(0, 8), [data.transactions])
  const totalSaved = Math.max(summary.totalIncome - summary.totalExpense, 0)
  const alerts = useMemo(
    () =>
      data.budgets
        .map((item) => ({ ...budgetAlert(item), budget: item }))
        .filter((item) => item.tone !== 'safe')
        .sort((a, b) => b.percent - a.percent),
    [data.budgets],
  )
  const goalsSummary = useMemo(
    () =>
      savingGoals.map((goal) => ({
        ...goal,
        progress: goal.target ? Math.min((goal.saved / goal.target) * 100, 100) : 0,
        remaining: Math.max(goal.target - goal.saved, 0),
      })),
    [savingGoals],
  )
  const assetSummary = useMemo(() => {
    const totalInitial = assets.reduce((sum, item) => sum + item.initialAmount, 0)
    const totalCurrent = assets.reduce((sum, item) => sum + item.currentValue, 0)
    const totalEstimate = assets.reduce((sum, item) => sum + (item.estimatedReturn ?? 0), 0)
    const dueDeposits = assets.filter((item) => item.type === 'deposito' && item.maturityDate && item.maturityDate <= todayIso()).length

    return { totalInitial, totalCurrent, totalEstimate, dueDeposits }
  }, [assets])

  useEffect(() => {
    if (isAdmin && activeTab !== 'setup') {
      setActiveTab('setup')
      return
    }

    if (!isAdmin && activeTab === 'setup') {
      setActiveTab('home')
    }
  }, [activeTab, isAdmin])

  const filteredTransactions = useMemo(() => {
    return data.transactions.filter((item) => {
      if (filters.type !== 'all' && item.type !== filters.type) return false

      const q = filters.query.trim().toLowerCase()
      if (q && ![item.title, item.category, item.account, item.toAccount, item.member, item.note].join(' ').toLowerCase().includes(q)) {
        return false
      }

      if (filters.account !== 'all') {
        const matchesAccount = item.account === filters.account || item.toAccount === filters.account
        if (!matchesAccount) return false
      }

      if (filters.category !== 'all' && item.category !== filters.category) return false
      if (filters.member !== 'all' && item.member !== filters.member) return false
      if (filters.startDate && item.date < filters.startDate) return false
      if (filters.endDate && item.date > filters.endDate) return false

      return true
    })
  }, [data.transactions, filters])

  const exportPayload = useMemo(
    () => ({
      period: data.period,
      budgets: data.budgets,
      transactions: filteredTransactions,
      summary,
      ownerName: userName,
    }),
    [data.period, data.budgets, filteredTransactions, summary, userName],
  )

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthLoading(true)
    setAuthFeedback({ tone: 'loading', text: 'Lagi masuk...' })

    if (!supabaseEnabled || !supabase) {
      setAuthFeedback({ tone: 'error', text: 'Belum bisa masuk sekarang.' })
      setAuthLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authForm.email,
        password: authForm.password,
      })

      if (error) {
        setAuthFeedback({ tone: 'error', text: toFriendlyAuthMessage(error.message, 'login') })
      } else {
        setAuthFeedback({ tone: 'success', text: 'Berhasil masuk.' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setAuthFeedback({ tone: 'error', text: toFriendlyAuthMessage(message, 'login') })
    }

    setAuthLoading(false)
  }

  const clearEditors = () => {
    setEditingTransaction(null)
    setEditingRecurring(null)
    setEditingBudget(null)
    setEditingGoal(null)
    setEditingAsset(null)
  }

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut()
    }

    setDemoMode(false)
    setDemoProfileName('Demo User')
    setSession(null)
    clearEditors()
  }

  const openDemo = () => {
    setDemoMode(true)
    setDemoProfileName('Demo User')
    setActiveTab('home')
    setAuthFeedback({ tone: 'success', text: 'Akun demo siap digunakan.' })
  }

  const updateProfileName = async (name: string) => {
    const cleanName = name.trim()
    if (!cleanName) return { ok: false, message: 'Nama jangan dikosongkan.' }

    if (demoMode) {
      setDemoProfileName(cleanName)
      return { ok: true, message: 'Nama sudah diganti.' }
    }

    if (!supabase) return { ok: false, message: 'Nama belum bisa diubah.' }

    const { data: updated, error } = await supabase.auth.updateUser({
      data: { full_name: cleanName },
    })

    if (error) return { ok: false, message: 'Nama belum berhasil diubah.' }

    if (updated.user && session) {
      setSession({ ...session, user: updated.user })
    }

    return { ok: true, message: 'Nama sudah diganti.' }
  }

  const updateProfilePassword = async (password: string) => {
    const cleanPassword = password.trim()
    if (cleanPassword.length < 6) return { ok: false, message: 'Password minimal 6 karakter.' }
    if (demoMode) return { ok: true, message: 'Password akun demo sudah diubah.' }
    if (!supabase) return { ok: false, message: 'Password belum bisa diubah.' }

    const { error } = await supabase.auth.updateUser({ password: cleanPassword })
    if (error) return { ok: false, message: 'Password belum berhasil diubah.' }

    return { ok: true, message: 'Password sudah diganti.' }
  }

  if (!session && !demoMode && supabaseEnabled) {
    return (
      <div className="shell auth-shell">
        <section className="auth-card">
          <div className="brand-lockup">
            <div className="brand-badge">
              <Wallet size={28} />
            </div>
            <div>
              <p className="eyebrow">MyBudget</p>
              <h1>Kelola keuangan dengan rapi</h1>
            </div>
          </div>

          <p className="auth-copy">Masuk untuk mengelola catatan, anggaran, dompet, aset, dan laporan keuangan.</p>

          <form className="auth-form" onSubmit={handleAuth}>
            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="nama@email.com"
              />
            </label>

            <PasswordField
              label="Password"
              value={authForm.password}
              onChange={(value) => setAuthForm((prev) => ({ ...prev, password: value }))}
              placeholder="Minimal 6 karakter"
              visible={showLoginPassword}
              onToggle={() => setShowLoginPassword((prev) => !prev)}
            />

            <button className="primary-button" disabled={authLoading}>
              {authLoading ? 'Memproses...' : 'Masuk'}
            </button>

            <button type="button" className="demo-login-button" onClick={openDemo}>
              Akun demo
            </button>
          </form>

          {authFeedback.text && (
            <div className={`auth-feedback ${authFeedback.tone}`}>
              <strong>
                {authFeedback.tone === 'loading'
                  ? 'Sedang diproses'
                  : authFeedback.tone === 'error'
                    ? 'Belum berhasil'
                    : authFeedback.tone === 'success'
                      ? 'Berhasil'
                      : 'Informasi'}
              </strong>
              <p>{authFeedback.text}</p>
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="shell">
      <main className="phone-frame">
        <header className="app-header">
          <div className="brand-row">
            <div className="brand-mark">
              <Wallet size={18} />
            </div>
            <div>
              <h1>MyBudget</h1>
              <p>{isAdmin ? 'Kelola akses tim' : userName}</p>
            </div>
          </div>

          <div className="header-actions">
            <button className="header-button" onClick={() => window.location.reload()} aria-label="Muat ulang">
              <RefreshCw size={17} />
            </button>
            {(session || demoMode) && (
              <button className="header-button" onClick={signOut} aria-label="Keluar">
                <LogOut size={18} />
              </button>
            )}
          </div>

          <div className="header-summary">
            <span>{data.period.label}</span>
            <strong>{data.period.start} sampai {data.period.end}</strong>
          </div>
        </header>

        <section className="content">
          {loading ? (
            <div className="card">Sedang menyiapkan data...</div>
          ) : !canUseApp ? (
            <section className="card access-card">
              <div className="section-title">
                <h2>Akun belum aktif</h2>
                <ShieldCheck size={18} />
              </div>
              <p className="helper-text">Minta admin menambahkan email ini sebagai anggota.</p>
              <button className="primary-button" onClick={signOut}>
                Keluar
              </button>
            </section>
          ) : (
            <>
              {activeTab === 'home' && !isAdmin && (
                <>
                  <section className="overview-strip">
                    <div>
                      <span>Transaksi</span>
                      <strong>{data.transactions.length}</strong>
                    </div>
                    <div>
                      <span>Anggaran rawan</span>
                      <strong>{alerts.length}</strong>
                    </div>
                    <div>
                      <span>Jadwal rutin</span>
                      <strong>{dueRecurringCount}</strong>
                    </div>
                  </section>

                  <section className="spotlight-card">
                    <div>
                      <span className="spotlight-label">Pengeluaran bulan ini</span>
                      <strong>{currency(summary.totalSpent)}</strong>
                      <p>dari total anggaran {currency(summary.totalBudget)}</p>
                    </div>
                    <div className="progress-ring">
                      <span>{Math.round(summary.budgetUsage)}%</span>
                    </div>
                  </section>

                  <section className="stats-grid">
                    <MetricCard icon={Wallet} label="Saldo sekarang" value={currency(summary.totalBalance)} tone="violet" />
                    <MetricCard icon={ArrowDownLeft} label="Pemasukan" value={currency(summary.totalIncome)} tone="green" />
                    <MetricCard icon={ArrowUpRight} label="Sisa anggaran" value={currency(summary.remainingBudget)} tone="sky" />
                    <MetricCard icon={PiggyBank} label="Potensi tabungan" value={currency(totalSaved)} tone="amber" />
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Yang perlu dilihat</h2>
                      <Sparkles size={18} />
                    </div>
                    <div className="insight-grid">
                      <article className="insight-card">
                        <div className="insight-icon success">
                          <TrendingUp size={18} />
                        </div>
                        <div>
                          <strong>{totalSaved > 0 ? 'Masih ada ruang untuk menabung' : 'Arus kas perlu diperhatikan'}</strong>
                          <p>{totalSaved > 0 ? `Masih dapat disisihkan ${currency(totalSaved)}.` : 'Periksa pengeluaran terbesar minggu ini.'}</p>
                        </div>
                      </article>
                      <article className="insight-card">
                        <div className={`insight-icon ${alerts.length ? 'warning' : 'success'}`}>
                          {alerts.length ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                        </div>
                        <div>
                          <strong>{alerts.length ? `${alerts.length} kategori perlu perhatian` : 'Anggaran masih aman'}</strong>
                          <p>{alerts[0] ? `${alerts[0].budget.name} sudah ${alerts[0].percent}% terpakai.` : 'Belum ada kategori yang perlu perhatian khusus.'}</p>
                        </div>
                      </article>
                      <article className="insight-card">
                        <div className={`insight-icon ${dueRecurringCount ? 'warning' : 'success'}`}>
                          <Repeat2 size={18} />
                        </div>
                        <div>
                          <strong>{dueRecurringCount ? `${dueRecurringCount} jadwal siap dicatat` : 'Transaksi rutin masih rapi'}</strong>
                          <p>{dueRecurringCount ? 'Buka halaman Catat untuk mencatat transaksi rutin hari ini.' : 'Tagihan dan pemasukan rutin dapat ditambahkan kapan saja.'}</p>
                        </div>
                      </article>
                    </div>
                  </section>

                  <SavingGoalsPanel
                    goals={goalsSummary}
                    accounts={data.accounts.map((item) => item.name)}
                    editingGoal={editingGoal}
                    onEdit={setEditingGoal}
                    onCancelEdit={() => setEditingGoal(null)}
                    onAdd={async (payload) => {
                      await addSavingGoal(payload)
                      setEditingGoal(null)
                    }}
                    onUpdate={async (id, payload) => {
                      await updateSavingGoal(id, payload)
                      setEditingGoal(null)
                    }}
                    onDelete={deleteSavingGoal}
                  />

                  <section className="card">
                    <div className="section-title">
                      <h2>Aksi cepat</h2>
                      <span>Akses cepat</span>
                    </div>
                    <div className="quick-actions">
                      <button className="quick-action" onClick={() => setActiveTab('add')}>
                        <BadgeDollarSign size={18} />
                        <div>
                          <strong>Catat uang</strong>
                          <p>Masuk, keluar, atau transfer antar dompet</p>
                        </div>
                      </button>
                      <button className="quick-action" onClick={() => setActiveTab('budget')}>
                        <Target size={18} />
                        <div>
                          <strong>Atur anggaran</strong>
                          <p>Cek batas, peringatan, dan rollover</p>
                        </div>
                      </button>
                      <button className="quick-action" onClick={() => setActiveTab('history')}>
                        <CreditCard size={18} />
                        <div>
                          <strong>Lihat riwayat</strong>
                          <p>Saring data dan ubah transaksi</p>
                        </div>
                      </button>
                    </div>
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Unduh laporan</h2>
                      <Download size={18} />
                    </div>
                    <div className="export-actions">
                      <button className="export-button" onClick={() => exportBudgetToPdf(exportPayload)}>
                        <FileText size={18} />
                        <div>
                          <strong>PDF</strong>
                          <p>Rekap ringkas siap dibaca</p>
                        </div>
                      </button>
                      <button className="export-button" onClick={() => exportBudgetToExcel(exportPayload)}>
                        <FileSpreadsheet size={18} />
                        <div>
                          <strong>Excel</strong>
                          <p>Data tabel yang lebih detail</p>
                        </div>
                      </button>
                    </div>
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Pembagian pengeluaran</h2>
                      <span>{data.budgets.length} kategori</span>
                    </div>
                    {chartData.length ? (
                      <>
                        <div className="chart-wrap">
                          <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                              <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={4}>
                                {chartData.map((entry) => (
                                  <Cell key={entry.name} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => currency(Number(value ?? 0))} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="legend-list">
                          {data.budgets.map((item) => (
                            <div className="legend-item" key={item.id}>
                              <div className="legend-main">
                                <span className="legend-dot" style={{ background: item.color }} />
                                <span>{item.name}</span>
                              </div>
                              <strong>{currency(item.spent)}</strong>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <EmptyState icon={Target} title="Belum ada anggaran" description="Tambahkan anggaran dulu supaya grafiknya muncul." />
                    )}
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Transaksi terbaru</h2>
                      <button className="text-button" onClick={() => setActiveTab('history')}>
                        Buka semua
                      </button>
                    </div>
                    <TransactionList
                      transactions={recentTransactions}
                      onDelete={deleteTransaction}
                      onEdit={(item) => {
                        setEditingTransaction(item)
                        setActiveTab('add')
                      }}
                      emptyLabel="Belum ada transaksi."
                    />
                  </section>
                </>
              )}

              {activeTab === 'history' && !isAdmin && (
                <section className="card">
                  <div className="section-title">
                    <h2>Riwayat transaksi</h2>
                    <span>{filteredTransactions.length} catatan</span>
                  </div>

                  <HistoryFilterPanel
                    filters={filters}
                    accounts={data.accounts.map((item) => item.name)}
                    categories={uniqueValues(data.transactions.map((item) => item.category))}
                    members={memberOptions}
                    onChange={setFilters}
                  />

                  <div className="mini-export-row">
                    <button className="mini-export-button" onClick={() => exportBudgetToPdf(exportPayload)}>
                      <FileText size={16} />
                      <span>PDF</span>
                    </button>
                    <button className="mini-export-button" onClick={() => exportBudgetToExcel(exportPayload)}>
                      <FileSpreadsheet size={16} />
                      <span>Excel</span>
                    </button>
                  </div>

                  <TransactionList
                    transactions={filteredTransactions}
                    onDelete={deleteTransaction}
                    onEdit={(item) => {
                      setEditingTransaction(item)
                      setActiveTab('add')
                    }}
                    emptyLabel="Belum ada transaksi yang cocok."
                  />
                </section>
              )}

              {activeTab === 'add' && !isAdmin && (
                <AddTransactionPanel
                  accounts={data.accounts.map((item) => item.name)}
                  categories={data.budgets.map((item) => item.name)}
                  members={memberOptions}
                  defaultMember={userName}
                  recurringTransactions={recurringTransactions}
                  dueRecurringCount={dueRecurringCount}
                  editingTransaction={editingTransaction}
                  editingRecurring={editingRecurring}
                  onCreate={async (payload) => {
                    await addTransaction(payload)
                    setEditingTransaction(null)
                  }}
                  onUpdate={async (id, payload) => {
                    await updateTransaction(id, payload)
                    setEditingTransaction(null)
                  }}
                  onCancelEdit={() => setEditingTransaction(null)}
                  onOpenWallet={() => setActiveTab('wallet')}
                  onOpenBudget={() => setActiveTab('budget')}
                  onAddRecurring={async (payload) => {
                    await addRecurringTransaction(payload)
                    setEditingRecurring(null)
                  }}
                  onUpdateRecurring={async (id, payload) => {
                    await updateRecurringTransaction(id, payload)
                    setEditingRecurring(null)
                  }}
                  onEditRecurring={setEditingRecurring}
                  onCancelRecurringEdit={() => setEditingRecurring(null)}
                  onDeleteRecurring={deleteRecurringTransaction}
                  onRunRecurring={createTransactionFromRecurring}
                />
              )}

              {activeTab === 'budget' && !isAdmin && (
                <>
                  <BudgetPeriodPanel start={data.period.start} end={data.period.end} label={data.period.label} onSave={updatePeriod} />

                  <section className="stats-grid">
                    <MetricCard icon={CircleDollarSign} label="Total anggaran" value={currency(summary.totalBudget)} tone="violet" />
                    <MetricCard icon={PiggyBank} label="Sisa dana" value={currency(summary.remainingBudget)} tone="green" />
                  </section>

                  <BudgetAlertPanel alerts={alerts} />

                  <AddBudgetPanel
                    editingBudget={editingBudget}
                    onCancelEdit={() => setEditingBudget(null)}
                    onSubmit={async (payload) => {
                      if (editingBudget) {
                        await updateBudget(editingBudget.id, payload)
                        setEditingBudget(null)
                      } else {
                        await addBudget(payload)
                      }
                    }}
                  />

                  <section className="card">
                    <div className="section-title">
                      <h2>Daftar anggaran</h2>
                      <div className="section-actions">
                        <span>{data.budgets.length} kategori</span>
                        <button className="mini-action-button" onClick={applyBudgetRollover}>
                          Pakai rollover
                        </button>
                      </div>
                    </div>
                    <div className="budget-list">
                      {data.budgets.length ? (
                        data.budgets.map((item) => {
                          const alert = budgetAlert(item)
                          const pct = item.limit ? Math.min((item.spent / item.limit) * 100, 100) : 0
                          return (
                            <article className="budget-row" key={item.id}>
                              <div className="budget-topline">
                                <div>
                                  <strong>{item.name}</strong>
                                  <p>
                                    {currency(item.spent)} dari {currency(item.limit)}
                                  </p>
                                </div>
                                <span className={`status-pill ${alert.tone}`}>{alert.label}</span>
                              </div>
                              <div className="progress-track">
                                <div className={`progress-fill ${alert.tone}`} style={{ width: `${pct}%`, background: item.color }} />
                              </div>
                              <div className="budget-footer">
                                <span>{item.rollover ? 'Rollover menyala' : 'Rollover mati'}</span>
                                <button className="row-action-button muted" onClick={() => setEditingBudget(item)}>
                                  <PencilLine size={14} />
                                  Ubah
                                </button>
                              </div>
                            </article>
                          )
                        })
                      ) : (
                        <EmptyState icon={Target} title="Belum ada anggaran" description="Tambahkan anggaran dulu." />
                      )}
                    </div>
                  </section>
                </>
              )}

              {activeTab === 'wallet' && !isAdmin && (
                <WalletPanel accounts={data.accounts} totalBalance={summary.totalBalance} onAddAccount={addAccount} />
              )}

              {activeTab === 'asset' && !isAdmin && (
                <AssetPanel
                  assets={assets}
                  summary={assetSummary}
                  editingAsset={editingAsset}
                  onEdit={setEditingAsset}
                  onCancelEdit={() => setEditingAsset(null)}
                  onAdd={async (payload) => {
                    await addAsset(payload)
                    setEditingAsset(null)
                  }}
                  onUpdate={async (id, payload) => {
                    await updateAsset(id, payload)
                    setEditingAsset(null)
                  }}
                  onDelete={deleteAsset}
                />
              )}

              {activeTab === 'profile' && !isAdmin && (
                <ProfilePanel
                  userName={userName}
                  email={appUserEmail ?? '-'}
                  themeMode={themeMode}
                  onChangeTheme={setThemeMode}
                  onSaveName={updateProfileName}
                  onSavePassword={updateProfilePassword}
                />
              )}

              {activeTab === 'setup' && isAdmin && (
                <AdminPanel members={data.members} onAddMember={addMember} onDeleteMember={deleteMember} />
              )}
            </>
          )}
        </section>

        <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${navItems.length}, 1fr)` }}>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = activeTab === item.key

            return (
              <button key={item.key} className={active ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab(item.key)}>
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </main>
    </div>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  visible,
  onToggle,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  visible: boolean
  onToggle: () => void
}) {
  return (
    <label className="field-block">
      <span>{label}</span>
      <div className="password-field">
        <input type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <button type="button" className="password-toggle" onClick={onToggle} aria-label={visible ? 'Sembunyikan password' : 'Lihat password'}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Wallet
  label: string
  value: string
  tone: 'violet' | 'green' | 'sky' | 'amber'
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <Icon size={20} />
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function HistoryFilterPanel({
  filters,
  accounts,
  categories,
  members,
  onChange,
}: {
  filters: HistoryFilters
  accounts: string[]
  categories: string[]
  members: string[]
  onChange: (next: HistoryFilters) => void
}) {
  return (
    <div className="history-toolbar">
      <label className="search-field">
        <Search size={16} />
        <input value={filters.query} onChange={(event) => onChange({ ...filters, query: event.target.value })} placeholder="Cari transaksi, dompet, member, atau catatan" />
      </label>

      <div className="filter-pills">
        {[
          { key: 'all', label: 'Semua' },
          { key: 'expense', label: 'Keluar' },
          { key: 'income', label: 'Masuk' },
          { key: 'transfer', label: 'Transfer' },
        ].map((item) => (
          <button key={item.key} className={filters.type === item.key ? 'filter-pill active' : 'filter-pill'} onClick={() => onChange({ ...filters, type: item.key as HistoryFilters['type'] })}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="split-inputs">
        <label className="field-block">
          <span>Dari tanggal</span>
          <input type="date" value={filters.startDate} onChange={(event) => onChange({ ...filters, startDate: event.target.value })} />
        </label>
        <label className="field-block">
          <span>Sampai tanggal</span>
          <input type="date" value={filters.endDate} onChange={(event) => onChange({ ...filters, endDate: event.target.value })} />
        </label>
      </div>

      <div className="split-inputs">
        <label className="field-block">
          <span>Dompet</span>
          <select value={filters.account} onChange={(event) => onChange({ ...filters, account: event.target.value })}>
            <option value="all">Semua dompet</option>
            {accounts.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span>Kategori</span>
          <select value={filters.category} onChange={(event) => onChange({ ...filters, category: event.target.value })}>
            <option value="all">Semua kategori</option>
            {categories.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="split-inputs">
        <label className="field-block">
          <span>Member</span>
          <select value={filters.member} onChange={(event) => onChange({ ...filters, member: event.target.value })}>
            <option value="all">Semua member</option>
            {members.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button className="soft-button reset-filter-button" onClick={() => onChange({ type: 'all', query: '', account: 'all', category: 'all', member: 'all', startDate: '', endDate: '' })}>
          Bersihkan filter
        </button>
      </div>
    </div>
  )
}

function WalletPanel({
  accounts,
  totalBalance,
  onAddAccount,
}: {
  accounts: Account[]
  totalBalance: number
  onAddAccount: (payload: { name: string; balance: number }) => Promise<void>
}) {
  const [form, setForm] = useState({ name: '', balance: '' })

  return (
    <>
      <section className="stats-grid">
        <MetricCard icon={Wallet} label="Saldo sekarang" value={currency(totalBalance)} tone="violet" />
        <MetricCard icon={CreditCard} label="Jumlah dompet" value={`${accounts.length} dompet`} tone="green" />
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Tambah dompet</h2>
          <Wallet size={18} />
        </div>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!form.name || !form.balance) return
            await onAddAccount({ name: form.name, balance: Number(form.balance) })
            setForm({ name: '', balance: '' })
          }}
        >
          <label className="field-block">
            <span>Nama dompet</span>
            <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="BCA, Cash, Dana" />
          </label>
          <label className="field-block">
            <span>Saldo awal</span>
            <input value={form.balance} onChange={(event) => setForm((prev) => ({ ...prev, balance: event.target.value }))} placeholder="0" type="number" />
          </label>
          <button className="primary-button">Simpan dompet</button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Daftar dompet</h2>
          <span>{accounts.length} dompet</span>
        </div>
        <div className="account-list">
          {accounts.length ? (
            accounts.map((item) => (
              <article className="account-row" key={item.id}>
                <div className="account-mark" style={{ background: item.color }}>
                  <CreditCard size={18} />
                </div>
                <div>
                  <strong>{item.name}</strong>
                  <p>{currency(item.balance)}</p>
                </div>
              </article>
            ))
          ) : (
            <EmptyState icon={Wallet} title="Belum ada dompet" description="Tambahkan dompet pertama dulu." />
          )}
        </div>
      </section>
    </>
  )
}

function ProfilePanel({
  userName,
  email,
  themeMode,
  onChangeTheme,
  onSaveName,
  onSavePassword,
}: {
  userName: string
  email: string
  themeMode: ThemeMode
  onChangeTheme: (mode: ThemeMode) => void
  onSaveName: (name: string) => Promise<{ ok: boolean; message: string }>
  onSavePassword: (password: string) => Promise<{ ok: boolean; message: string }>
}) {
  const [name, setName] = useState(userName)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    setName(userName)
  }, [userName])

  return (
    <>
      <section className="card profile-hero">
        <div className="profile-avatar">{userName.slice(0, 1).toUpperCase()}</div>
        <div className="profile-copy">
          <p className="profile-label">Profil</p>
          <h2>{userName}</h2>
          <span>{email}</span>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Tampilan</h2>
          <MoonStar size={18} />
        </div>
        <div className="theme-toggle">
          <button className={themeMode === 'default' ? 'theme-option active' : 'theme-option'} onClick={() => onChangeTheme('default')}>
            Ikuti perangkat
          </button>
          <button className={themeMode === 'dark' ? 'theme-option active' : 'theme-option'} onClick={() => onChangeTheme('dark')}>
            Gelap
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Ganti nama</h2>
          <UserCircle2 size={18} />
        </div>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            const result = await onSaveName(name)
            setMessage(result.message)
          }}
        >
          <label className="field-block">
            <span>Nama yang tampil</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama pengguna" />
          </label>
          <button className="primary-button">Simpan nama</button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Ganti password</h2>
          <Settings size={18} />
        </div>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            const result = await onSavePassword(password)
            setMessage(result.message)
            if (result.ok) setPassword('')
          }}
        >
          <PasswordField
            label="Password baru"
            value={password}
            onChange={setPassword}
            placeholder="Minimal 6 karakter"
            visible={showPassword}
            onToggle={() => setShowPassword((prev) => !prev)}
          />
          <button className="primary-button">Simpan password</button>
        </form>
        {message && <p className="small-note">{message}</p>}
      </section>
    </>
  )
}

function AdminPanel({
  members,
  onAddMember,
  onDeleteMember,
}: {
  members: Array<{ id: string; name: string; email: string; role: string }>
  onAddMember: (payload: { name: string; email: string; password: string; role: string }) => Promise<{ ok: boolean; message: string }>
  onDeleteMember: (id: string) => Promise<void>
}) {
  const [member, setMember] = useState({ name: '', email: '', password: '', role: 'Member' })
  const [memberMessage, setMemberMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  return (
    <>
      <section className="card">
        <div className="section-title">
          <h2>Tambah orang</h2>
          <UsersRound size={18} />
        </div>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            setMemberMessage('')
            if (!member.name || !member.email || !member.password) return
            if (member.password.length < 6) {
              setMemberMessage('Password minimal 6 karakter.')
              return
            }

            const result = await onAddMember(member)
            setMemberMessage(result.message)

            if (result.ok) {
              setMember({ name: '', email: '', password: '', role: 'Member' })
            }
          }}
        >
          <label className="field-block">
            <span>Nama</span>
            <input value={member.name} onChange={(event) => setMember((prev) => ({ ...prev, name: event.target.value }))} placeholder="Nama orang" />
          </label>
          <label className="field-block">
            <span>Email</span>
            <input value={member.email} onChange={(event) => setMember((prev) => ({ ...prev, email: event.target.value }))} placeholder="email@contoh.com" type="email" />
          </label>
          <PasswordField
            label="Password"
            value={member.password}
            onChange={(value) => setMember((prev) => ({ ...prev, password: value }))}
            placeholder="Minimal 6 karakter"
            visible={showPassword}
            onToggle={() => setShowPassword((prev) => !prev)}
          />
          <label className="field-block">
            <span>Peran</span>
            <select value={member.role} onChange={(event) => setMember((prev) => ({ ...prev, role: event.target.value }))}>
              <option>Member</option>
              <option>Admin</option>
              <option>Lihat</option>
            </select>
          </label>
          <button className="primary-button">
            <UserPlus size={17} />
            Simpan akses
          </button>
          {memberMessage && <p className="small-note">{memberMessage}</p>}
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Daftar orang</h2>
          <span>{members.length} akun</span>
        </div>
        <div className="member-list">
          {members.length ? (
            members.map((item) => (
              <article className="member-row" key={item.id}>
                <div className="member-avatar">{item.name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.email}</p>
                </div>
                <span>{item.role}</span>
                <button className="delete-member-button" onClick={() => onDeleteMember(item.id)} aria-label="Hapus orang">
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          ) : (
            <EmptyState icon={UsersRound} title="Belum ada orang" description="Tambahkan orang pertama dulu." />
          )}
        </div>
      </section>
    </>
  )
}

function AddBudgetPanel({
  editingBudget,
  onCancelEdit,
  onSubmit,
}: {
  editingBudget: BudgetCategory | null
  onCancelEdit: () => void
  onSubmit: (payload: { name: string; limit: number; rollover: boolean }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [limit, setLimit] = useState('')
  const [rollover, setRollover] = useState(false)

  useEffect(() => {
    if (editingBudget) {
      setName(editingBudget.name)
      setLimit(String(editingBudget.limit))
      setRollover(editingBudget.rollover)
      return
    }

    setName('')
    setLimit('')
    setRollover(false)
  }, [editingBudget])

  return (
    <section className="card">
      <div className="section-title">
          <h2>{editingBudget ? 'Ubah anggaran' : 'Tambah anggaran'}</h2>
        {editingBudget ? (
            <button type="button" className="inline-icon-button" onClick={onCancelEdit} aria-label="Batal ubah anggaran">
            <X size={16} />
          </button>
        ) : (
          <Target size={18} />
        )}
      </div>
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name || !limit) return
          await onSubmit({ name, limit: Number(limit), rollover })
          if (!editingBudget) {
            setName('')
            setLimit('')
            setRollover(false)
          }
        }}
      >
        <label className="field-block">
          <span>Nama kategori</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Makan, transport, tagihan" />
        </label>
        <label className="field-block">
          <span>Batas anggaran</span>
          <input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="0" type="number" />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={rollover} onChange={(event) => setRollover(event.target.checked)} />
          <span>Bawa sisa atau selisih anggaran ke periode berikutnya</span>
        </label>
        <button className="primary-button">{editingBudget ? 'Simpan perubahan' : 'Simpan anggaran'}</button>
      </form>
    </section>
  )
}

function BudgetAlertPanel({
  alerts,
}: {
  alerts: Array<ReturnType<typeof budgetAlert> & { budget: BudgetCategory }>
}) {
  return (
    <section className="card">
      <div className="section-title">
        <h2>Peringatan anggaran</h2>
        <AlertTriangle size={18} />
      </div>
      <div className="alert-list">
        {alerts.length ? (
          alerts.map((item) => (
            <article className={`alert-row ${item.tone}`} key={item.budget.id}>
              <div>
                <strong>{item.budget.name}</strong>
                <p>
                  {currency(item.budget.spent)} dari {currency(item.budget.limit)}
                </p>
              </div>
              <span>{item.percent}%</span>
            </article>
          ))
        ) : (
          <EmptyState icon={CheckCircle2} title="Belum ada peringatan" description="Semua anggaran masih dalam batas aman." compact />
        )}
      </div>
    </section>
  )
}

function BudgetPeriodPanel({
  start,
  end,
  label,
  onSave,
}: {
  start: string
  end: string
  label: string
  onSave: (payload: { label: string; start: string; end: string }) => Promise<void>
}) {
  const [period, setPeriod] = useState({ start, end, label })

  useEffect(() => {
    setPeriod({ start, end, label })
  }, [start, end, label])

  return (
    <section className="card">
      <div className="section-title">
          <h2>Periode anggaran</h2>
        <CalendarRange size={18} />
      </div>
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault()
          await onSave(period)
        }}
      >
        <label className="field-block">
          <span>Nama periode</span>
          <input value={period.label} onChange={(event) => setPeriod((prev) => ({ ...prev, label: event.target.value }))} placeholder="April 2026" />
        </label>
        <div className="split-inputs">
          <label className="field-block">
            <span>Tanggal mulai</span>
            <input type="date" value={period.start} onChange={(event) => setPeriod((prev) => ({ ...prev, start: event.target.value }))} />
          </label>
          <label className="field-block">
            <span>Tanggal akhir</span>
            <input type="date" value={period.end} onChange={(event) => setPeriod((prev) => ({ ...prev, end: event.target.value }))} />
          </label>
        </div>
        <button className="primary-button">Simpan periode</button>
      </form>
    </section>
  )
}

function AddTransactionPanel({
  accounts,
  categories,
  members,
  defaultMember,
  recurringTransactions,
  dueRecurringCount,
  editingTransaction,
  editingRecurring,
  onCreate,
  onUpdate,
  onCancelEdit,
  onOpenWallet,
  onOpenBudget,
  onAddRecurring,
  onUpdateRecurring,
  onEditRecurring,
  onCancelRecurringEdit,
  onDeleteRecurring,
  onRunRecurring,
}: {
  accounts: string[]
  categories: string[]
  members: string[]
  defaultMember: string
  recurringTransactions: RecurringTransaction[]
  dueRecurringCount: number
  editingTransaction: TransactionItem | null
  editingRecurring: RecurringTransaction | null
  onCreate: (payload: Omit<TransactionItem, 'id'>) => Promise<void>
  onUpdate: (id: string, payload: Omit<TransactionItem, 'id'>) => Promise<void>
  onCancelEdit: () => void
  onOpenWallet: () => void
  onOpenBudget: () => void
  onAddRecurring: (payload: Omit<RecurringTransaction, 'id' | 'lastCreatedAt'>) => Promise<void>
  onUpdateRecurring: (id: string, payload: Omit<RecurringTransaction, 'id' | 'lastCreatedAt'>) => Promise<void>
  onEditRecurring: (item: RecurringTransaction) => void
  onCancelRecurringEdit: () => void
  onDeleteRecurring: (id: string) => Promise<void>
  onRunRecurring: (id: string) => Promise<void>
}) {
  const [form, setForm] = useState(() => defaultTransactionDraft(accounts, categories, defaultMember))
  const [recurringForm, setRecurringForm] = useState(() => defaultRecurringDraft(accounts, categories, defaultMember))
  const [entryMode, setEntryMode] = useState<'single' | 'recurring'>('single')

  useEffect(() => {
    if (editingTransaction) {
      setEntryMode('single')
      setForm({
        title: editingTransaction.title,
        amount: editingTransaction.amount,
        type: editingTransaction.type,
        category: editingTransaction.category,
        account: editingTransaction.account,
        toAccount: editingTransaction.toAccount ?? accounts.find((item) => item !== editingTransaction.account) ?? '',
        member: editingTransaction.member ?? defaultMember,
        date: editingTransaction.date,
        note: editingTransaction.note,
      })
      return
    }

    setForm(defaultTransactionDraft(accounts, categories, defaultMember))
  }, [accounts, categories, defaultMember, editingTransaction])

  useEffect(() => {
    if (editingRecurring) {
      setEntryMode('recurring')
      setRecurringForm({
        title: editingRecurring.title,
        amount: editingRecurring.amount,
        type: editingRecurring.type,
        category: editingRecurring.category,
        account: editingRecurring.account,
        toAccount: editingRecurring.toAccount ?? accounts.find((item) => item !== editingRecurring.account) ?? '',
        member: editingRecurring.member ?? defaultMember,
        note: editingRecurring.note,
        frequency: editingRecurring.frequency,
        nextDate: editingRecurring.nextDate,
      })
      return
    }

    setRecurringForm(defaultRecurringDraft(accounts, categories, defaultMember))
  }, [accounts, categories, defaultMember, editingRecurring])

  const canSubmitTransaction = accounts.length > 0

  return (
    <>
      <section className="card">
        <div className="section-title">
          <h2>Catat</h2>
          <BadgeDollarSign size={18} />
        </div>
        <div className="toggle-grid entry-mode-toggle">
          <button
            type="button"
            className={entryMode === 'single' ? 'toggle-pill active' : 'toggle-pill'}
            onClick={() => {
              setEntryMode('single')
              onCancelRecurringEdit()
            }}
          >
            Transaksi sekali
          </button>
          <button
            type="button"
            className={entryMode === 'recurring' ? 'toggle-pill active' : 'toggle-pill'}
            onClick={() => {
              setEntryMode('recurring')
              onCancelEdit()
            }}
          >
            Transaksi rutin
          </button>
        </div>
      </section>

      {entryMode === 'single' ? (
      <section className="card">
        <div className="section-title">
          <h2>{editingTransaction ? 'Ubah transaksi' : 'Catat transaksi'}</h2>
          {editingTransaction ? (
            <button type="button" className="inline-icon-button" onClick={onCancelEdit} aria-label="Batal ubah transaksi">
              <X size={16} />
            </button>
          ) : (
            <BadgeDollarSign size={18} />
          )}
        </div>

        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!form.title || !form.amount || !form.account) return
            if (form.type === 'transfer' && (!form.toAccount || form.toAccount === form.account)) return

            const payload = {
              ...form,
              amount: Number(form.amount),
              category: form.type === 'transfer' ? 'Transfer' : form.category,
              toAccount: form.type === 'transfer' ? form.toAccount : undefined,
            }

            if (editingTransaction) {
              await onUpdate(editingTransaction.id, payload)
            } else {
              await onCreate(payload)
            }
          }}
        >
          <div className="toggle-grid">
            {(['expense', 'income', 'transfer'] as TransactionType[]).map((type) => (
              <button key={type} type="button" className={form.type === type ? 'toggle-pill active' : 'toggle-pill'} onClick={() => setForm((prev) => ({ ...prev, type }))}>
                {type === 'expense' ? 'Pengeluaran' : type === 'income' ? 'Pemasukan' : 'Transfer'}
              </button>
            ))}
          </div>

          {!accounts.length && (
            <div className="setup-guide">
            <EmptyState icon={BadgeDollarSign} title="Tambahkan dompet terlebih dahulu" description="Setelah dompet tersedia, transaksi dapat langsung dicatat. Tipe pengeluaran tetap dapat dipilih di halaman ini." />
              <div className="setup-guide-actions">
                <button type="button" className="soft-button" onClick={onOpenWallet}>
                  Buka dompet
                </button>
              </div>
            </div>
          )}

          {accounts.length > 0 && !categories.length && form.type === 'expense' && (
            <div className="setup-guide compact-guide">
              <EmptyState icon={Target} title="Anggaran belum dibuat" description="Pengeluaran tetap dapat dicatat. Kategori dapat diisi manual atau dipilih setelah anggaran dibuat." compact />
              <div className="setup-guide-actions">
                <button type="button" className="soft-button" onClick={onOpenBudget}>
                  Buka anggaran
                </button>
              </div>
            </div>
          )}

          {editingTransaction && (
            <div className="editor-banner">
              <div>
                <strong>Lagi mengubah transaksi</strong>
                  <p>Setelah disimpan, saldo dan anggaran langsung ikut menyesuaikan.</p>
              </div>
              <button type="button" className="ghost-button compact-ghost" onClick={onCancelEdit}>
                Batal
              </button>
            </div>
          )}

          <label className="field-block">
            <span>Nama transaksi</span>
            <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="Makan siang, gaji, transfer tabungan" />
          </label>

          <div className="split-inputs">
            <label className="field-block">
              <span>Nominal</span>
              <input value={form.amount || ''} onChange={(event) => setForm((prev) => ({ ...prev, amount: Number(event.target.value) }))} placeholder="0" type="number" />
            </label>
            <label className="field-block">
              <span>Tanggal</span>
              <input type="date" value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} />
            </label>
          </div>

            <label className="field-block">
              <span>Dicatat oleh</span>
              <select value={form.member ?? defaultMember} onChange={(event) => setForm((prev) => ({ ...prev, member: event.target.value }))}>
                {members.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

          {form.type === 'transfer' ? (
              <div className="split-inputs">
                <label className="field-block">
                  <span>Dari dompet</span>
                  <select value={form.account} onChange={(event) => setForm((prev) => ({ ...prev, account: event.target.value }))} disabled={!accounts.length}>
                    {accounts.map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block">
                  <span>Ke dompet</span>
                  <select value={form.toAccount} onChange={(event) => setForm((prev) => ({ ...prev, toAccount: event.target.value }))} disabled={!accounts.length}>
                    {accounts.map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="split-inputs">
                {categories.length ? (
                  <label className="field-block">
                    <span>Kategori</span>
                    <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
                      {categories.map((item) => (
                        <option value={item} key={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="field-block">
                    <span>Kategori</span>
                    <input value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} placeholder="Mis. Makan, transport, gaji" />
                  </label>
                )}
                <label className="field-block">
                  <span>Dompet</span>
                  <select value={form.account} onChange={(event) => setForm((prev) => ({ ...prev, account: event.target.value }))} disabled={!accounts.length}>
                    {accounts.map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

          <label className="field-block">
            <span>Catatan</span>
              <textarea value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} rows={3} placeholder="Opsional" />
          </label>

          {form.type === 'transfer' && form.toAccount === form.account && <p className="small-note warning-note">Dompet asal dan tujuan harus beda.</p>}

          <button className="primary-button" disabled={!canSubmitTransaction}>
            {editingTransaction ? 'Simpan perubahan' : 'Simpan transaksi'}
          </button>
        </form>
      </section>
      ) : (
      <section className="card">
        <div className="section-title">
          <h2>{editingRecurring ? 'Ubah transaksi rutin' : 'Transaksi rutin'}</h2>
          {editingRecurring ? (
            <button type="button" className="inline-icon-button" onClick={onCancelRecurringEdit} aria-label="Batal ubah transaksi rutin">
              <X size={16} />
            </button>
          ) : (
            <Repeat2 size={18} />
          )}
        </div>

        <div className="recurring-headline">
          <div>
            <strong>{dueRecurringCount ? `${dueRecurringCount} jadwal siap dicatat` : 'Belum ada yang jatuh tempo hari ini'}</strong>
            <p>Gunakan untuk gaji, tagihan bulanan, cicilan, atau transfer tabungan.</p>
          </div>
          <div className="due-pill">
            <Clock3 size={16} />
            <span>{dueRecurringCount}</span>
          </div>
        </div>

        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!recurringForm.title || !recurringForm.amount || !recurringForm.account) return
            if (recurringForm.type === 'transfer' && (!recurringForm.toAccount || recurringForm.toAccount === recurringForm.account)) return

            const payload = {
              ...recurringForm,
              amount: Number(recurringForm.amount),
              category: recurringForm.type === 'transfer' ? 'Transfer' : recurringForm.category,
              toAccount: recurringForm.type === 'transfer' ? recurringForm.toAccount : undefined,
            }

            if (editingRecurring) {
              await onUpdateRecurring(editingRecurring.id, payload)
            } else {
              await onAddRecurring(payload)
            }
          }}
        >
          <div className="toggle-grid">
            {(['expense', 'income', 'transfer'] as TransactionType[]).map((type) => (
              <button key={type} type="button" className={recurringForm.type === type ? 'toggle-pill active' : 'toggle-pill'} onClick={() => setRecurringForm((prev) => ({ ...prev, type }))}>
                {type === 'expense' ? 'Pengeluaran' : type === 'income' ? 'Pemasukan' : 'Transfer'}
              </button>
            ))}
          </div>

          <label className="field-block">
            <span>Nama transaksi rutin</span>
            <input value={recurringForm.title} onChange={(event) => setRecurringForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="Gaji bulanan, listrik, transfer tabungan" />
          </label>

          <div className="split-inputs">
            <label className="field-block">
              <span>Nominal</span>
              <input value={recurringForm.amount || ''} onChange={(event) => setRecurringForm((prev) => ({ ...prev, amount: Number(event.target.value) }))} placeholder="0" type="number" />
            </label>
            <label className="field-block">
              <span>Jadwal berikutnya</span>
              <input type="date" value={recurringForm.nextDate} onChange={(event) => setRecurringForm((prev) => ({ ...prev, nextDate: event.target.value }))} />
            </label>
          </div>

          <label className="field-block">
            <span>Dicatat oleh</span>
            <select value={recurringForm.member ?? defaultMember} onChange={(event) => setRecurringForm((prev) => ({ ...prev, member: event.target.value }))}>
              {members.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          {recurringForm.type === 'transfer' ? (
            <div className="split-inputs">
              <label className="field-block">
                <span>Dari dompet</span>
                <select value={recurringForm.account} onChange={(event) => setRecurringForm((prev) => ({ ...prev, account: event.target.value }))}>
                  {accounts.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-block">
                <span>Ke dompet</span>
                <select value={recurringForm.toAccount} onChange={(event) => setRecurringForm((prev) => ({ ...prev, toAccount: event.target.value }))}>
                  {accounts.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="split-inputs">
              <label className="field-block">
                <span>Kategori</span>
                <select value={recurringForm.category} onChange={(event) => setRecurringForm((prev) => ({ ...prev, category: event.target.value }))}>
                  {categories.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-block">
                <span>Dompet</span>
                <select value={recurringForm.account} onChange={(event) => setRecurringForm((prev) => ({ ...prev, account: event.target.value }))}>
                  {accounts.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="split-inputs">
            <label className="field-block">
              <span>Frekuensi</span>
              <select value={recurringForm.frequency} onChange={(event) => setRecurringForm((prev) => ({ ...prev, frequency: event.target.value as RecurringFrequency }))}>
                <option value="weekly">Mingguan</option>
                <option value="monthly">Bulanan</option>
              </select>
            </label>
            <label className="field-block">
              <span>Catatan</span>
              <input value={recurringForm.note} onChange={(event) => setRecurringForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Opsional" />
            </label>
          </div>

          <button className="primary-button">{editingRecurring ? 'Simpan jadwal' : 'Tambah jadwal rutin'}</button>
        </form>

        <div className="recurring-list">
          {recurringTransactions.length ? (
            recurringTransactions.map((item) => {
              const isDue = item.nextDate <= todayIso()
              const routeLabel = item.type === 'transfer' && item.toAccount ? `${item.account} ke ${item.toAccount}` : `${item.category} • ${item.account}`

              return (
                <article className={isDue ? 'recurring-row due' : 'recurring-row'} key={item.id}>
                  <div className="recurring-copy">
                    <strong>{item.title}</strong>
                    <p>{routeLabel}</p>
                    <span>
                      {(item.member ?? defaultMember)} • {item.frequency === 'weekly' ? 'Mingguan' : 'Bulanan'} • {compactDate(item.nextDate)}
                    </span>
                  </div>
                  <div className="recurring-side">
                    <strong>{currency(item.amount)}</strong>
                    <div className="row-actions">
                      <button type="button" className="row-action-button" onClick={() => onRunRecurring(item.id)}>
                        Catat
                      </button>
                      <button type="button" className="row-action-button muted" onClick={() => onEditRecurring(item)}>
                        Ubah
                      </button>
                      <button type="button" className="row-action-button danger" onClick={() => onDeleteRecurring(item.id)}>
                        Hapus
                      </button>
                    </div>
                  </div>
                </article>
              )
            })
          ) : (
            <EmptyState icon={Repeat2} title="Belum ada transaksi rutin" description="Tambahkan satu jadwal agar tagihan dan pemasukan rutin tercatat rapi." compact />
          )}
        </div>
      </section>
      )}
    </>
  )
}

function SavingGoalsPanel({
  goals,
  accounts,
  editingGoal,
  onEdit,
  onCancelEdit,
  onAdd,
  onUpdate,
  onDelete,
}: {
  goals: Array<SavingGoal & { progress: number; remaining: number }>
  accounts: string[]
  editingGoal: SavingGoal | null
  onEdit: (goal: SavingGoal) => void
  onCancelEdit: () => void
  onAdd: (payload: Omit<SavingGoal, 'id'>) => Promise<void>
  onUpdate: (id: string, payload: Omit<SavingGoal, 'id'>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [form, setForm] = useState(() => defaultGoalDraft(accounts))

  useEffect(() => {
    if (editingGoal) {
      setForm({
        name: editingGoal.name,
        target: editingGoal.target,
        saved: editingGoal.saved,
        account: editingGoal.account ?? accounts[0] ?? '',
        note: editingGoal.note,
      })
      return
    }

    setForm(defaultGoalDraft(accounts))
  }, [accounts, editingGoal])

  return (
    <section className="card">
      <div className="section-title">
        <h2>Target tabungan</h2>
        {editingGoal ? (
          <button type="button" className="inline-icon-button" onClick={onCancelEdit} aria-label="Batal ubah target">
            <X size={16} />
          </button>
        ) : (
          <Goal size={18} />
        )}
      </div>

      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!form.name || !form.target) return

          const payload = {
            ...form,
            target: Number(form.target),
            saved: Number(form.saved),
          }

          if (editingGoal) {
            await onUpdate(editingGoal.id, payload)
          } else {
            await onAdd(payload)
          }
        }}
      >
        <label className="field-block">
          <span>Nama target</span>
          <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Dana darurat, laptop, liburan" />
        </label>
        <div className="split-inputs">
          <label className="field-block">
            <span>Target</span>
            <input value={form.target || ''} onChange={(event) => setForm((prev) => ({ ...prev, target: Number(event.target.value) }))} placeholder="0" type="number" />
          </label>
          <label className="field-block">
            <span>Sudah terkumpul</span>
            <input value={form.saved || ''} onChange={(event) => setForm((prev) => ({ ...prev, saved: Number(event.target.value) }))} placeholder="0" type="number" />
          </label>
        </div>
        <div className="split-inputs">
          <label className="field-block">
            <span>Dompet utama</span>
            <select value={form.account} onChange={(event) => setForm((prev) => ({ ...prev, account: event.target.value }))}>
              <option value="">Pilih dompet</option>
              {accounts.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span>Catatan</span>
            <input value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Opsional" />
          </label>
        </div>
        <button className="primary-button">{editingGoal ? 'Simpan target' : 'Tambah target'}</button>
      </form>

      <div className="goal-list">
        {goals.length ? (
          goals.map((goal) => (
            <article className="goal-row" key={goal.id}>
              <div className="goal-copy">
                <strong>{goal.name}</strong>
                <p>
                  {currency(goal.saved)} dari {currency(goal.target)}
                </p>
                <span>{goal.remaining ? `Sisa ${currency(goal.remaining)}` : 'Target sudah tercapai'}</span>
              </div>
              <div className="goal-side">
                <span className="status-pill safe">{Math.round(goal.progress)}%</span>
                <div className="progress-track slim">
                  <div className="progress-fill" style={{ width: `${goal.progress}%`, background: '#13b981' }} />
                </div>
                <div className="row-actions">
                  <button className="row-action-button muted" onClick={() => onEdit(goal)}>
                    Ubah
                  </button>
                  <button className="row-action-button danger" onClick={() => onDelete(goal.id)}>
                    Hapus
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <EmptyState icon={Goal} title="Belum ada target tabungan" description="Tambahkan tujuan agar progres tabungan lebih mudah dipantau." compact />
        )}
      </div>
    </section>
  )
}

function AssetPanel({
  assets,
  summary,
  editingAsset,
  onEdit,
  onCancelEdit,
  onAdd,
  onUpdate,
  onDelete,
}: {
  assets: AssetItem[]
  summary: { totalInitial: number; totalCurrent: number; totalEstimate: number; dueDeposits: number }
  editingAsset: AssetItem | null
  onEdit: (asset: AssetItem) => void
  onCancelEdit: () => void
  onAdd: (payload: Omit<AssetItem, 'id'>) => Promise<void>
  onUpdate: (id: string, payload: Omit<AssetItem, 'id'>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [form, setForm] = useState(() => defaultAssetDraft())

  useEffect(() => {
    if (editingAsset) {
      setForm({
        name: editingAsset.name,
        type: editingAsset.type,
        initialAmount: editingAsset.initialAmount,
        currentValue: editingAsset.currentValue,
        startDate: editingAsset.startDate,
        tenorMonths: editingAsset.tenorMonths ?? 12,
        interestRate: editingAsset.interestRate ?? 0,
        maturityDate: editingAsset.maturityDate ?? '',
        estimatedReturn: editingAsset.estimatedReturn ?? 0,
        note: editingAsset.note,
      })
      return
    }

    setForm(defaultAssetDraft())
  }, [editingAsset])

  const isDeposit = form.type === 'deposito'

  return (
    <>
      <section className="stats-grid">
        <MetricCard icon={CircleDollarSign} label="Nilai sekarang" value={currency(summary.totalCurrent)} tone="violet" />
        <MetricCard icon={TrendingUp} label="Estimasi hasil" value={currency(summary.totalEstimate)} tone="green" />
        <MetricCard icon={PiggyBank} label="Modal awal" value={currency(summary.totalInitial)} tone="sky" />
        <MetricCard icon={Clock3} label="Jatuh tempo" value={`${summary.dueDeposits} aset`} tone="amber" />
      </section>

      <section className="card">
        <div className="section-title">
          <h2>{editingAsset ? 'Ubah aset' : 'Tambah aset'}</h2>
          {editingAsset ? (
            <button type="button" className="inline-icon-button" onClick={onCancelEdit} aria-label="Batal ubah aset">
              <X size={16} />
            </button>
          ) : (
            <CircleDollarSign size={18} />
          )}
        </div>

        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!form.name || !form.initialAmount || !form.currentValue || !form.startDate) return

            const payload = {
              ...form,
              initialAmount: Number(form.initialAmount),
              currentValue: Number(form.currentValue),
              tenorMonths: isDeposit ? Number(form.tenorMonths || 0) : undefined,
              interestRate: isDeposit ? Number(form.interestRate || 0) : undefined,
              maturityDate: isDeposit ? form.maturityDate : undefined,
              estimatedReturn: isDeposit ? Number(form.estimatedReturn || 0) : undefined,
            }

            if (editingAsset) {
              await onUpdate(editingAsset.id, payload)
            } else {
              await onAdd(payload)
            }
          }}
        >
          <label className="field-block">
            <span>Nama aset</span>
            <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Deposito BCA, Emas Antam, Reksa dana pasar uang" />
          </label>

          <label className="field-block">
            <span>Jenis</span>
            <select value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as AssetType }))}>
              <option value="deposito">Deposito</option>
              <option value="emas">Emas</option>
              <option value="reksa_dana">Reksa dana</option>
              <option value="saham">Saham</option>
              <option value="crypto">Crypto</option>
              <option value="lainnya">Lainnya</option>
            </select>
          </label>

          <div className="split-inputs">
            <label className="field-block">
              <span>Nominal awal</span>
              <input value={form.initialAmount || ''} onChange={(event) => setForm((prev) => ({ ...prev, initialAmount: Number(event.target.value) }))} type="number" placeholder="0" />
            </label>
            <label className="field-block">
              <span>Nilai sekarang</span>
              <input value={form.currentValue || ''} onChange={(event) => setForm((prev) => ({ ...prev, currentValue: Number(event.target.value) }))} type="number" placeholder="0" />
            </label>
          </div>

          <label className="field-block">
            <span>Tanggal mulai</span>
            <input type="date" value={form.startDate} onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))} />
          </label>

          {isDeposit && (
            <>
              <div className="split-inputs">
                <label className="field-block">
                  <span>Tenor (bulan)</span>
                  <input value={form.tenorMonths || ''} onChange={(event) => setForm((prev) => ({ ...prev, tenorMonths: Number(event.target.value) }))} type="number" placeholder="12" />
                </label>
                <label className="field-block">
                  <span>Bunga (%)</span>
                  <input value={form.interestRate || ''} onChange={(event) => setForm((prev) => ({ ...prev, interestRate: Number(event.target.value) }))} type="number" placeholder="0" />
                </label>
              </div>
              <div className="split-inputs">
                <label className="field-block">
                  <span>Tanggal jatuh tempo</span>
                  <input type="date" value={form.maturityDate ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, maturityDate: event.target.value }))} />
                </label>
                <label className="field-block">
                  <span>Estimasi hasil</span>
                  <input value={form.estimatedReturn || ''} onChange={(event) => setForm((prev) => ({ ...prev, estimatedReturn: Number(event.target.value) }))} type="number" placeholder="0" />
                </label>
              </div>
            </>
          )}

          <label className="field-block">
            <span>Catatan</span>
            <textarea value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} rows={3} placeholder="Opsional" />
          </label>

          <button className="primary-button">{editingAsset ? 'Simpan aset' : 'Tambah aset'}</button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Daftar aset</h2>
          <span>{assets.length} aset</span>
        </div>

        <div className="asset-list">
          {assets.length ? (
            assets.map((asset) => {
              const profit = asset.currentValue - asset.initialAmount
              return (
                <article className="asset-row" key={asset.id}>
                  <div className="asset-copy">
                    <div className="asset-topline">
                      <strong>{asset.name}</strong>
                      <span className="status-pill safe">{asset.type === 'deposito' ? 'Deposito' : asset.type.replace('_', ' ')}</span>
                    </div>
                    <p>Modal {currency(asset.initialAmount)} • Nilai sekarang {currency(asset.currentValue)}</p>
                    <span>{compactDate(asset.startDate)}{asset.maturityDate ? ` • jatuh tempo ${compactDate(asset.maturityDate)}` : ''}</span>
                    {asset.type === 'deposito' && (
                      <span>Tenor {asset.tenorMonths ?? 0} bulan • bunga {asset.interestRate ?? 0}% • estimasi hasil {currency(asset.estimatedReturn ?? 0)}</span>
                    )}
                  </div>
                  <div className="asset-side">
                    <strong className={profit >= 0 ? 'plus' : 'minus'}>{profit >= 0 ? '+' : '-'}{currency(Math.abs(profit))}</strong>
                    <div className="row-actions">
                      <button className="row-action-button muted" onClick={() => onEdit(asset)}>
                        Ubah
                      </button>
                      <button className="row-action-button danger" onClick={() => onDelete(asset.id)}>
                        Hapus
                      </button>
                    </div>
                  </div>
                </article>
              )
            })
          ) : (
            <EmptyState icon={CircleDollarSign} title="Belum ada aset" description="Tambahkan aset atau deposito supaya nilainya bisa dipantau di sini." compact />
          )}
        </div>
      </section>
    </>
  )
}

function TransactionList({
  transactions,
  onDelete,
  onEdit,
  emptyLabel,
}: {
  transactions: TransactionItem[]
  onDelete: (id: string) => Promise<void>
  onEdit: (transaction: TransactionItem) => void
  emptyLabel: string
}) {
  if (!transactions.length) {
    return <EmptyState icon={ReceiptText} title="Belum ada catatan" description={emptyLabel} compact />
  }

  return (
    <div className="transaction-list">
      {transactions.map((item) => {
        const Icon = transactionIcons[item.type]
        const metaLine =
          item.type === 'transfer' && item.toAccount
            ? `${item.account} ke ${item.toAccount} • ${compactDate(item.date)}`
            : `${item.category} • ${item.account} • ${compactDate(item.date)}`

        return (
          <article className="transaction-card" key={item.id}>
            <div className={`transaction-icon ${item.type}`}>
              <Icon size={18} />
            </div>
            <div className="transaction-copy">
              <strong>{item.title}</strong>
              <p>{metaLine}</p>
              <span>{item.member ? `${item.member}${item.note ? ` • ${item.note}` : ''}` : item.note}</span>
            </div>
            <div className="transaction-side">
              <strong className={item.type === 'expense' ? 'minus' : 'plus'}>
                {item.type === 'expense' ? '-' : '+'}
                {currency(item.amount)}
              </strong>
              <div className="row-actions">
                <button type="button" className="row-action-button muted" onClick={() => onEdit(item)}>
                  <PencilLine size={14} />
                  Ubah
                </button>
                <button type="button" className="row-action-button danger" onClick={() => onDelete(item.id)}>
                  <Trash2 size={14} />
                  Hapus
                </button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
  compact = false,
}: {
  icon: typeof ReceiptText
  title: string
  description: string
  compact?: boolean
}) {
  return (
    <div className={compact ? 'empty-state compact' : 'empty-state'}>
      <div className="empty-icon">
        <Icon size={18} />
      </div>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  )
}
