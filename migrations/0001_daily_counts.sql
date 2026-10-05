-- 日ごと・種類ごとの回数だけを持つ。誰が押したかは保存しない。
CREATE TABLE IF NOT EXISTS daily_counts (
  day   TEXT    NOT NULL,            -- 日本時間の日付 YYYY-MM-DD
  event TEXT    NOT NULL,            -- new / open / stamp / complete / share
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event)
);
