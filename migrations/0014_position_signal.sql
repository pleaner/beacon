-- Whether the phone had signal when it took the fix: 'none' (offline), '4g'/'3g'/'2g'/'slow-2g' where the browser
-- reports the connection type (Android Chrome), 'online' where it only knows it's connected (iPhone). NULL: older fixes.
ALTER TABLE positions ADD COLUMN signal TEXT;
