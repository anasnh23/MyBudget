export type NavKey = 'home' | 'history' | 'add' | 'budget' | 'wallet' | 'asset' | 'profile' | 'setup'

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
  periodId: string
  name: string
  limit: number
  spent: number
  color: string
  rollover: boolean
}

export type TransactionItem = {
  id: string
  periodId: string
  title: string
  amount: number
  type: TransactionType
  category: string
  account: string
  toAccount?: string
  member?: string
  date: string
  note: string
}

export type RecurringFrequency = 'weekly' | 'monthly'

export type RecurringTransaction = {
  id: string
  title: string
  amount: number
  type: TransactionType
  category: string
  account: string
  toAccount?: string
  member?: string
  note: string
  frequency: RecurringFrequency
  nextDate: string
  lastCreatedAt?: string
}

export type SavingGoal = {
  id: string
  name: string
  target: number
  saved: number
  account?: string
  note: string
}

export type AssetType = 'deposito' | 'emas' | 'reksa_dana' | 'saham' | 'crypto' | 'lainnya'

export type AssetItem = {
  id: string
  name: string
  type: AssetType
  initialAmount: number
  currentValue: number
  startDate: string
  tenorMonths?: number
  interestRate?: number
  maturityDate?: string
  estimatedReturn?: number
  note: string
}

export type BudgetPeriod = {
  id: string
  label: string
  start: string
  end: string
}

export type BudgetData = {
  period: BudgetPeriod
  periods: BudgetPeriod[]
  accounts: Account[]
  members: Member[]
  budgets: BudgetCategory[]
  transactions: TransactionItem[]
}
