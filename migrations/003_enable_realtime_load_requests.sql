-- Enable Supabase Realtime for load_requests table
-- This powers live notifications in the admin dashboard when drivers submit new loads
alter publication supabase_realtime add table load_requests;
