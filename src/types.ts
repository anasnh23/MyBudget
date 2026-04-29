export type NavKey = 'home' | 'history' | 'add' | 'budget' | 'wallet' | 'setup'

export type TransactionType = 'expense' | 'income' | 'transfer'

export type Account = {
  id: string
  name: string
  balance: number
  color: string
}

export type Member = {
  id: string
  name: string
  email: string
  role: string
}

export type BudgetCategory = {
  id: string
  name: string
  limit: number
  spent: number
  color: string
}

export type TransactionItem = {
  id: string
  title: string
  amount: number
  type: TransactionType
  category: string
  account: string
  date: string
  note: string
}

export type BudgetPeriod = {
  label: string
  start: string
  end: string
}

export type BudgetData = {
  period: BudgetPeriod
  accounts: Account[]
  members: Member[]
  budgets: BudgetCategory[]
  transactions: TransactionItem[]
}
