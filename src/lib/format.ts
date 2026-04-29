export const currency = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)

export const compactDate = (value: string) =>
  new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))

export const monthLabel = (value: string) =>
  new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(value))

export const todayIso = () => new Date().toISOString().slice(0, 10)

export const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export const addMonths = (value: string, months: number) => {
  const date = new Date(`${value}T00:00:00`)
  const day = date.getDate()
  date.setMonth(date.getMonth() + months)

  if (date.getDate() < day) {
    date.setDate(0)
  }

  return date.toISOString().slice(0, 10)
}
