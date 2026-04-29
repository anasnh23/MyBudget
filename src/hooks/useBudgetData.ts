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
    item.name === transaction.category && transaction.type === 'expense'
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

export function useBudgetData(userId?: string, userEmail?: string, demoMode = false) {
  const [data, setData] = useState<BudgetData>(initialBudgetData)
  const [loading, setLoading] = useState(supabaseEnabled && !demoMode)
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([])
  const [savingGoals, setSavingGoals] = useState<SavingGoal[]>([])
  const [assets, setAssets] = useState<AssetItem[]>([])
  const shouldUseSupabase = supabaseEnabled && !demoMode

  useEffect(() => {
    setRecurringTransactions(readLocalItems(storageKey('recurring', userId), [] as RecurringTransaction[]))
    setSavingGoals(readLocalItems(storageKey('goals', userId), [] as SavingGoal[]))
    setAssets(readLocalItems(storageKey('assets', userId), [] as AssetItem[]))
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
    if (demoMode) {
      setData(initialBudgetData)
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

      const [{ data: accounts }, { data: budgets }, { data: transactions }, { data: periods }, { data: ownerMembers }, { data: emailMembers }] =
        await Promise.all([
          client.from('accounts').select('*').eq('user_id', userId).order('created_at'),
          client.from('budget_categories').select('*').eq('user_id', userId).order('created_at'),
          client.from('transactions').select('*').eq('user_id', userId).order('date', { ascending: false }),
          client.from('budget_periods').select('*').eq('user_id', userId).limit(1),
          client.from('members').select('*').eq('user_id', userId).order('created_at'),
          userEmail ? client.from('members').select('*').ilike('email', userEmail).limit(1) : Promise.resolve({ data: [] }),
        ])

      if (!mounted) return

      const memberMap = new Map([...(ownerMembers ?? []), ...(emailMembers ?? [])].map((item) => [item.id, item]))
      const members = Array.from(memberMap.values())

      setData({
        period: periods?.[0]
          ? { label: periods[0].label, start: periods[0].start_date, end: periods[0].end_date }
          : initialBudgetData.period,
        accounts:
          accounts?.map((item, index) => ({
            id: item.id,
            name: item.name,
            balance: Number(item.balance),
            color: item.color ?? accountColors[index % accountColors.length],
          })) ?? [],
        members: members.map((item) => ({ id: item.id, name: item.name, email: item.email, role: item.role })),
        budgets:
          budgets?.map((item) => ({
            id: item.id,
            name: item.name,
            limit: Number(item.limit_amount),
            spent: Number(item.spent_amount),
            color: item.color ?? '#6346f7',
            rollover: Boolean(item.rollover_enabled),
          })) ?? [],
        transactions:
          transactions?.map((item) => {
            const decoded = decodeTransactionNote(item.note)

            return {
              id: item.id,
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
          }) ?? [],
      })
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

  const persistBalances = async (accounts: Account[], budgets: BudgetCategory[]) => {
    if (!shouldUseSupabase || !supabase || !userId) {
      return ok('Data tersimpan.')
    }

    const client = supabase

    const results = await Promise.all([
      ...accounts.map((item) => client.from('accounts').update({ balance: item.balance }).eq('id', item.id)),
      ...budgets.map((item) => client.from('budget_categories').update({ spent_amount: item.spent }).eq('id', item.id)),
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
    const basePayload = {
      id: transaction.id,
      user_id: userId,
      title: transaction.title,
      amount: transaction.amount,
      type: transaction.type,
      category: transaction.category,
      account_name: transaction.account,
      date: transaction.date,
      note: transaction.note,
    }

    const { error } = await client.from('transactions').insert({
      ...basePayload,
      to_account_name: transaction.toAccount ?? null,
      member_name: transaction.member ?? null,
    })

    if (!error) {
      return ok('Transaksi tersimpan.')
    }

    if (!isMissingColumnError(error.message)) {
      return fail(saveMessage(error.message))
    }

    const fallback = await client.from('transactions').insert({
      ...basePayload,
      note: encodeTransactionNote(transaction),
    })

    if (fallback.error) {
      return fail(saveMessage(fallback.error.message))
    }

    return ok('Transaksi tersimpan. Jalankan ulang supabase-schema.sql agar data member dan tujuan transfer tersimpan di kolom khusus.')
  }

  const updateTransactionInSupabase = async (transaction: TransactionItem) => {
    if (!shouldUseSupabase || !supabase || !userId) {
      return ok('Transaksi diperbarui.')
    }

    const client = supabase
    const basePayload = {
      title: transaction.title,
      amount: transaction.amount,
      type: transaction.type,
      category: transaction.category,
      account_name: transaction.account,
      date: transaction.date,
      note: transaction.note,
    }

    const { error } = await client
      .from('transactions')
      .update({
        ...basePayload,
        to_account_name: transaction.toAccount ?? null,
        member_name: transaction.member ?? null,
      })
      .eq('id', transaction.id)

    if (!error) {
      return ok('Transaksi diperbarui.')
    }

    if (!isMissingColumnError(error.message)) {
      return fail(saveMessage(error.message))
    }

    const fallback = await client
      .from('transactions')
      .update({
        ...basePayload,
        note: encodeTransactionNote(transaction),
      })
      .eq('id', transaction.id)

    if (fallback.error) {
      return fail(saveMessage(fallback.error.message))
    }

    return ok('Transaksi diperbarui. Jalankan ulang supabase-schema.sql agar data member dan tujuan transfer tersimpan di kolom khusus.')
  }

  const addAccount = async (payload: { name: string; balance: number }) => {
    const nextAccount: Account = {
      id: uid(),
      name: payload.name,
      balance: payload.balance,
      color: accountColors[data.accounts.length % accountColors.length],
    }

    setData((prev) => ({ ...prev, accounts: [nextAccount, ...prev.accounts] }))

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('accounts').insert({
        id: nextAccount.id,
        user_id: userId,
        name: nextAccount.name,
        balance: nextAccount.balance,
        color: nextAccount.color,
      })

      if (error) {
        setData((prev) => ({ ...prev, accounts: prev.accounts.filter((item) => item.id !== nextAccount.id) }))
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

      setData((prev) => ({ ...prev, members: [nextMember, ...prev.members] }))

      if (signUpError && !signUpError.message.toLowerCase().includes('already')) {
        return { ok: true, message: 'Member tersimpan, tapi belum bisa login.' }
      }

      return { ok: true, message: 'Member tersimpan.' }
    }

    setData((prev) => ({ ...prev, members: [nextMember, ...prev.members] }))
    return { ok: true, message: 'Member tersimpan.' }
  }

  const deleteMember = async (id: string) => {
    setData((prev) => ({ ...prev, members: prev.members.filter((item) => item.id !== id) }))

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('members').delete().eq('id', id)
    }
  }

  const addBudget = async (payload: { name: string; limit: number; rollover: boolean }) => {
    const nextBudget: BudgetCategory = {
      id: uid(),
      name: payload.name,
      limit: payload.limit,
      spent: 0,
      color: accountColors[data.budgets.length % accountColors.length],
      rollover: payload.rollover,
    }

    setData((prev) => ({ ...prev, budgets: [nextBudget, ...prev.budgets] }))

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('budget_categories').insert({
        id: nextBudget.id,
        user_id: userId,
        name: nextBudget.name,
        limit_amount: nextBudget.limit,
        spent_amount: nextBudget.spent,
        rollover_enabled: nextBudget.rollover,
        color: nextBudget.color,
      })

      if (error && isMissingColumnError(error.message)) {
        const fallback = await supabase.from('budget_categories').insert({
          id: nextBudget.id,
          user_id: userId,
          name: nextBudget.name,
          limit_amount: nextBudget.limit,
          spent_amount: nextBudget.spent,
          color: nextBudget.color,
        })

        if (fallback.error) {
          setData((prev) => ({ ...prev, budgets: prev.budgets.filter((item) => item.id !== nextBudget.id) }))
          return fail(saveMessage(fallback.error.message))
        }

        return ok('Anggaran tersimpan. Jalankan ulang supabase-schema.sql agar fitur rollover tersimpan di Supabase.')
      }

      if (error) {
        setData((prev) => ({ ...prev, budgets: prev.budgets.filter((item) => item.id !== nextBudget.id) }))
        return fail(saveMessage(error.message))
      }
    }

    return ok('Anggaran tersimpan.')
  }

  const updateBudget = async (id: string, payload: { name: string; limit: number; rollover: boolean }) => {
    const currentBudget = data.budgets.find((item) => item.id === id)

    setData((prev) => ({
      ...prev,
      budgets: prev.budgets.map((item) =>
        item.id === id ? { ...item, name: payload.name, limit: payload.limit, rollover: payload.rollover } : item,
      ),
    }))

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase
        .from('budget_categories')
        .update({
          name: payload.name,
          limit_amount: payload.limit,
          rollover_enabled: payload.rollover,
        })
        .eq('id', id)

      if (error && isMissingColumnError(error.message)) {
        const fallback = await supabase
          .from('budget_categories')
          .update({
            name: payload.name,
            limit_amount: payload.limit,
          })
          .eq('id', id)

        if (fallback.error) {
          if (currentBudget) {
            setData((prev) => ({
              ...prev,
              budgets: prev.budgets.map((item) => (item.id === id ? currentBudget : item)),
            }))
          }
          return fail(saveMessage(fallback.error.message))
        }

        return ok('Anggaran diperbarui. Jalankan ulang supabase-schema.sql agar fitur rollover tersimpan di Supabase.')
      }

      if (error) {
        if (currentBudget) {
          setData((prev) => ({
            ...prev,
            budgets: prev.budgets.map((item) => (item.id === id ? currentBudget : item)),
          }))
        }
        return fail(saveMessage(error.message))
      }
    }

    return ok('Anggaran diperbarui.')
  }

  const updatePeriod = async (period: BudgetPeriod) => {
    setData((prev) => ({ ...prev, period }))

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('budget_periods').upsert({
        user_id: userId,
        label: period.label,
        start_date: period.start,
        end_date: period.end,
      })
    }
  }

  const applyBudgetRollover = async () => {
    let rolledBudgets: BudgetCategory[] = []

    setData((prev) => {
      rolledBudgets = prev.budgets.map((item) => {
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

      return { ...prev, budgets: rolledBudgets }
    })

    if (shouldUseSupabase && supabase && userId && rolledBudgets.length) {
      const client = supabase
      await Promise.all(
        rolledBudgets.map((item) =>
          client
            .from('budget_categories')
            .update({
              limit_amount: item.limit,
              spent_amount: item.spent,
              rollover_enabled: item.rollover,
            })
            .eq('id', item.id),
        ),
      )
    }
  }

  const addTransaction = async (payload: Omit<TransactionItem, 'id'>) => {
    const nextTransaction: TransactionItem = { id: uid(), ...payload }
    const impacted = applyTransactionImpact(data.accounts, data.budgets, nextTransaction, 1)

    setData((prev) => ({
      ...prev,
      accounts: impacted.accounts,
      budgets: impacted.budgets,
      transactions: [nextTransaction, ...prev.transactions],
    }))

    const transactionResult = await insertTransactionToSupabase(nextTransaction)

    if (!transactionResult.ok) {
      setData((prev) => ({
        ...prev,
        accounts: data.accounts,
        budgets: data.budgets,
        transactions: prev.transactions.filter((item) => item.id !== nextTransaction.id),
      }))
      return transactionResult
    }

    const balanceResult = await persistBalances(impacted.accounts, impacted.budgets)
    if (!balanceResult.ok) {
      return fail('Transaksi tersimpan, tetapi saldo dompet atau anggaran belum diperbarui. Periksa izin tabel di Supabase.')
    }

    return transactionResult
  }

  const updateTransaction = async (id: string, payload: Omit<TransactionItem, 'id'>) => {
    const nextTransaction: TransactionItem = { id, ...payload }
    const current = data.transactions.find((item) => item.id === id)

    if (!current) {
      return fail('Transaksi tidak ditemukan.')
    }

    const reverted = applyTransactionImpact(data.accounts, data.budgets, current, -1)
    const impacted = applyTransactionImpact(reverted.accounts, reverted.budgets, nextTransaction, 1)

    setData((prev) => ({
      ...prev,
      accounts: impacted.accounts,
      budgets: impacted.budgets,
      transactions: prev.transactions.map((item) => (item.id === id ? nextTransaction : item)),
    }))

    const transactionResult = await updateTransactionInSupabase(nextTransaction)

    if (!transactionResult.ok) {
      setData((prev) => ({
        ...prev,
        accounts: data.accounts,
        budgets: data.budgets,
        transactions: prev.transactions.map((item) => (item.id === id ? current : item)),
      }))
      return transactionResult
    }

    const balanceResult = await persistBalances(impacted.accounts, impacted.budgets)
    if (!balanceResult.ok) {
      return fail('Transaksi diperbarui, tetapi saldo dompet atau anggaran belum diperbarui. Periksa izin tabel di Supabase.')
    }

    return transactionResult
  }

  const deleteTransaction = async (id: string) => {
    const current = data.transactions.find((item) => item.id === id)

    if (!current) {
      return fail('Transaksi tidak ditemukan.')
    }

    const reverted = applyTransactionImpact(data.accounts, data.budgets, current, -1)

    setData((prev) => ({
      ...prev,
      accounts: reverted.accounts,
      budgets: reverted.budgets,
      transactions: prev.transactions.filter((item) => item.id !== id),
    }))

    if (shouldUseSupabase && supabase && userId) {
      const { error } = await supabase.from('transactions').delete().eq('id', id)

      if (error) {
        setData((prev) => ({
          ...prev,
          accounts: data.accounts,
          budgets: data.budgets,
          transactions: [current, ...prev.transactions],
        }))
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
  }
}
