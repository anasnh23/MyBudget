import { useEffect, useMemo, useState } from 'react'
import { addDays, addMonths, todayIso } from '../lib/format'
import { initialBudgetData } from '../lib/mockData'
import { supabase, supabaseEnabled } from '../lib/supabase'
import type {
  Account,
  AssetItem,
  BudgetCategory,
  BudgetData,
  BudgetPeriod,
  Member,
  RecurringFrequency,
  RecurringTransaction,
  SavingGoal,
  TransactionItem,
} from '../types'

const uid = () => crypto.randomUUID()

const accountColors = ['#6346f7', '#13b981', '#06b6d4', '#f97316', '#ec4899']
const metaPrefix = '__MYBUDGET_META__'

type SaveResult = {
  ok: boolean
  message: string
}

type PeriodCreationMode = 'reset' | 'rollover'

type RolloverSnapshot = {
  period: BudgetPeriod
  budgets: Array<Pick<BudgetCategory, 'id' | 'periodId' | 'limit' | 'spent' | 'rollover'>>
  appliedAt: string
}

function ok(message: string): SaveResult {
  return { ok: true, message }
}

function fail(message: string): SaveResult {
  return { ok: false, message }
}

function isMissingColumnError(message: string) {
  const text = message.toLowerCase()
  return text.includes('column') || text.includes('schema cache') || text.includes('could not find')
}

function isMissingTableError(message: string) {
  const text = message.toLowerCase()
  return text.includes('relation') && text.includes('does not exist')
}

function encodeTransactionNote(transaction: Pick<TransactionItem, 'note' | 'toAccount' | 'member'>) {
  const meta = {
    toAccount: transaction.toAccount,
    member: transaction.member,
  }

  if (!meta.toAccount && !meta.member) {
    return transaction.note
  }

  return `${metaPrefix}${JSON.stringify(meta)}\n${transaction.note ?? ''}`
}

function decodeTransactionNote(note?: string | null) {
  const cleanNote = note ?? ''

  if (!cleanNote.startsWith(metaPrefix)) {
    return {
      note: cleanNote,
      toAccount: undefined as string | undefined,
      member: undefined as string | undefined,
    }
  }

  const [metaLine, ...noteLines] = cleanNote.split('\n')

  try {
    const meta = JSON.parse(metaLine.slice(metaPrefix.length)) as {
      toAccount?: string
      member?: string
    }

    return {
      note: noteLines.join('\n'),
      toAccount: meta.toAccount,
      member: meta.member,
    }
  } catch {
    return {
      note: cleanNote,
      toAccount: undefined as string | undefined,
      member: undefined as string | undefined,
    }
  }
}

function saveMessage(message: string) {
  const text = message.toLowerCase()

  if (text.includes('row-level security') || text.includes('violates row-level security')) {
    return 'Data belum tersimpan. Periksa izin akses Supabase.'
  }

  if (text.includes('permission denied')) {
    return 'Data belum tersimpan. Izin tabel belum aktif.'
  }

  if (text.includes('relation') && text.includes('does not exist')) {
    return 'Data belum tersimpan. Tabel belum tersedia di Supabase.'
  }

  if (isMissingColumnError(message)) {
    return 'Data belum tersimpan lengkap. Jalankan ulang supabase-schema.sql.'
  }

  return 'Data belum tersimpan. Periksa koneksi atau pengaturan Supabase.'
}

function memberSaveMessage(message: string) {
  const text = message.toLowerCase()

  if (text.includes('row-level security') || text.includes('violates row-level security')) {
    return 'Member belum tersimpan. Cek izin akses tabel member di Supabase.'
  }

  if (text.includes('relation') && text.includes('does not exist')) {
    return 'Member belum tersimpan. Tabel member belum dibuat di Supabase.'
  }

  if (text.includes('permission denied')) {
    return 'Member belum tersimpan. Izin tabel member belum aktif.'
  }

  if (text.includes('duplicate') || text.includes('already exists')) {
    return 'Email member sudah ada.'
  }

  return 'Member belum tersimpan. Cek koneksi dan pengaturan Supabase.'
}

function periodContainsDate(period: BudgetPeriod, date: string) {
  return date >= period.start && date <= period.end
}

function buildVisibleData(
  periods: BudgetPeriod[],
  activePeriodId: string,
  accounts: Account[],
  members: Member[],
  budgets: BudgetCategory[],
  transactions: TransactionItem[],
): BudgetData {
  const activePeriod = periods.find((item) => item.id === activePeriodId) ?? periods[0] ?? initialBudgetData.period

  return {
    period: activePeriod,
    periods,
    accounts,
    members,
    budgets: budgets.filter((item) => item.periodId === activePeriod.id),
    transactions: transactions
      .filter((item) => item.periodId === activePeriod.id)
      .sort((left, right) => right.date.localeCompare(left.date)),
  }
}

