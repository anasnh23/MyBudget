import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseEnabled } from '../lib/supabase'
import { initialBudgetData } from '../lib/mockData'
import type { Account, BudgetCategory, BudgetData, BudgetPeriod, Member, TransactionItem } from '../types'

const uid = () => crypto.randomUUID()

const accountColors = ['#6346f7', '#13b981', '#06b6d4', '#f97316', '#ec4899']

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

export function useBudgetData(userId?: string, userEmail?: string, demoMode = false) {
  const [data, setData] = useState<BudgetData>(initialBudgetData)
  const [loading, setLoading] = useState(supabaseEnabled && !demoMode)
  const shouldUseSupabase = supabaseEnabled && !demoMode

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
          userEmail
            ? client.from('members').select('*').ilike('email', userEmail).limit(1)
            : Promise.resolve({ data: [] }),
        ])

      if (!mounted) return

      const memberMap = new Map(
        [...(ownerMembers ?? []), ...(emailMembers ?? [])].map((item) => [item.id, item]),
      )
      const members = Array.from(memberMap.values())

      setData({
        period: periods?.[0]
          ? {
              label: periods[0].label,
              start: periods[0].start_date,
              end: periods[0].end_date,
            }
          : initialBudgetData.period,
        accounts:
          accounts?.map((item, index) => ({
            id: item.id,
            name: item.name,
            balance: Number(item.balance),
            color: item.color ?? accountColors[index % accountColors.length],
          })) ?? [],
        members:
          members?.map((item) => ({
            id: item.id,
            name: item.name,
            email: item.email,
            role: item.role,
          })) ?? [],
        budgets:
          budgets?.map((item) => ({
            id: item.id,
            name: item.name,
            limit: Number(item.limit_amount),
            spent: Number(item.spent_amount),
            color: item.color ?? '#6346f7',
          })) ?? [],
        transactions:
          transactions?.map((item) => ({
            id: item.id,
            title: item.title,
            amount: Number(item.amount),
            type: item.type,
            category: item.category,
            account: item.account_name,
            date: item.date,
            note: item.note ?? '',
          })) ?? [],
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
    const totalIncome = data.transactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + item.amount, 0)
    const totalExpense = data.transactions
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + item.amount, 0)

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

  const addAccount = async (payload: { name: string; balance: number }) => {
    const nextAccount: Account = {
      id: uid(),
      name: payload.name,
      balance: payload.balance,
      color: accountColors[data.accounts.length % accountColors.length],
    }

    setData((prev) => ({ ...prev, accounts: [nextAccount, ...prev.accounts] }))

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('accounts').insert({
        id: nextAccount.id,
        user_id: userId,
        name: nextAccount.name,
        balance: nextAccount.balance,
        color: nextAccount.color,
      })
    }
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
        console.error('Gagal menyimpan member:', error.message)
        return { ok: false, message: memberSaveMessage(error.message) }
      }

      const { data: currentSession } = await supabase.auth.getSession()
      const { error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: payload.password,
        options: {
          data: {
            full_name: payload.name,
            role: payload.role,
          },
        },
      })

      if (currentSession.session) {
        await supabase.auth.setSession({
          access_token: currentSession.session.access_token,
          refresh_token: currentSession.session.refresh_token,
        })
      }

      setData((prev) => ({ ...prev, members: [nextMember, ...prev.members] }))

      if (signUpError && !signUpError.message.toLowerCase().includes('already')) {
        return { ok: true, message: 'Member tersimpan. Login belum aktif.' }
      }

      return { ok: true, message: 'Member tersimpan.' }
    }

    setData((prev) => ({ ...prev, members: [nextMember, ...prev.members] }))
    return { ok: true, message: 'Member tersimpan.' }
  }

  const deleteMember = async (id: string) => {
    setData((prev) => ({
      ...prev,
      members: prev.members.filter((item) => item.id !== id),
    }))

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('members').delete().eq('id', id)
    }
  }

  const addBudget = async (payload: { name: string; limit: number }) => {
    const nextBudget: BudgetCategory = {
      id: uid(),
      name: payload.name,
      limit: payload.limit,
      spent: 0,
      color: accountColors[data.budgets.length % accountColors.length],
    }

    setData((prev) => ({ ...prev, budgets: [nextBudget, ...prev.budgets] }))

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('budget_categories').insert({
        id: nextBudget.id,
        user_id: userId,
        name: nextBudget.name,
        limit_amount: nextBudget.limit,
        spent_amount: nextBudget.spent,
        color: nextBudget.color,
      })
    }
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

  const addTransaction = async (payload: Omit<TransactionItem, 'id'>) => {
    const nextTransaction: TransactionItem = { id: uid(), ...payload }

    setData((prev) => {
      const accounts = prev.accounts.map((item) =>
        item.name === payload.account
          ? {
              ...item,
              balance:
                payload.type === 'income'
                  ? item.balance + payload.amount
                  : item.balance - payload.amount,
            }
          : item,
      )

      const budgets = prev.budgets.map((item) =>
        item.name === payload.category && payload.type === 'expense'
          ? { ...item, spent: item.spent + payload.amount }
          : item,
      )

      return {
        ...prev,
        accounts,
        budgets,
        transactions: [nextTransaction, ...prev.transactions],
      }
    })

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('transactions').insert({
        id: nextTransaction.id,
        user_id: userId,
        title: nextTransaction.title,
        amount: nextTransaction.amount,
        type: nextTransaction.type,
        category: nextTransaction.category,
        account_name: nextTransaction.account,
        date: nextTransaction.date,
        note: nextTransaction.note,
      })
    }
  }

  const deleteTransaction = async (id: string) => {
    setData((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((item) => item.id !== id),
    }))

    if (shouldUseSupabase && supabase && userId) {
      await supabase.from('transactions').delete().eq('id', id)
    }
  }

  return {
    data,
    loading,
    summary,
    addAccount,
    addMember,
    deleteMember,
    addBudget,
    addTransaction,
    updatePeriod,
    deleteTransaction,
  }
}
