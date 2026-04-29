-- Jalankan setelah akun admin dibuat di Supabase Authentication.
insert into public.members (user_id, name, email, role)
select id, 'Admin Banyuwangi', 'admin@kunci.cloud', 'Admin'
from auth.users
where email = 'admin@kunci.cloud'
on conflict do nothing;
