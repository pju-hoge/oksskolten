# Oksskolten 実装仕様書 — 認証

> [概要に戻る](./01_overview.ja.md)

## 認証

### 方針

JWT + bcryptjs によるパスワード認証、WebAuthn/Passkey によるパスワードレス認証、GitHub OAuth によるソーシャルログイン、外部ツール向けのAPIキー認証の4方式ハイブリッド。パスワード/Passkey/OAuthは独立して有効/無効を切替可能（ただし最低1つは常に有効）。APIキーは作成後は常に利用可能。

### DB スキーマ

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE credentials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id   TEXT NOT NULL UNIQUE,
  public_key      BLOB NOT NULL,
  counter         INTEGER NOT NULL DEFAULT 0,
  device_type     TEXT NOT NULL,
  backed_up       INTEGER NOT NULL DEFAULT 0,
  transports      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  key_hash     TEXT    NOT NULL UNIQUE,
  key_prefix   TEXT    NOT NULL,
  scopes       TEXT    NOT NULL DEFAULT 'read',
  last_used_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### 初期セットアップ（ユーザー作成）

`users` テーブルが空の場合、ブラウザでアクセスするとログイン画面の代わりに初期セットアップ画面（`SetupPage`）が表示される。

**フロー:**

1. フロントエンド: `GET /api/auth/methods` で `setup_required: true` を検出 → `SetupPage` を表示
2. ユーザーが email・パスワード・パスワード確認を入力して送信
3. `POST /api/auth/setup` でアカウントを作成（原子的 INSERT: `WHERE NOT EXISTS (SELECT 1 FROM users)`）
4. 成功 → JWT を発行し自動ログイン
5. ユーザーが既に存在する場合は 403 を返す（2人目の作成は不可）

**補足:**

- パスキーでの初期セットアップは非対応。WebAuthn 登録にはログイン済みセッションが必要なため、まずパスワードでアカウントを作成し、設定画面からパスキーを追加する
- `account_name` は初回の `GET /api/settings/profile` 呼び出し時に、登録した email を初期値として `settings` テーブルに自動保存される（設定画面から変更可能）

### パスワード認証フロー

```
1. フロントエンド: GET /api/me（Authorization ヘッダー付き）で認証状態を確認
   - 401 → LoginPage を表示（AuthGate コンポーネント）
2. POST /api/login に email/password を送信
3. サーバー: auth_password_enabled 設定をチェック（'0' なら 403）
4. サーバー: users テーブルから email で検索、bcryptjs で比較
5. 成功 → JWT を生成（email + token_version をペイロードに含む）
6. フロントエンド: token を localStorage に保存 → SWR mutate で /api/me を再検証 → アプリ表示
7. ログアウト → localStorage からトークンを削除 → ログイン画面に遷移
```

### Passkey認証フロー

```
1. フロントエンド: GET /api/auth/methods で利用可能な認証方式を確認
2. Passkey が利用可能なら「Passkey でログイン」ボタンを表示
3. ユーザーがボタンをクリック
4. GET /api/auth/login/options でチャレンジを取得
5. ブラウザのWebAuthnダイアログが表示
6. ユーザーがPasskeyで認証
7. POST /api/auth/login/verify で検証
8. サーバー: チャレンジ照合、カウンター更新、JWT発行
9. フロントエンド: token を localStorage に保存 → アプリ表示
```

### Passkey登録フロー

```
1. 設定画面 → auth タブ → 「Passkeyを追加」ボタン
2. GET /api/auth/register/options でチャレンジ取得（要認証）
3. ブラウザのWebAuthn登録ダイアログが表示
4. ユーザーがPasskeyを登録
5. POST /api/auth/register/verify で検証（要認証）
6. サーバー: credentials テーブルに公開鍵・カウンター・デバイス情報を保存
```

### GitHub OAuth認証フロー

```
1. ログイン画面で「GitHubでログイン」ボタンをクリック
2. POST /api/oauth/github/authorize に window.location.origin を送信
3. サーバー: arctic で GitHub 認可URL生成、state をインメモリに保存
4. フロントエンド: window.location.href = 認可URL（GitHub へリダイレクト）
5. ユーザーが GitHub で Authorize をクリック
6. GitHub → GET /api/oauth/github/callback?code=xxx&state=yyy にリダイレクト
7. サーバー: state 検証 → code を access_token に交換 → GitHub ユーザー情報取得
8. サーバー: 許可ユーザー照合（未設定時は OAuth App オーナーのみ）
9. サーバー: JWT 発行 → ワンタイム交換コード生成（60秒TTL）
10. /?oauth_code=<exchange_code> にリダイレクト
11. AuthGate: oauth_code を検出 → POST /api/oauth/github/token で JWT に交換
12. フロントエンド: token を localStorage に保存 → SWR mutate → アプリ表示
```

セキュリティ上のポイント:
- JWT は URL に載せない（ワンタイム交換コードのみ）
- 交換コードは60秒TTL・1回限り消費（リプレイ不可）
- Client ID/Secret は `settings` テーブルに保存（追加 env var ゼロ）
- 設定画面から動的に ON/OFF 可能

### JWT トークン