function applyTransactionImpact(
  accounts: Account[],
  budgets: BudgetCategory[],
  transaction: TransactionItem,
  direction: 1 | -1,
) {
  const nextAccounts = accounts.map((item) => {
    if (transaction.type === 'transfer') {
      if (item.name === transaction.account) {
        return { ...item, balance: item.balance - transaction.amount * direction }
      }

      if (transaction.toAccount && item.name === transaction.toAccount) {
        return { ...item, balance: item.balance + transaction.amount * direction }
      }

      return item
    }

    if (item.name !== transaction.account) {
      return item
    }

    return {
      ...item,
      balance:
        transaction.type === 'income'
          ? item.balance + transaction.amount * direction
          : item.balance - transaction.amount * direction,
    }
  })

  const nextBudgets = budgets.map((item) =>
    item.periodId === transaction.periodId && item.name === transaction.category && transaction.type === 'expense'
      ? { ...item, spent: Math.max(item.spent + transaction.amount * direction, 0) }
      : item,
  )

  return { accounts: nextAccounts, budgets: nextBudgets }
}

function nextRecurringDate(startDate: string, frequency: RecurringFrequency) {
  return frequency === 'weekly' ? addDays(startDate, 7) : addMonths(startDate, 1)
}

function storageKey(prefix: string, userId?: string) {
  return `mybudget:${prefix}:${userId ?? 'guest'}`
}

function readLocalItems<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function resolveTransactionPeriodId(date: string, periods: BudgetPeriod[], activePeriodId: string) {
  return periods.find((item) => periodContainsDate(item, date))?.id ?? activePeriodId
}

function pickBudgetSourcePeriodId(periods: BudgetPeriod[], budgets: BudgetCategory[], activePeriodId: string) {
  const activeBudgets = budgets.filter((item) => item.periodId === activePeriodId)
  if (activeBudgets.length) {
    return activePeriodId
  }

  return periods.find((period) => period.id !== activePeriodId && budgets.some((item) => item.periodId === period.id))?.id
}

