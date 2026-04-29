# MyBudget

Website budgeting mobile-first berbasis React + Supabase untuk mengatur budget, transaksi, dompet, dan member.

## Fitur

- Login dengan Supabase
- Dashboard ringkasan budget dan cashflow
- Catat transaksi pemasukan, pengeluaran, dan transfer
- Kelola dompet, kategori budget, dan member
- Riwayat transaksi dan grafik komposisi pengeluaran
- Mode demo otomatis saat kredensial Supabase belum diisi

## Menjalankan project

1. Install dependency:

```bash
npm install
```

2. Salin file environment:

```bash
copy .env.example .env
```

3. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.

4. Jalankan SQL pada file [supabase-schema.sql](/C:/AnsaProjext/MyBudget/supabase-schema.sql).

5. Start development server:

```bash
npm run dev
```

## Catatan

- Jika `.env` belum diisi, app tetap tampil dengan data contoh.
- Struktur tabel memakai Row Level Security agar setiap user hanya melihat data miliknya sendiri.

## Akun Admin

Buat akun ini lewat Supabase `Authentication` > `Users` > `Add user`:

```text
Email: admin@kunci.cloud
Password: Banyuwangi
```

Setelah itu login di MyBudget memakai akun tersebut.
