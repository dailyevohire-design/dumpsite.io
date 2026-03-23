-- Enable realtime on load_requests and driver_notifications
ALTER PUBLICATION supabase_realtime ADD TABLE load_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE driver_notifications;