export function useBudgetData(userId?: string, userEmail?: string, demoMode = false) {
  const shouldUseSupabase = supabaseEnabled && !demoMode
  const [periods, setPeriods] = useState<BudgetPeriod[]>(initialBudgetData.periods)
  const [activePeriodId, setActivePeriodId] = useState(initialBudgetData.period.id)
  const [accounts, setAccounts] = useState<Account[]>(initialBudgetData.accounts)
  const [members, setMembers] = useState<Member[]>(initialBudgetData.members)
  const [budgets, setBudgets] = useState<BudgetCategory[]>(initialBudgetData.budgets)
  const [transactions, setTransactions] = useState<TransactionItem[]>(initialBudgetData.transactions)
  const [loading, setLoading] = useState(supabaseEnabled && !demoMode)
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([])
  const [savingGoals, setSavingGoals] = useState<SavingGoal[]>([])
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [lastRolloverSnapshot, setLastRolloverSnapshot] = useState<RolloverSnapshot | null>(null)

  const data = useMemo(
    () => buildVisibleData(periods, activePeriodId, accounts, members, budgets, transactions),
    [periods, activePeriodId, accounts, members, budgets, transactions],
  )

  useEffect(() => {
    setRecurringTransactions(readLocalItems(storageKey('recurring', userId), [] as RecurringTransaction[]))
    setSavingGoals(readLocalItems(storageKey('goals', userId), [] as SavingGoal[]))
    setAssets(readLocalItems(storageKey('assets', userId), [] as AssetItem[]))
    setLastRolloverSnapshot(readLocalItems(storageKey('rollover-snapshot', userId), null as RolloverSnapshot | null))
  }, [userId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(storageKey('recurring', userId), JSON.stringify(recurringTransactions))
  }, [recurringTransactions, userId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(storageKey('goals', userId), JSON.stringify(savingGoals))
  }, [savingGoals, userId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(storageKey('assets', userId), JSON.stringify(assets))
  }, [assets, userId])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!lastRolloverSnapshot) {
      window.localStorage.removeItem(storageKey('rollover-snapshot', userId))
      return
    }

    window.localStorage.setItem(storageKey('rollover-snapshot', userId), JSON.stringify(lastRolloverSnapshot))
  }, [lastRolloverSnapshot, userId])

  useEffect(() => {
    if (demoMode) {
      setPeriods(initialBudgetData.periods)
      setActivePeriodId(initialBudgetData.period.id)
      setAccounts(initialBudgetData.accounts)
      setMembers(initialBudgetData.members)
      setBudgets(initialBudgetData.budgets)
      setTransactions(initialBudgetData.transactions)
      setLoading(false)
      return
    }

    if (!shouldUseSupabase || !supabase || !userId) {
      setLoading(false)
      return
    }

    const client = supabase
    let mounted = true

    const load = async () => {
      setLoading(true)

      const [
        accountsResult,
        budgetsResult,
        transactionsResult,
        periodEntriesResult,
        legacyPeriodResult,
        ownerMembersResult,
        emailMembersResult,
      ] = await Promise.all([
        client.from('accounts').select('*').eq('user_id', userId).order('created_at'),
        client.from('budget_categories').select('*').eq('user_id', userId).order('created_at'),
        client.from('transactions').select('*').eq('user_id', userId).order('date', { ascending: false }),
        client.from('budget_period_entries').select('*').eq('user_id', userId).order('start_date', { ascending: false }),
        client.from('budget_periods').select('*').eq('user_id', userId).limit(1),
        client.from('members').select('*').eq('user_id', userId).order('created_at'),
        userEmail ? client.from('members').select('*').ilike('email', userEmail).limit(1) : Promise.resolve({ data: [] }),
      ])

      if (!mounted) return

      const legacyPeriod = legacyPeriodResult.data?.[0]
      const loadedPeriods =
        !periodEntriesResult.error && periodEntriesResult.data?.length
          ? periodEntriesResult.data.map((item) => ({
              id: item.id,
              label: item.label,
              start: item.start_date,
              end: item.end_date,
            }))
          : legacyPeriod
            ? [
                {
                  id: `legacy-${userId}`,
                  label: legacyPeriod.label,
                  start: legacyPeriod.start_date,
                  end: legacyPeriod.end_date,
                },
              ]
            : initialBudgetData.periods

      const nextActivePeriodId =
        (!periodEntriesResult.error && periodEntriesResult.data?.find((item) => item.is_active)?.id) ??
        loadedPeriods[0]?.id ??
        initialBudgetData.period.id

      const normalizedAccounts =
        accountsResult.data?.map((item, index) => ({
          id: item.id,
          name: item.name,
          balance: Number(item.balance),
          color: item.color ?? accountColors[index % accountColors.length],
        })) ?? []

      const memberMap = new Map([...(ownerMembersResult.data ?? []), ...(emailMembersResult.data ?? [])].map((item) => [item.id, item]))
      const normalizedMembers = Array.from(memberMap.values()).map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        role: item.role,
      }))

      const normalizedTransactions =
        transactionsResult.data?.map((item) => {
          const decoded = decodeTransactionNote(item.note)
          const periodId =
            item.period_id ??
            resolveTransactionPeriodId(item.date, loadedPeriods, nextActivePeriodId)

          return {
            id: item.id,
            periodId,
            title: item.title,
            amount: Number(item.amount),
            type: item.type,
            category: item.category,
            account: item.account_name,
            toAccount: item.to_account_name ?? decoded.toAccount,
            member: item.member_name ?? decoded.member,
            date: item.date,
            note: decoded.note,
          }
        }) ?? []

      const normalizedBudgets =
        budgetsResult.data?.map((item, index) => {
          const periodId = item.period_id ?? nextActivePeriodId
          return {
            id: item.id,
            periodId,
            name: item.name,
            limit: Number(item.limit_amount),
            spent: normalizedTransactions
              .filter((entry) => entry.periodId === periodId && entry.type === 'expense' && entry.category === item.name)
              .reduce((sum, entry) => sum + entry.amount, 0),
            color: item.color ?? accountColors[index % accountColors.length],
            rollover: Boolean(item.rollover_enabled),
          }
        }) ?? []

      setPeriods(loadedPeriods)
      setActivePeriodId(nextActivePeriodId)
      setAccounts(normalizedAccounts)
      setMembers(normalizedMembers)
      setBudgets(normalizedBudgets)
      setTransactions(normalizedTransactions)
      setLoading(false)
    }

    load()

    return () => {
      mounted = false
    }
  }, [demoMode, shouldUseSupabase, userId, userEmail])

  const summary = useMemo(() => {
    const totalBalance = data.accounts.reduce((sum, item) => sum + item.balance, 0)
    const totalBudget = data.budgets.reduce((sum, item) => sum + item.limit, 0)
    const totalSpent = data.budgets.reduce((sum, item) => sum + item.spent, 0)
    const totalIncome = data.transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
    const totalExpense = data.transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)

    return {
      totalBalance,
      totalBudget,
      totalSpent,
      totalIncome,
      totalExpense,
      remainingBudget: Math.max(totalBudget - totalSpent, 0),
      budgetUsage: totalBudget ? Math.min((totalSpent / totalBudget) * 100, 100) : 0,
    }
  }, [data])

  const dueRecurringCount = useMemo(() => {
    const today = todayIso()
    return recurringTransactions.filter((item) => item.nextDate <= today).length
  }, [recurringTransactions])

  const persistBudgetRows = async (items: BudgetCategory[]) => {
    if (!shouldUseSupabase || !supabase || !userId || !items.length) {
      return ok('Data tersimpan.')
    }

    const client = supabase
    const results = await Promise.all(
      items.map((item) =>
        client
          .from('budget_categories')
          .update({
            name: item.name,
            limit_amount: item.limit,
            spent_amount: item.spent,
            rollover_enabled: item.rollover,
            period_id: item.periodId,
          })
          .eq('id', item.id),
      ),
    )

    const error = results.find((item) => item.error)?.error
    if (!error) return ok('Data tersimpan.')
    if (isMissingColumnError(error.message)) {
      return fail('Data periode belum tersimpan lengkap. Jalankan ulang supabase-schema.sql.')
    }
    return fail(saveMessage(error.message))
  }

  const persistBalances = async (nextAccounts: Account[], nextBudgets: BudgetCategory[]) => {
    if (!shouldUseSupabase || !supabase || !userId) {
      return ok('Data tersimpan.')
    }

    const client = supabase
    const results = await Promise.all([
      ...nextAccounts.map((item) => client.from('accounts').update({ balance: item.balance }).eq('id', item.id)),
      ...nextBudgets.map((item) => client.from('budget_categories').update({ spent_amount: item.spent }).eq('id', item.id)),
    ])

    const error = results.find((item) => item.error)?.error
    if (error) {
      return fail(saveMessage(error.message))
    }

    return ok('Data tersimpan.')
  }

  const insertTransactionToSupabase = async (transaction: TransactionItem) => {
    if (!shouldUseSupabase || !supabase || !userId) {
      return ok('Transaksi tersimpan.')
    }

    const client = supabase
    const payload = {
      id: transaction.id,
      user_id: userId,
      period_id: transaction.periodId,
      title: transaction.title,
      amount: transaction.amount,
      type: transaction.type,
      category: transaction.category,
      account_name: transaction.account,
      date: transaction.date,
      note: transaction.note,
      to_account_name: transaction.toAccount ?? null,
      member_name: transaction.member ?? null,
    }

    const { error } = await client.from('transactions').insert(payload)

    if (!error) {
      return ok('Transaksi tersimpan.')
    }

    if (!isMissingColumnError(error.message)) {
      return fail(saveMessage(error.message))
    }

    const fallback = await client.from('transactions').insert({
      ...payload,
      note: encodeTransactionNote(transaction),
    })

    if (fallback.error) {
      return fail(saveMessage(fallback.error.message))
    }

    return ok('Transaksi tersimpan. Jalankan ulang supabase-schema.sql agar transaksi bisa dipisah per periode.')
  }

  const updateTransactionInSupabase = async (transaction: TransactionItem) => {
    if (!shouldUseSupabase || !supabase || !userId) {
      return ok('Transaksi diperbarui.')
    }

    const client = supabase
    const payload = {
      period_id: transaction.periodId,
      title: transaction.title,
      amount: transaction.amount,
      type: transaction.type,
      category: transaction.category,
      account_name: transaction.account,
      date: transaction.date,
      note: transaction.note,
      to_account_name: transaction.toAccount ?? null,
      member_name: transaction.member ?? null,
    }

    const { error } = await client.from('transactions').update(payload).eq('id', transaction.id)

    if (!error) {
      return ok('Transaksi diperbarui.')
    }

    if (!isMissingColumnError(error.message)) {
      return fail(saveMessage(error.message))
    }

    const fallback = await client
      .from('transactions')
      .update({
        ...payload,
        note: encodeTransactionNote(transaction),
      })
      .eq('id', transaction.id)

    if (fallback.error) {
      return fail(saveMessage(fallback.error.message))
    }

    return ok('Transaksi diperbarui. Jalankan ulang supabase-schema.sql agar transaksi bisa dipisah per periode.')
  }

  const syncActivePeriodInSupabase = async (periodId: string) => {
    if (!shouldUseSupabase || !supabase || !userId) {
      return ok('Periode aktif berpindah.')
    }

    const client = supabase
    const reset = await client.from('budget_period_entries').update({ is_active: false }).eq('user_id', userId)
    const activate = await client.from('budget_period_entries').update({ is_active: true }).eq('id', periodId)

    if (!reset.error && !activate.error) {
      return ok('Periode aktif berpindah.')
    }

    const error = reset.error ?? activate.error
    if (error && (isMissingTableError(error.message) || isMissingColumnError(error.message))) {
      return ok('Periode aktif berpindah. Jalankan ulang supabase-schema.sql agar pilihan periode tersimpan di Supabase.')
    }

    return fail(saveMessage(error?.message ?? ''))
  }

  const addAccount = async (payload: { name: string; balance: number }) => {
    const nextAccount: Account = {
      id: uid(),
      name: payload.name,
      balance: payload.balance,
      color: accountColors[accounts.length % accountColors.length],
    }

    setAccounts((prev) => [nextAccount, ...prev])

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('accounts').insert({
        id: nextAccount.id,
        user_id: userId,
        name: nextAccount.name,
        balance: nextAccount.balance,
        color: nextAccount.color,
      })

      if (error) {
        setAccounts((prev) => prev.filter((item) => item.id !== nextAccount.id))
        return fail(saveMessage(error.message))
      }
    }

    return ok('Dompet tersimpan.')
  }

  const addMember = async (payload: { name: string; email: string; password: string; role: string }) => {
    const cleanEmail = payload.email.trim().toLowerCase()
    const cleanRole = payload.role.trim()
    const nextMember: Member = {
      id: uid(),
      name: payload.name.trim(),
      email: cleanEmail,
      role: cleanRole,
    }

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('members').insert({
        id: nextMember.id,
        user_id: userId,
        name: nextMember.name,
        email: nextMember.email,
        role: nextMember.role,
      })

      if (error) {
        return { ok: false, message: memberSaveMessage(error.message) }
      }

      const { data: currentSession } = await supabase.auth.getSession()
      const { error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: payload.password,
        options: { data: { full_name: payload.name, role: payload.role } },
      })

      if (currentSession.session) {
        await supabase.auth.setSession({
          access_token: currentSession.session.access_token,
          refresh_token: currentSession.session.refresh_token,
        })
      }

      setMembers((prev) => [nextMember, ...prev])

      if (signUpError && !signUpError.message.toLowerCase().includes('already')) {
        return { ok: true, message: 'Member tersimpan, tapi belum bisa login.' }
      }

      return { ok: true, message: 'Member tersimpan.' }
    }

    setMembers((prev) => [nextMember, ...prev])
    return { ok: true, message: 'Member tersimpan.' }
  }

  const deleteMember = async (id: string) => {
    setMembers((prev) => prev.filter((item) => item.id !== id))

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('members').delete().eq('id', id)
    }
  }

  const addBudget = async (payload: { name: string; limit: number; rollover: boolean }) => {
    const nextBudget: BudgetCategory = {
      id: uid(),
      periodId: activePeriodId,
      name: payload.name,
      limit: payload.limit,
      spent: 0,
      color: accountColors[data.budgets.length % accountColors.length],
      rollover: payload.rollover,
    }

    setBudgets((prev) => [nextBudget, ...prev])

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('budget_categories').insert({
        id: nextBudget.id,
        user_id: userId,
        period_id: nextBudget.periodId,
        name: nextBudget.name,
        limit_amount: nextBudget.limit,
        spent_amount: nextBudget.spent,
        rollover_enabled: nextBudget.rollover,
        color: nextBudget.color,
      })

      if (error) {
        setBudgets((prev) => prev.filter((item) => item.id !== nextBudget.id))

        if (isMissingColumnError(error.message)) {
          return fail('Anggaran belum tersimpan per periode. Jalankan ulang supabase-schema.sql.')
        }

        return fail(saveMessage(error.message))
      }
    }

    return ok('Anggaran tersimpan untuk periode aktif.')
  }

  const updateBudget = async (id: string, payload: { name: string; limit: number; rollover: boolean }) => {
    const currentBudget = budgets.find((item) => item.id === id)

    setBudgets((prev) =>
      prev.map((item) => (item.id === id ? { ...item, name: payload.name, limit: payload.limit, rollover: payload.rollover } : item)),
    )

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase
        .from('budget_categories')
        .update({
          name: payload.name,
          limit_amount: payload.limit,
          rollover_enabled: payload.rollover,
        })
        .eq('id', id)

      if (error) {
        if (currentBudget) {
          setBudgets((prev) => prev.map((item) => (item.id === id ? currentBudget : item)))
        }
        return fail(saveMessage(error.message))
      }
    }

    return ok('Anggaran diperbarui.')
  }

  const deleteBudget = async (id: string) => {
    const currentBudget = budgets.find((item) => item.id === id)

    if (!currentBudget) {
      return fail('Anggaran tidak ditemukan.')
    }

    setBudgets((prev) => prev.filter((item) => item.id !== id))

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('budget_categories').delete().eq('id', id)

      if (error) {
        setBudgets((prev) => [currentBudget, ...prev])
        return fail(saveMessage(error.message))
      }
    }

    return ok('Anggaran dihapus.')
  }

  const updatePeriod = async (payload: Omit<BudgetPeriod, 'id'>, mode: PeriodCreationMode = 'reset') => {
    const nextPeriod: BudgetPeriod = {
      id: uid(),
      label: payload.label,
      start: payload.start,
      end: payload.end,
    }

    const sourcePeriodId = pickBudgetSourcePeriodId(periods, budgets, activePeriodId) ?? activePeriodId
    const sourceBudgets = budgets.filter((item) => item.periodId === sourcePeriodId)
    const nextBudgets = sourceBudgets.map((item) => {
      const carry = item.limit - item.spent
      return {
        ...item,
        id: uid(),
        periodId: nextPeriod.id,
        limit: mode === 'rollover' && item.rollover ? Math.max(item.limit + carry, 0) : item.limit,
        spent: 0,
      }
    })

    setPeriods((prev) => [nextPeriod, ...prev])
    setActivePeriodId(nextPeriod.id)
    setBudgets((prev) => [...nextBudgets, ...prev])
    setLastRolloverSnapshot(null)

    if (shouldUseSupabase && supabase && userId) {
      const periodResult = await supabase.from('budget_period_entries').insert({
        id: nextPeriod.id,
        user_id: userId,
        label: nextPeriod.label,
        start_date: nextPeriod.start,
        end_date: nextPeriod.end,
        is_active: true,
      })

      if (periodResult.error) {
        if (isMissingTableError(periodResult.error.message) || isMissingColumnError(periodResult.error.message)) {
          return ok('Periode baru dibuat lokal. Jalankan ulang supabase-schema.sql agar riwayat periode tersimpan di Supabase.')
        }

        return fail(saveMessage(periodResult.error.message))
      }

      await supabase.from('budget_period_entries').update({ is_active: false }).eq('user_id', userId).neq('id', nextPeriod.id)

      if (nextBudgets.length) {
        const budgetResult = await supabase.from('budget_categories').insert(
          nextBudgets.map((item) => ({
            id: item.id,
            user_id: userId,
            period_id: item.periodId,
            name: item.name,
            limit_amount: item.limit,
            spent_amount: item.spent,
            rollover_enabled: item.rollover,
            color: item.color,
          })),
        )

        if (budgetResult.error) {
          return fail(saveMessage(budgetResult.error.message))
        }
      }
    }

    return ok(
      mode === 'rollover'
        ? `Periode ${nextPeriod.label} dibuat dan sisa anggaran ikut dibawa.`
        : `Periode ${nextPeriod.label} dibuat dengan anggaran baru dari nominal dasar.`,
    )
  }

  const selectPeriod = async (periodId: string) => {
    setActivePeriodId(periodId)
    setLastRolloverSnapshot(null)
    return syncActivePeriodInSupabase(periodId)
  }

  const copyBudgetsFromPreviousPeriod = async () => {
    const sourcePeriodId = pickBudgetSourcePeriodId(periods, budgets, activePeriodId)

    if (!sourcePeriodId || sourcePeriodId === activePeriodId) {
      return fail('Belum ada anggaran periode sebelumnya yang bisa disalin.')
    }

    const sourceBudgets = budgets.filter((item) => item.periodId === sourcePeriodId)
    const activeExpenses = transactions.filter((item) => item.periodId === activePeriodId && item.type === 'expense')
    const copiedBudgets = sourceBudgets.map((item) => ({
      ...item,
      id: uid(),
      periodId: activePeriodId,
      spent: activeExpenses
        .filter((entry) => entry.category === item.name)
        .reduce((sum, entry) => sum + entry.amount, 0),
    }))

    setBudgets((prev) => [...copiedBudgets, ...prev])

    if (shouldUseSupabase && supabase && userId) {
      const result = await supabase.from('budget_categories').insert(
        copiedBudgets.map((item) => ({
          id: item.id,
          user_id: userId,
          period_id: item.periodId,
          name: item.name,
          limit_amount: item.limit,
          spent_amount: item.spent,
          rollover_enabled: item.rollover,
          color: item.color,
        })),
      )

      if (result.error) {
        setBudgets((prev) => prev.filter((item) => !copiedBudgets.some((copied) => copied.id === item.id)))
        return fail(saveMessage(result.error.message))
      }
    }

    const sourcePeriod = periods.find((item) => item.id === sourcePeriodId)
    return ok(`Anggaran dari periode ${sourcePeriod?.label ?? 'sebelumnya'} berhasil disalin ke periode aktif.`)
  }

  const applyBudgetRollover = async () => {
    const activeBudgets = budgets.filter((item) => item.periodId === activePeriodId)

    if (!activeBudgets.length) {
      return fail('Belum ada anggaran yang bisa di-rollover.')
    }

    const snapshot: RolloverSnapshot = {
      period: data.period,
      budgets: activeBudgets.map((item) => ({
        id: item.id,
        periodId: item.periodId,
        limit: item.limit,
        spent: item.spent,
        rollover: item.rollover,
      })),
      appliedAt: new Date().toISOString(),
    }

    const rolledBudgets = budgets.map((item) => {
      if (item.periodId !== activePeriodId) {
        return item
      }

      if (!item.rollover) {
        return { ...item, spent: 0 }
      }

      const carry = item.limit - item.spent
      return {
        ...item,
        limit: Math.max(item.limit + carry, 0),
        spent: 0,
      }
    })

    setLastRolloverSnapshot(snapshot)
    setBudgets(rolledBudgets)

    const result = await persistBudgetRows(rolledBudgets.filter((item) => item.periodId === activePeriodId))
    if (!result.ok) {
      setBudgets((prev) =>
        prev.map((item) => {
          const original = snapshot.budgets.find((entry) => entry.id === item.id)
          return original ? { ...item, limit: original.limit, spent: original.spent, rollover: original.rollover } : item
        }),
      )
      setLastRolloverSnapshot(null)
      return result
    }

    return ok('Rollover berhasil dipakai. Kalau tadi kepencet, gunakan tombol batalkan rollover terakhir.')
  }

  const undoBudgetRollover = async () => {
    if (!lastRolloverSnapshot || lastRolloverSnapshot.period.id !== activePeriodId) {
      return fail('Belum ada rollover untuk periode aktif yang bisa dibatalkan.')
    }

    const snapshot = lastRolloverSnapshot
    const restoredBudgets = budgets.map((item) => {
      const original = snapshot.budgets.find((entry) => entry.id === item.id)
      return original ? { ...item, limit: original.limit, spent: original.spent, rollover: original.rollover } : item
    })

    setBudgets(restoredBudgets)
    const result = await persistBudgetRows(restoredBudgets.filter((item) => item.periodId === activePeriodId))

    if (!result.ok) {
      return result
    }

    setLastRolloverSnapshot(null)
    return ok(`Rollover untuk periode ${snapshot.period.label} berhasil dibatalkan.`)
  }

  const addTransaction = async (payload: Omit<TransactionItem, 'id' | 'periodId'>) => {
    const periodId = resolveTransactionPeriodId(payload.date, periods, activePeriodId)
    const nextTransaction: TransactionItem = { id: uid(), periodId, ...payload }
    const impacted = applyTransactionImpact(accounts, budgets, nextTransaction, 1)

    setAccounts(impacted.accounts)
    setBudgets(impacted.budgets)
    setTransactions((prev) => [nextTransaction, ...prev])

    const transactionResult = await insertTransactionToSupabase(nextTransaction)

    if (!transactionResult.ok) {
      setAccounts(accounts)
      setBudgets(budgets)
      setTransactions((prev) => prev.filter((item) => item.id !== nextTransaction.id))
      return transactionResult
    }

    const balanceResult = await persistBalances(impacted.accounts, impacted.budgets)
    if (!balanceResult.ok) {
      return fail('Transaksi tersimpan, tetapi saldo dompet atau anggaran belum diperbarui. Periksa izin tabel di Supabase.')
    }

    return transactionResult
  }

  const updateTransaction = async (id: string, payload: Omit<TransactionItem, 'id' | 'periodId'>) => {
    const current = transactions.find((item) => item.id === id)

    if (!current) {
      return fail('Transaksi tidak ditemukan.')
    }

    const periodId = resolveTransactionPeriodId(payload.date, periods, activePeriodId)
    const nextTransaction: TransactionItem = { id, periodId, ...payload }
    const reverted = applyTransactionImpact(accounts, budgets, current, -1)
    const impacted = applyTransactionImpact(reverted.accounts, reverted.budgets, nextTransaction, 1)

    setAccounts(impacted.accounts)
    setBudgets(impacted.budgets)
    setTransactions((prev) => prev.map((item) => (item.id === id ? nextTransaction : item)))

    const transactionResult = await updateTransactionInSupabase(nextTransaction)

    if (!transactionResult.ok) {
      setAccounts(accounts)
      setBudgets(budgets)
      setTransactions((prev) => prev.map((item) => (item.id === id ? current : item)))
      return transactionResult
    }

    const balanceResult = await persistBalances(impacted.accounts, impacted.budgets)
    if (!balanceResult.ok) {
      return fail('Transaksi diperbarui, tetapi saldo dompet atau anggaran belum diperbarui. Periksa izin tabel di Supabase.')
    }

    return transactionResult
  }

  const deleteTransaction = async (id: string) => {
    const current = transactions.find((item) => item.id === id)

    if (!current) {
      return fail('Transaksi tidak ditemukan.')
    }

    const reverted = applyTransactionImpact(accounts, budgets, current, -1)

    setAccounts(reverted.accounts)
    setBudgets(reverted.budgets)
    setTransactions((prev) => prev.filter((item) => item.id !== id))

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('transactions').delete().eq('id', id)

      if (error) {
        setAccounts(accounts)
        setBudgets(budgets)
        setTransactions((prev) => [current, ...prev])
        return fail(saveMessage(error.message))
      }
    }

    const balanceResult = await persistBalances(reverted.accounts, reverted.budgets)
    if (!balanceResult.ok) {
      return fail('Transaksi dihapus, tetapi saldo dompet atau anggaran belum diperbarui. Periksa izin tabel di Supabase.')
    }

    return ok('Transaksi dihapus.')
  }

  const addRecurringTransaction = async (payload: Omit<RecurringTransaction, 'id' | 'lastCreatedAt'>) => {
    setRecurringTransactions((prev) => [{ id: uid(), ...payload }, ...prev])
  }

  const updateRecurringTransaction = async (id: string, payload: Omit<RecurringTransaction, 'id' | 'lastCreatedAt'>) => {
    setRecurringTransactions((prev) => prev.map((item) => (item.id === id ? { ...item, ...payload } : item)))
  }

  const deleteRecurringTransaction = async (id: string) => {
    setRecurringTransactions((prev) => prev.filter((item) => item.id !== id))
  }

  const createTransactionFromRecurring = async (id: string) => {
    const item = recurringTransactions.find((entry) => entry.id === id)
    if (!item) return

    const createdDate = todayIso()

    const result = await addTransaction({
      title: item.title,
      amount: item.amount,
      type: item.type,
      category: item.type === 'transfer' ? 'Transfer' : item.category,
      account: item.account,
      toAccount: item.type === 'transfer' ? item.toAccount : undefined,
      member: item.member,
      date: createdDate,
      note: item.note,
    })

    if (!result.ok) {
      return result
    }

    setRecurringTransactions((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? { ...entry, lastCreatedAt: createdDate, nextDate: nextRecurringDate(entry.nextDate, entry.frequency) }
          : entry,
      ),
    )

    return ok('Transaksi rutin dicatat.')
  }

  const addSavingGoal = async (payload: Omit<SavingGoal, 'id'>) => {
    setSavingGoals((prev) => [{ id: uid(), ...payload }, ...prev])
  }

  const updateSavingGoal = async (id: string, payload: Omit<SavingGoal, 'id'>) => {
    setSavingGoals((prev) => prev.map((item) => (item.id === id ? { ...item, ...payload } : item)))
  }

  const deleteSavingGoal = async (id: string) => {
    setSavingGoals((prev) => prev.filter((item) => item.id !== id))
  }

  const addAsset = async (payload: Omit<AssetItem, 'id'>) => {
    setAssets((prev) => [{ id: uid(), ...payload }, ...prev])
  }

  const updateAsset = async (id: string, payload: Omit<AssetItem, 'id'>) => {
    setAssets((prev) => prev.map((item) => (item.id === id ? { ...item, ...payload } : item)))
  }

  const deleteAsset = async (id: string) => {
    setAssets((prev) => prev.filter((item) => item.id !== id))
  }

  return {
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
    deleteBudget,
    addTransaction,
    updateTransaction,
    updatePeriod,
    selectPeriod,
    copyBudgetsFromPreviousPeriod,
    applyBudgetRollover,
    undoBudgetRollover,
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
    lastRolloverSnapshot,
  }
}
