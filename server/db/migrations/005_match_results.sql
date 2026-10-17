-- Results of finished matches, per account (server/history.ts): online matches are recorded by the server, matches
-- against the bot are sent by the browser. id is the match's id (both players of an online match share it).
CREATE TABLE match_results (
  user_id    uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  id         uuid        NOT NULL,
  played_at  timestamptz NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('bot', 'online')),
  two_headed boolean     NOT NULL,
  commander  boolean     NOT NULL,
  best_of    smallint    NOT NULL CHECK (best_of IN (1, 3)),
  deck       text        NOT NULL CHECK (length(deck) <= 100),
  opponent   text        NOT NULL CHECK (length(opponent) <= 200),
  result     text        NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  wins       smallint    NOT NULL CHECK (wins BETWEEN 0 AND 99),
  losses     smallint    NOT NULL CHECK (losses BETWEEN 0 AND 99),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX match_results_user_idx ON match_results (user_id, played_at DESC);
