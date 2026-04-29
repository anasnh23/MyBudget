import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BadgeDollarSign,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  LayoutGrid,
  LogOut,
  PiggyBank,
  RefreshCw,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trash2,
  UserCircle2,
  UserPlus,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { Session } from '@supabase/supabase-js'
import { compactDate, currency } from './lib/format'
import { exportBudgetToExcel, exportBudgetToPdf } from './lib/export'
import { supabase, supabaseEnabled } from './lib/supabase'
import { useBudgetData } from './hooks/useBudgetData'
import type { Account, NavKey, TransactionType } from './types'

const baseNavItems = [
  { key: 'home', label: 'Home', icon: LayoutGrid },
  { key: 'history', label: 'Riwayat', icon: ReceiptText },
  { key: 'add', label: 'Catat', icon: BadgeDollarSign },
  { key: 'budget', label: 'Budget', icon: Target },
  { key: 'wallet', label: 'Dompet', icon: Wallet },
  { key: 'profile', label: 'Profile', icon: UserCircle2 },
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

function toFriendlyAuthMessage(message: string, mode: 'login' | 'register') {
  const text = message.toLowerCase()

  if (text.includes('email not confirmed')) {
    return 'Email belum aktif. Cek inbox lalu verifikasi dulu.'
  }

  if (text.includes('invalid login credentials')) {
    return 'Email atau password salah.'
  }

  if (text.includes('user already registered')) {
    return 'Email ini sudah terdaftar. Langsung masuk saja.'
  }

  if (text.includes('password should be at least')) {
    return 'Password minimal 6 karakter.'
  }

  if (text.includes('unable to validate email address')) {
    return 'Format email belum benar.'
  }

  if (text.includes('signup is disabled')) {
    return 'Pendaftaran sedang ditutup.'
  }

  if (text.includes('network')) {
    return 'Koneksi bermasalah. Coba lagi.'
  }

  return mode === 'login'
    ? 'Belum bisa masuk sekarang. Coba lagi.'
    : 'Belum bisa daftar sekarang. Coba lagi.'
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [demoProfileName, setDemoProfileName] = useState('Demo User')
  const [activeTab, setActiveTab] = useState<NavKey>('home')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback>({ tone: 'idle', text: '' })
  const [authLoading, setAuthLoading] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<'all' | TransactionType>('all')
  const [historyQuery, setHistoryQuery] = useState('')

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))

    return () => subscription.unsubscribe()
  }, [])

  const appUserId = session?.user.id ?? (demoMode ? 'demo-user' : undefined)
  const appUserEmail = session?.user.email ?? (demoMode ? 'demo@mybudget.local' : undefined)
  const { data, loading, summary, addAccount, addMember, deleteMember, addBudget, addTransaction, updatePeriod, deleteTransaction } =
    useBudgetData(appUserId, appUserEmail, demoMode)

  const chartData = data.budgets.map((item) => ({
    name: item.name,
    value: item.spent,
    color: item.color,
  }))

  const isSeedAdmin = session?.user.email?.toLowerCase() === 'admin@kunci.cloud'
  const currentMember = data.members.find((item) => item.email.toLowerCase() === appUserEmail?.toLowerCase())
  const isAdmin = isSeedAdmin || currentMember?.role.toLowerCase() === 'admin'
  const canUseApp = demoMode || !supabaseEnabled || !session || loading || isSeedAdmin || Boolean(currentMember)
  const navItems = isAdmin ? [adminNavItem] : baseNavItems
  const recentTransactions = useMemo(() => data.transactions.slice(0, 8), [data.transactions])
  const totalSaved = Math.max(summary.totalIncome - summary.totalExpense, 0)
  const userName =
    (demoMode ? demoProfileName : undefined) ??
    session?.user.user_metadata.full_name ??
    session?.user.user_metadata.name ??
    currentMember?.name ??
    session?.user.email?.split('@')[0] ??
    'Kamu'

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
      const matchesFilter = historyFilter === 'all' ? true : item.type === historyFilter
      const q = historyQuery.trim().toLowerCase()
      const matchesQuery = !q
        ? true
        : [item.title, item.category, item.account, item.note].join(' ').toLowerCase().includes(q)

      return matchesFilter && matchesQuery
    })
  }, [data.transactions, historyFilter, historyQuery])

  const budgetInsights = useMemo(() => {
    const sorted = [...data.budgets].sort((a, b) => b.spent - a.spent)
    const topCategory = sorted[0]
    const warningCount = data.budgets.filter((item) => item.limit && item.spent / item.limit >= 0.8).length

    return {
      topCategory,
      warningCount,
      transactionCount: data.transactions.length,
    }
  }, [data])

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
    setAuthFeedback({
      tone: 'loading',
      text: 'Sedang masuk...',
    })

    if (!supabaseEnabled || !supabase) {
      setAuthFeedback({
        tone: 'error',
        text: 'Belum bisa masuk. Coba lagi.',
      })
      setAuthLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authForm.email,
        password: authForm.password,
      })

      if (error) {
        setAuthFeedback({ tone: 'error', text: `Gagal masuk: ${toFriendlyAuthMessage(error.message, 'login')}` })
      } else {
        setAuthFeedback({ tone: 'success', text: 'Berhasil masuk.' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setAuthFeedback({ tone: 'error', text: toFriendlyAuthMessage(message, 'login') })
    }

    setAuthLoading(false)
  }

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut()
    }
    setDemoMode(false)
    setDemoProfileName('Demo User')
    setSession(null)
  }

  const openDemo = () => {
    setDemoMode(true)
    setDemoProfileName('Demo User')
    setActiveTab('home')
    setAuthFeedback({ tone: 'success', text: 'Mode demo dibuka.' })
  }

  const updateProfileName = async (name: string) => {
    const cleanName = name.trim()

    if (!cleanName) {
      return { ok: false, message: 'Nama tidak boleh kosong.' }
    }

    if (demoMode) {
      setDemoProfileName(cleanName)
      return { ok: true, message: 'Nama profile diperbarui.' }
    }

    if (!supabase) {
      return { ok: false, message: 'Profile belum bisa diperbarui.' }
    }

    const { data: updated, error } = await supabase.auth.updateUser({
      data: {
        full_name: cleanName,
      },
    })

    if (error) {
      return { ok: false, message: 'Nama profile belum bisa diubah.' }
    }

    if (updated.user && session) {
      setSession({
        ...session,
        user: updated.user,
      })
    }

    return { ok: true, message: 'Nama profile diperbarui.' }
  }

  const updateProfilePassword = async (password: string) => {
    const cleanPassword = password.trim()

    if (cleanPassword.length < 6) {
      return { ok: false, message: 'Password minimal 6 karakter.' }
    }

    if (demoMode) {
      return { ok: true, message: 'Password demo berhasil diubah.' }
    }

    if (!supabase) {
      return { ok: false, message: 'Password belum bisa diubah.' }
    }

    const { error } = await supabase.auth.updateUser({
      password: cleanPassword,
    })

    if (error) {
      return { ok: false, message: 'Password belum bisa diubah.' }
    }

    return { ok: true, message: 'Password berhasil diubah.' }
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
              <h1>Uang lebih rapi</h1>
            </div>
          </div>

          <p className="auth-copy">Masuk untuk mencatat uang masuk, keluar, budget, dan laporan bulanan.</p>

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

            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="Minimal 6 karakter"
              />
            </label>

            <button className="primary-button" disabled={authLoading}>
              {authLoading ? 'Memproses...' : 'Masuk'}
            </button>

            <button type="button" className="demo-login-button" onClick={openDemo}>
              Coba akun demo
            </button>
          </form>

          {authFeedback.text && (
            <div className={`auth-feedback ${authFeedback.tone}`}>
              <strong>
                {authFeedback.tone === 'loading'
                  ? 'Memproses'
                  : authFeedback.tone === 'success'
                    ? 'Berhasil'
                    : authFeedback.tone === 'error'
                      ? 'Gagal'
                      : 'Info'}
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
              <p>{isAdmin ? 'Admin panel' : userName}</p>
            </div>
          </div>

          <div className="header-actions">
            <button className="header-button" onClick={() => window.location.reload()} aria-label="Segarkan">
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
            <strong>{data.period.start} s/d {data.period.end}</strong>
          </div>
        </header>

        <section className="content">
          {loading ? (
            <div className="card">Memuat data budget...</div>
          ) : !canUseApp ? (
            <section className="card access-card">
              <div className="section-title">
                <h2>Belum terdaftar</h2>
                <ShieldCheck size={18} />
              </div>
              <p className="helper-text">Minta admin menambahkan email ini sebagai member.</p>
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
                      <strong>{budgetInsights.transactionCount}</strong>
                    </div>
                    <div>
                      <span>Peringatan</span>
                      <strong>{budgetInsights.warningCount}</strong>
                    </div>
                    <div>
                      <span>Periode</span>
                      <strong>{data.period.label}</strong>
                    </div>
                  </section>

                  <section className="spotlight-card">
                    <div>
                      <span className="spotlight-label">Pengeluaran bulan ini</span>
                      <strong>{currency(summary.totalSpent)}</strong>
                      <p>dari budget {currency(summary.totalBudget)}</p>
                    </div>
                    <div className="progress-ring">
                      <span>{Math.round(summary.budgetUsage)}%</span>
                    </div>
                  </section>

                  <section className="stats-grid">
                    <MetricCard icon={Wallet} label="Total saldo" value={currency(summary.totalBalance)} tone="violet" />
                    <MetricCard icon={ArrowDownLeft} label="Pemasukan" value={currency(summary.totalIncome)} tone="green" />
                    <MetricCard icon={ArrowUpRight} label="Sisa budget" value={currency(summary.remainingBudget)} tone="sky" />
                    <MetricCard icon={PiggyBank} label="Bisa ditabung" value={currency(totalSaved)} tone="amber" />
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Ringkas</h2>
                      <Sparkles size={18} />
                    </div>
                    <div className="insight-grid">
                      <article className="insight-card">
                        <div className="insight-icon success">
                          <TrendingUp size={18} />
                        </div>
                        <div>
                          <strong>Uang masih aman</strong>
                          <p>Bisa ditabung {currency(totalSaved)}.</p>
                        </div>
                      </article>
                      <article className="insight-card">
                        <div className={`insight-icon ${budgetInsights.warningCount ? 'warning' : 'success'}`}>
                          {budgetInsights.warningCount ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                        </div>
                        <div>
                          <strong>
                            {budgetInsights.warningCount ? `${budgetInsights.warningCount} budget mulai penuh` : 'Budget masih aman'}
                          </strong>
                          <p>
                            {budgetInsights.topCategory
                              ? `${budgetInsights.topCategory.name} paling banyak terpakai.`
                              : 'Tambahkan budget untuk mulai pantau uang.'}
                          </p>
                        </div>
                      </article>
                    </div>
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Aksi cepat</h2>
                      <span>Cepat</span>
                    </div>
                    <div className="quick-actions">
                      <button className="quick-action" onClick={() => setActiveTab('add')}>
                        <BadgeDollarSign size={18} />
                        <div>
                          <strong>Catat</strong>
                          <p>Masuk atau keluar</p>
                        </div>
                      </button>
                      <button className="quick-action" onClick={() => setActiveTab('budget')}>
                        <Target size={18} />
                        <div>
                          <strong>Budget</strong>
                          <p>Batas belanja</p>
                        </div>
                      </button>
                      <button className="quick-action" onClick={() => setActiveTab('history')}>
                        <CreditCard size={18} />
                        <div>
                          <strong>Riwayat</strong>
                          <p>Lihat transaksi</p>
                        </div>
                      </button>
                    </div>
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Unduh</h2>
                      <Download size={18} />
                    </div>
                    <div className="export-actions">
                      <button className="export-button" onClick={() => exportBudgetToPdf(exportPayload)}>
                        <FileText size={18} />
                        <div>
                          <strong>Unduh PDF</strong>
                          <p>Rekapan bulanan</p>
                        </div>
                      </button>
                      <button className="export-button" onClick={() => exportBudgetToExcel(exportPayload)}>
                        <FileSpreadsheet size={18} />
                        <div>
                          <strong>Unduh Excel</strong>
                          <p>Data tabel</p>
                        </div>
                      </button>
                    </div>
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Pengeluaran</h2>
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
                      <EmptyState
                        icon={Target}
                        title="Belum ada budget"
                        description="Tambahkan budget dulu agar grafik bisa tampil."
                      />
                    )}
                  </section>

                  <section className="card">
                    <div className="section-title">
                      <h2>Transaksi terbaru</h2>
                      <button className="text-button" onClick={() => setActiveTab('history')}>
                        Lihat
                      </button>
                    </div>
                    <TransactionList transactions={recentTransactions} onDelete={deleteTransaction} emptyLabel="Belum ada transaksi." />
                  </section>
                </>
              )}

              {activeTab === 'history' && !isAdmin && (
                <section className="card">
                  <div className="section-title">
                    <h2>Riwayat</h2>
                    <span>{filteredTransactions.length} item</span>
                  </div>
                  <div className="history-toolbar">
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        value={historyQuery}
                        onChange={(event) => setHistoryQuery(event.target.value)}
                        placeholder="Cari transaksi..."
                      />
                    </label>
                    <div className="filter-pills">
                      {[
                        { key: 'all', label: 'Semua' },
                        { key: 'expense', label: 'Pengeluaran' },
                        { key: 'income', label: 'Pemasukan' },
                        { key: 'transfer', label: 'Transfer' },
                      ].map((item) => (
                        <button
                          key={item.key}
                          className={historyFilter === item.key ? 'filter-pill active' : 'filter-pill'}
                          onClick={() => setHistoryFilter(item.key as 'all' | TransactionType)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
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
                    emptyLabel="Tidak ada transaksi yang cocok."
                  />
                </section>
              )}

              {activeTab === 'add' && !isAdmin && (
                <AddTransactionPanel
                  accounts={data.accounts.map((item) => item.name)}
                  categories={data.budgets.map((item) => item.name)}
                  onSubmit={addTransaction}
                  onOpenSetup={() => setActiveTab('wallet')}
                  onOpenBudget={() => setActiveTab('budget')}
                />
              )}

              {activeTab === 'budget' && !isAdmin && (
                <>
                  <BudgetPeriodPanel start={data.period.start} end={data.period.end} label={data.period.label} onSave={updatePeriod} />

                  <section className="stats-grid">
                    <MetricCard icon={CircleDollarSign} label="Total budget" value={currency(summary.totalBudget)} tone="violet" />
                    <MetricCard icon={PiggyBank} label="Sisa dana" value={currency(summary.remainingBudget)} tone="green" />
                  </section>

                  <AddBudgetPanel onSubmit={addBudget} />

                  <section className="card">
                    <div className="section-title">
                      <h2>Daftar budget</h2>
                      <span>Kategori</span>
                    </div>

                    <div className="budget-list">
                      {data.budgets.length ? (
                        data.budgets.map((item) => {
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
                                <span>{Math.round(pct)}%</span>
                              </div>
                              <div className="progress-track">
                                <div className="progress-fill" style={{ width: `${pct}%`, background: item.color }} />
                              </div>
                            </article>
                          )
                        })
                      ) : (
                        <EmptyState
                          icon={Target}
                          title="Belum ada budget"
                          description="Tambahkan budget dulu."
                        />
                      )}
                    </div>
                  </section>
                </>
              )}

              {activeTab === 'wallet' && !isAdmin && (
                <WalletPanel
                  accounts={data.accounts}
                  totalBalance={summary.totalBalance}
                  onAddAccount={addAccount}
                />
              )}

              {activeTab === 'profile' && !isAdmin && (
                <ProfilePanel
                  userName={userName}
                  email={appUserEmail ?? '-'}
                  onSaveName={updateProfileName}
                  onSavePassword={updateProfilePassword}
                />
              )}

              {activeTab === 'setup' && isAdmin && (
                <>
                  <AdminPanel
                    members={data.members}
                    onAddMember={addMember}
                    onDeleteMember={deleteMember}
                  />
                </>
              )}
            </>
          )}
        </section>

        <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${navItems.length}, 1fr)` }}>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = activeTab === item.key

            return (
              <button
                key={item.key}
                className={active ? 'nav-item active' : 'nav-item'}
                onClick={() => setActiveTab(item.key)}
              >
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
        <MetricCard icon={Wallet} label="Total saldo" value={currency(totalBalance)} tone="violet" />
        <MetricCard icon={CreditCard} label="Jumlah dompet" value={`${accounts.length} akun`} tone="green" />
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
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="BCA, Cash, Dana"
            />
          </label>
          <label className="field-block">
            <span>Saldo awal</span>
            <input
              value={form.balance}
              onChange={(event) => setForm((prev) => ({ ...prev, balance: event.target.value }))}
              placeholder="0"
              type="number"
            />
          </label>
          <button className="primary-button">Simpan dompet</button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Daftar dompet</h2>
          <span>{accounts.length} akun</span>
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
            <EmptyState icon={Wallet} title="Belum ada dompet" description="Tambahkan dompet pertama." />
          )}
        </div>
      </section>
    </>
  )
}

function ProfilePanel({
  userName,
  email,
  onSaveName,
  onSavePassword,
}: {
  userName: string
  email: string
  onSaveName: (name: string) => Promise<{ ok: boolean; message: string }>
  onSavePassword: (password: string) => Promise<{ ok: boolean; message: string }>
}) {
  const [name, setName] = useState(userName)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setName(userName)
  }, [userName])

  return (
    <>
      <section className="card profile-hero">
        <div className="profile-avatar">{userName.slice(0, 1).toUpperCase()}</div>
        <div className="profile-copy">
          <p className="profile-label">Profile</p>
          <h2>{userName}</h2>
          <span>{email}</span>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Ubah nama</h2>
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
            <span>Nama profile</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama kamu" />
          </label>
          <button className="primary-button">Simpan nama</button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Ubah password</h2>
          <Settings size={18} />
        </div>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            const result = await onSavePassword(password)
            setMessage(result.message)
            if (result.ok) {
              setPassword('')
            }
          }}
        >
          <label className="field-block">
            <span>Password baru</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimal 6 karakter"
            />
          </label>
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

  return (
    <>
      <section className="card">
        <div className="section-title">
          <h2>Admin</h2>
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
            <span>Nama member</span>
            <input value={member.name} onChange={(event) => setMember((prev) => ({ ...prev, name: event.target.value }))} placeholder="Nama" />
          </label>
          <label className="field-block">
            <span>Email</span>
            <input value={member.email} onChange={(event) => setMember((prev) => ({ ...prev, email: event.target.value }))} placeholder="email@contoh.com" type="email" />
          </label>
          <label className="field-block">
            <span>Password</span>
            <input value={member.password} onChange={(event) => setMember((prev) => ({ ...prev, password: event.target.value }))} placeholder="Minimal 6 karakter" type="password" />
          </label>
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
            Tambah member
          </button>
          {memberMessage && <p className="small-note">{memberMessage}</p>}
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Member</h2>
          <span>{members.length} orang</span>
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
                <button className="delete-member-button" onClick={() => onDeleteMember(item.id)} aria-label="Hapus member">
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          ) : (
            <EmptyState icon={UsersRound} title="Belum ada member" description="Tambahkan member pertama." />
          )}
        </div>
      </section>
    </>
  )
}

function AddBudgetPanel({ onSubmit }: { onSubmit: (payload: { name: string; limit: number }) => Promise<void> }) {
  const [name, setName] = useState('')
  const [limit, setLimit] = useState('')

  return (
    <section className="card">
      <div className="section-title">
        <h2>Tambah budget</h2>
        <Target size={18} />
      </div>
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name || !limit) return
          await onSubmit({ name, limit: Number(limit) })
          setName('')
          setLimit('')
        }}
      >
        <label className="field-block">
          <span>Kategori budget</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Makan" />
        </label>
        <label className="field-block">
          <span>Limit anggaran</span>
          <input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="0" type="number" />
        </label>
        <button className="primary-button">Simpan budget</button>
      </form>
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
        <h2>Periode budget</h2>
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
  onSubmit,
  onOpenSetup,
  onOpenBudget,
}: {
  accounts: string[]
  categories: string[]
  onSubmit: (payload: {
    title: string
    amount: number
    type: TransactionType
    category: string
    account: string
    date: string
    note: string
  }) => Promise<void>
  onOpenSetup: () => void
  onOpenBudget: () => void
}) {
  const [form, setForm] = useState({
    title: '',
    amount: '',
    type: 'expense' as TransactionType,
    category: categories[0] ?? 'Umum',
    account: accounts[0] ?? 'Cash',
    date: new Date().toISOString().slice(0, 10),
    note: '',
  })

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      category: categories[0] ?? prev.category,
      account: accounts[0] ?? prev.account,
    }))
  }, [accounts, categories])

  const canSubmit = accounts.length > 0 && categories.length > 0

  return (
    <section className="card">
      <div className="section-title">
        <h2>Catat</h2>
        <BadgeDollarSign size={18} />
      </div>
      {!canSubmit ? (
        <div className="setup-guide">
          <EmptyState icon={BadgeDollarSign} title="Belum siap" description="Buat dompet dan budget dulu." />
          <div className="setup-guide-actions">
            {!accounts.length && (
              <button type="button" className="soft-button" onClick={onOpenSetup}>
                Buka dompet
              </button>
            )}
            {!categories.length && (
              <button type="button" className="soft-button" onClick={onOpenBudget}>
                Buka budget
              </button>
            )}
          </div>
        </div>
      ) : (
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!form.title || !form.amount || !canSubmit) return
          await onSubmit({
            title: form.title,
            amount: Number(form.amount),
            type: form.type,
            category: form.category,
            account: form.account,
            date: form.date,
            note: form.note,
          })
          setForm((prev) => ({
            ...prev,
            title: '',
            amount: '',
            note: '',
          }))
        }}
      >
        <div className="toggle-grid">
          {(['expense', 'income', 'transfer'] as TransactionType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={form.type === type ? 'toggle-pill active' : 'toggle-pill'}
              onClick={() => setForm((prev) => ({ ...prev, type }))}
            >
              {type === 'expense' ? 'Pengeluaran' : type === 'income' ? 'Pemasukan' : 'Transfer'}
            </button>
          ))}
        </div>

        <label className="field-block">
          <span>Nama transaksi</span>
          <input
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Makan siang"
          />
        </label>
        <label className="field-block">
          <span>Nominal</span>
          <input
            value={form.amount}
            onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
            placeholder="0"
            type="number"
          />
        </label>
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
        <label className="field-block">
          <span>Akun</span>
          <select value={form.account} onChange={(event) => setForm((prev) => ({ ...prev, account: event.target.value }))}>
            {accounts.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span>Tanggal</span>
          <input type="date" value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} />
        </label>
        <label className="field-block">
          <span>Catatan</span>
          <textarea
            value={form.note}
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
            rows={3}
            placeholder="Catatan opsional"
          />
        </label>
        <button className="primary-button">Simpan</button>
      </form>
      )}
    </section>
  )
}

function TransactionList({
  transactions,
  onDelete,
  emptyLabel,
}: {
  transactions: Array<{
    id: string
    title: string
    amount: number
    type: TransactionType
    category: string
    account: string
    date: string
  }>
  onDelete: (id: string) => Promise<void>
  emptyLabel: string
}) {
  if (!transactions.length) {
    return <EmptyState icon={ReceiptText} title="Belum ada data" description={emptyLabel} compact />
  }

  return (
    <div className="transaction-list">
      {transactions.map((item) => {
        const Icon = transactionIcons[item.type]

        return (
          <article className="transaction-row" key={item.id}>
            <div className={`transaction-icon ${item.type}`}>
              <Icon size={18} />
            </div>
            <div className="transaction-copy">
              <strong>{item.title}</strong>
              <p>
                {item.category} - {item.account} - {compactDate(item.date)}
              </p>
            </div>
            <div className="transaction-side">
              <strong className={item.type === 'expense' ? 'minus' : 'plus'}>
                {item.type === 'expense' ? '-' : '+'}
                {currency(item.amount)}
              </strong>
              <button className="delete-button" onClick={() => onDelete(item.id)}>
                Hapus
              </button>
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
