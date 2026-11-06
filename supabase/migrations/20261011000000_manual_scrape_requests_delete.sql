-- Lets a user delete their own manual_scrape_requests rows, so the API can
-- roll back the cooldown row when the GitHub dispatch fails.
create policy "users delete own manual_scrape_requests" on public.manual_scrape_requests
  for delete using (auth.uid() = user_id);