- アルゴリズム: HS256
- 有効期限: 30日
- ペイロード: `{ email, token_version }`
- トランスポート: `Authorization: Bearer <token>` ヘッダー
- フロントエンド保存先: `localStorage` (`auth_token` キー)
- 署名シークレット: DB（`settings` テーブル）に永続化。`JWT_SECRET` 環境変数での上書きも可能
- 401 レスポンス時: フロントエンドが自動的にトークンを破棄しログイン画面へリダイレクト
- `token_version` による無効化: パスワード変更時に `token_version` をインクリメントすることで、既存の全セッションを無効化

### WebAuthn設定

- `rpName`: `'Oksskolten'`
- `rpID`: `Origin` / `Referer` ヘッダーから動的に導出（Viteプロキシ互換）
- `residentKey`: `'preferred'`
- `userVerification`: `'preferred'`
- チャレンジTTL: 60秒（インメモリ管理）

### ロックアウト防止

不変条件: **最低1つの認証方法が常に有効**

| アクション | 許可条件 |
|---|---|
| パスワード認証の無効化 | Passkey > 0 OR GitHub OAuth 有効 |
| 最後のPasskey削除 | パスワード認証有効 OR GitHub OAuth 有効 |
| GitHub OAuth無効化 | パスワード認証有効 OR Passkey > 0 |
| GitHub OAuth設定のクリア（唯一の認証手段時） | ブロック |

### 起動時ガード

```typescript
// AUTH_DISABLED は開発時のみ許可
if (process.env.AUTH_DISABLED === '1' && process.env.NODE_ENV !== 'development') {
  process.exit(1)
}

// JWT_SECRET: env var > DB保存値 > 新規自動生成
const jwtSecret = process.env.JWT_SECRET || getOrCreateJwtSecret()
```

### パスワードリセット（CLI）

パスワードを忘れた場合、サーバーに直接アクセスして CLI スクリプトでリセットできる。セルフホステッド環境ではサーバーアクセス＝本人であるため、メール送信等の追加認証は不要。

```bash
npx tsx scripts/reset-password.ts
```

- 対話的に新しいパスワードを入力
- ユーザーが1人の場合は自動選択、複数の場合は番号で選択
- `token_version` をインクリメントし、既存セッションをすべて無効化

### APIキー認証

APIキーは外部スクリプト、bot、監視ツールからのプログラムによるアクセスを提供する。JWT/Passkey/OAuth（対話型ユーザーセッション用）とは異なり、APIキーはスコープ付きの長期間有効なBearerトークンである。

**キー形式:** `ok_` プレフィックス + 40文字のhex（例: `ok_6ed6d44c17a82e3af429d384ef7baa04d6268917`）

**保存方式:** `api_keys` テーブルにはキーの SHA-256 ハッシュのみ保存。平文のキーは作成時に1度だけ表示され、二度と表示されない（GitHub PAT と同じパターン）。

**認証フロー:**

```
1. 外部スクリプトが Authorization: Bearer ok_<key> でリクエスト送信
2. サーバーが ok_ プレフィックスを検出 → SHA-256 でハッシュ化
3. api_keys テーブルでハッシュを照合
4. 一致: authUser = 'apikey:<id>' をセット、last_used_at を記録
5. スコープチェック: 読み取り専用キーは GET リクエストのみ許可
6. read スコープで非GET → 403
```

**スコープ:**

| スコープ | 許可メソッド |
|---|---|
| `read` | GET のみ |
| `read,write` | GET, POST, PATCH, DELETE |

スコープの適用はプラグインレベルの `requireWriteScope` preHandler フックで行うため、個別ルートの変更は不要。

**管理:** APIキーは設定画面 → セキュリティ → APIトークンセクション、または `/api/settings/tokens` エンドポイントから管理する。

### ローカル開発

`AUTH_DISABLED=1` で認証チェックをスキップ。`NODE_ENV=development` 時のみ有効。

### レートリミット

| エンドポイント | 制限 |
|---|---|
| `POST /api/login` | 5回/分 |
| `POST /api/auth/login/verify` | 5回/分 |
| `GET /api/oauth/github/callback` | 10回/分 |
| `POST /api/oauth/github/token` | 5回/分 |
| その他全API | 100回/分（グローバル） |

### セキュリティ

- Cookie を使用しないため CSRF のリスクはない（トークンは明示的に Authorization ヘッダーとして送信される）
- 書き込み系 API（POST / PATCH / DELETE）は `Content-Type: application/json` を必須とし、それ以外は `415 Unsupported Media Type` を返す
- XSS 対策: React の自動エスケープ + DOMPurify による Markdown サニタイズ
- WebAuthnチャレンジは一度使用したら消費される（リプレイ攻撃防止）
- WebAuthnカウンターの検証によりクローン検出
- bcryptjs コスト12（十分な計算コスト）
- GitHub OAuth: JWT を URL に載せずワンタイム交換コード方式を採用（ログ・Referer・ブラウザ履歴への漏洩防止）
- GitHub OAuth: state パラメータによる CSRF 防止（5分TTL）
- GitHub OAuth: 交換コードは60秒TTL・1回限り消費（リプレイ不可）
- APIキー: `ok_` プレフィックスにより、GitHub等のシークレットスキャンツールが漏洩キーを検出可能
- APIキー: SHA-256 ハッシュのみ保存。平文は作成時に1度だけ表示
- APIキー: プラグインレベルのHTTPメソッドチェックによるスコープ強制（読み取り専用キーはデータを変更不可）
- APIキー: 監査用の `last_used_at` 追跡

