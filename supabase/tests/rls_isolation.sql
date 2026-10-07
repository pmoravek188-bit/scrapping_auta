-- RLS isolation test: two throwaway users, each with their own search,
-- match, favourite and push subscription. Then, as each user (role
-- authenticated + JWT sub), try to read and modify the other user's data.
-- Everything runs in one DO block that ends with RAISE EXCEPTION, so the
-- whole transaction (test users included) is rolled back and the report is
-- returned as the error message. Safe to run against production.
do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  sa uuid; sb uuid;
  l1 uuid; l2 uuid;
  report text := '';
  n int;
  fails int := 0;

begin
  select id into l1 from public.listings where is_active order by id limit 1;
  select id into l2 from public.listings where is_active order by id offset 1 limit 1;

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-a@example.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-b@example.invalid', now(), now());

  insert into public.searches (user_id, name) values (ua, 'RLS test A') returning id into sa;
  insert into public.searches (user_id, name) values (ub, 'RLS test B') returning id into sb;
  insert into public.matches (search_id, listing_id) values (sa, l1), (sb, l2);
  insert into public.favorites (user_id, listing_id, note) values (ua, l1, 'A note'), (ub, l2, 'B note');
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (ua, 'https://push.invalid/a', 'p', 'a'), (ub, 'https://push.invalid/b', 'p', 'b');

  -- ===== act as user A =====
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.searches where user_id = ub;
  report := report || format('A vidí hledání B: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from public.searches where user_id = ua;
  report := report || format('A vidí svoje hledání: %s (má být 1)%s', n, chr(10)); if n <> 1 then fails := fails + 1; end if;

  select count(*) into n from public.matches where search_id = sb;
  report := report || format('A vidí shody B: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from public.matches where search_id = sa;
  report := report || format('A vidí svoje shody: %s (má být 1)%s', n, chr(10)); if n <> 1 then fails := fails + 1; end if;

  select count(*) into n from public.favorites where user_id = ub;
  report := report || format('A vidí oblíbené B: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from public.push_subscriptions where user_id = ub;
  report := report || format('A vidí push odběry B: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;

  select count(*) into n from public.app_secrets;
  report := report || format('A vidí app_secrets: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from public.app_admins;
  report := report || format('A vidí app_admins: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from public.detail_text_cache;
  report := report || format('A vidí detail_text_cache: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;

  -- write attempts on B's rows
  update public.searches set name = 'hacked' where id = sb; get diagnostics n = row_count;
  report := report || format('A upraví hledání B: %s řádků (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  update public.favorites set note = 'hacked' where user_id = ub; get diagnostics n = row_count;
  report := report || format('A upraví oblíbené B: %s řádků (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  update public.matches set status = 'hidden' where search_id = sb; get diagnostics n = row_count;
  report := report || format('A skryje shodu B: %s řádků (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  update public.push_subscriptions set endpoint = 'https://push.invalid/hacked' where user_id = ub; get diagnostics n = row_count;
  report := report || format('A upraví push odběr B: %s řádků (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;

  begin
    insert into public.searches (user_id, name) values (ub, 'podvržené');
    report := report || 'A založí hledání za B: PROŠLO (chyba!)' || chr(10); fails := fails + 1;
  exception when others then
    report := report || 'A založí hledání za B: zamítnuto (OK)' || chr(10);
  end;
  begin
    insert into public.matches (search_id, listing_id) values (sb, l1);
    report := report || 'A vloží shodu do hledání B: PROŠLO (chyba!)' || chr(10); fails := fails + 1;
  exception when others then
    report := report || 'A vloží shodu do hledání B: zamítnuto (OK)' || chr(10);
  end;
  begin
    insert into public.favorites (user_id, listing_id) values (ub, l1);
    report := report || 'A přidá oblíbené za B: PROŠLO (chyba!)' || chr(10); fails := fails + 1;
  exception when others then
    report := report || 'A přidá oblíbené za B: zamítnuto (OK)' || chr(10);
  end;
  begin
    insert into public.app_admins (user_id) values (ua);
    report := report || 'A se udělá správcem: PROŠLO (chyba!)' || chr(10); fails := fails + 1;
  exception when others then
    report := report || 'A se udělá správcem: zamítnuto (OK)' || chr(10);
  end;

  select count(*) into n from public.search_listings(p_search_id => null, p_limit => 10000) where id = l2 and id <> l1;
  report := report || format('A vidí ve „Vše“ auto jen od B: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from public.search_listings(p_search_id => null, p_limit => 10000) where id = l1;
  report := report || format('A vidí ve „Vše“ svoje auto: %s (má být 1)%s', n, chr(10)); if n <> 1 then fails := fails + 1; end if;
  select count(*) into n from public.search_listings(p_search_id => sb, p_limit => 10000);
  report := report || format('A čte výsledky hledání B přes id: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;

  -- ===== act as user B (sanity: B still sees own data untouched) =====
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ub::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.searches where id = sb and name = 'RLS test B';
  report := report || format('B má svoje hledání nezměněné: %s (má být 1)%s', n, chr(10)); if n <> 1 then fails := fails + 1; end if;
  select count(*) into n from public.favorites where user_id = ub and note = 'B note';
  report := report || format('B má svoje oblíbené nezměněné: %s (má být 1)%s', n, chr(10)); if n <> 1 then fails := fails + 1; end if;
  select count(*) into n from public.searches where user_id = ua;
  report := report || format('B vidí hledání A: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;

  -- ===== anonymous (not logged in) =====
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  select count(*) into n from public.listings;
  report := report || format('Nepřihlášený vidí inzeráty: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from public.searches;
  report := report || format('Nepřihlášený vidí hledání: %s (má být 0)%s', n, chr(10)); if n <> 0 then fails := fails + 1; end if;
  execute 'reset role';

  raise exception 'RLS_TEST_REPORT fails=% %', fails, chr(10) || report;
end $$;
