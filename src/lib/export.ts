import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { compactDate, currency } from './format'
import type { BudgetCategory, BudgetPeriod, TransactionItem } from '../types'

type ExportPayload = {
  period: BudgetPeriod
  budgets: BudgetCategory[]
  transactions: TransactionItem[]
  summary: {
    totalBalance: number
    totalBudget: number
    totalSpent: number
    totalIncome: number
    totalExpense: number
    remainingBudget: number
  }
  ownerName: string
}

const safeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gi, '-')

const periodLabel = (period: BudgetPeriod) => `${period.label} (${period.start} - ${period.end})`

export function exportBudgetToPdf(payload: ExportPayload) {
  const doc = new jsPDF()
  const filename = `mybudget-rekapan-${safeName(payload.period.label)}.pdf`

  doc.setFontSize(18)
  doc.text('Rekapan MyBudget', 14, 18)

  doc.setFontSize(11)
  doc.text(`Pemilik: ${payload.ownerName}`, 14, 28)
  doc.text(`Periode: ${periodLabel(payload.period)}`, 14, 35)
  doc.text(`Saldo total: ${currency(payload.summary.totalBalance)}`, 14, 45)
  doc.text(`Pemasukan: ${currency(payload.summary.totalIncome)}`, 14, 52)
  doc.text(`Pengeluaran: ${currency(payload.summary.totalExpense)}`, 14, 59)
  doc.text(`Sisa budget: ${currency(payload.summary.remainingBudget)}`, 14, 66)

  autoTable(doc, {
    startY: 76,
    head: [['Kategori', 'Terpakai', 'Limit', 'Sisa']],
    body: payload.budgets.map((item) => [
      item.name,
      currency(item.spent),
      currency(item.limit),
      currency(Math.max(item.limit - item.spent, 0)),
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [91, 57, 215],
    },
  })

  autoTable(doc, {
    startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
      ? (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 10
      : 90,
    head: [['Tanggal', 'Transaksi', 'Tipe', 'Kategori', 'Akun', 'Member', 'Nominal']],
    body: payload.transactions.map((item) => [
      compactDate(item.date),
      item.title,
      item.type === 'expense' ? 'Pengeluaran' : item.type === 'income' ? 'Pemasukan' : 'Transfer',
      item.category,
      item.type === 'transfer' && item.toAccount ? `${item.account} -> ${item.toAccount}` : item.account,
      item.member ?? '-',
      `${item.type === 'expense' ? '-' : '+'}${currency(item.amount)}`,
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [17, 24, 39],
    },
  })

  doc.save(filename)
}

export function exportBudgetToExcel(payload: ExportPayload) {
  const filename = `mybudget-rekapan-${safeName(payload.period.label)}.xlsx`

  const summaryRows = [
    { Ringkasan: 'Pemilik', Nilai: payload.ownerName },
    { Ringkasan: 'Periode', Nilai: periodLabel(payload.period) },
    { Ringkasan: 'Saldo total', Nilai: payload.summary.totalBalance },
    { Ringkasan: 'Pemasukan', Nilai: payload.summary.totalIncome },
    { Ringkasan: 'Pengeluaran', Nilai: payload.summary.totalExpense },
    { Ringkasan: 'Total budget', Nilai: payload.summary.totalBudget },
    { Ringkasan: 'Sisa budget', Nilai: payload.summary.remainingBudget },
  ]

  const budgetRows = payload.budgets.map((item) => ({
    Kategori: item.name,
    Terpakai: item.spent,
    Limit: item.limit,
    Sisa: Math.max(item.limit - item.spent, 0),
  }))

  const transactionRows = payload.transactions.map((item) => ({
    Tanggal: compactDate(item.date),
    Transaksi: item.title,
    Tipe: item.type === 'expense' ? 'Pengeluaran' : item.type === 'income' ? 'Pemasukan' : 'Transfer',
    Kategori: item.category,
    Akun: item.type === 'transfer' && item.toAccount ? `${item.account} -> ${item.toAccount}` : item.account,
    Member: item.member ?? '',
    Nominal: item.type === 'expense' ? -item.amount : item.amount,
    Catatan: item.note,
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Ringkasan')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(budgetRows), 'Budget')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(transactionRows), 'Transaksi')
  XLSX.writeFile(workbook, filename)
}
