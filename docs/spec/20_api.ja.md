# Oksskolten 実装仕様書 — API 仕様

> [概要に戻る](./01_overview.ja.md)

## API 仕様

ドメイン: Cloudflare Tunnel 経由で公開（任意のドメインを設定可能）

### 共通エラーレスポンス

すべてのエラーレスポンスは以下の形式:

```json
{ "error": "エラーメッセージ" }
```

| ステータス | 意味 |
|---|---|
| 400 | リクエスト不正（バリデーションエラー） |
| 401 | 未認証（ログインが必要） |
| 403 | 禁止（パスワード認証無効時のログイン試行等） |
| 404 | リソースが見つからない |
| 409 | 競合（URLが重複） |
| 415 | Content-Type不正（application/json以外） |
| 429 | レートリミット超過 |
| 500 | サーバーエラー |

### エンドポイント

#### ヘルスチェック（公開）

**GET /api/health** — サーバー状態確認

```json
// Response: 200
{
  "ok": true,
  "searchReady": true,
  "gitCommit": "abc1234",
  "gitTag": "v1.0.0",
  "buildDate": "2026-03-10T00:00:00Z"
}
```

`Cache-Control: no-store` ヘッダー付き。`searchReady` は Meilisearch のインデックス構築完了状態。

#### 認証エンドポイント（公開）

**POST /api/login** — パスワードログイン

レートリミット: 5回/分

```json
// Request
{ "email": "user@example.com", "password": "plain-password" }

// Response: 200
{ "ok": true, "token": "eyJhbGciOiJIUzI1NiIs..." }
```

認証成功時はレスポンスボディに JWT トークンを返す。フロントエンドはこれを `localStorage` に保存し、以降のリクエストで `Authorization: Bearer <token>` ヘッダーとして送信する。`auth_password_enabled` 設定が `'0'` の場合は `403` を返す。失敗時は `401 { "error": "Invalid credentials" }`。

**POST /api/logout** — ログアウト

フロントエンドが `localStorage` からトークンを削除する。サーバーは `{ "ok": true }` を返す。

**GET /api/me** — ログイン状態確認

```json
// ログイン済み → 200
{ "email": "user@example.com" }
// 未ログイン → 401
{ "error": "Unauthorized" }
```

JWT の `token_version` と DB の値を照合し、不一致なら `401` を返す（パスワード変更後の自動ログアウト）。

#### Passkey/WebAuthn エンドポイント

**GET /api/auth/methods** — 利用可能な認証方式（公開）

```json
// Response: 200
{
  "password": { "enabled": true },
  "passkey": { "enabled": true, "count": 2 },
  "github": { "enabled": true }
}
```

`Cache-Control: no-store` ヘッダー付き。

**GET /api/auth/login/options** — Passkeyログインチャレンジ取得（公開）

WebAuthn 認証オプションを返す。チャレンジはインメモリに保存（TTL 60秒）。`rpID` は `Origin` / `Referer` ヘッダーから動的に導出（Viteプロキシ互換）。

**POST /api/auth/login/verify** — Passkeyログイン検証（公開、レートリミット: 5回/分）

```json
// Response: 200
{ "ok": true, "token": "eyJhbGciOiJIUzI1NiIs..." }
```

検証成功時はクレデンシャルのカウンターを更新し、JWT トークンを発行する。

**GET /api/auth/register/options** — Passkey登録チャレンジ取得（要認証）

既存クレデンシャルは除外リストに含める。`residentKey: 'preferred'`, `userVerification: 'preferred'`。

**POST /api/auth/register/verify** — Passkey登録検証（要認証）

検証成功時は `credentials` テーブルに公開鍵・カウンター・デバイス情報を保存する。

**GET /api/auth/passkeys** — 登録済みPasskey一覧（要認証）

```json
// Response: 200
[
  {
    "id": 1,
    "credential_id": "abc...",
    "device_type": "multiDevice",
    "backed_up": 1,
    "created_at": "2026-02-28T10:00:00Z"
  }
]
```

**DELETE /api/auth/passkeys/:id** — Passkey削除（要認証）

ロックアウト防止: パスワード認証が無効かつGitHub OAuthも無効かつ最後のPasskeyの場合は `400` を返す。

**POST /api/auth/password/toggle** — パスワード認証の有効/無効切替（要認証）

```json
// Request
{ "enabled": false }

// Response: 200
{ "ok": true, "enabled": false }
```

Passkeyが未登録かつGitHub OAuthも無効の場合にパスワード認証を無効化しようとすると `400` を返す。

**POST /api/auth/password/change** — パスワード変更（要認証、レートリミット: 5回/分）

```json
// Request
{ "currentPassword": "old-password", "newPassword": "new-password" }
```

`newPassword` は8文字以上。Passkey または GitHub OAuth が設定済みの場合、`currentPassword` は省略可能（パスワードリセットとして動作）。成功時は `token_version` をインクリメントし、新しい JWT を返す。

```json
// Response: 200
{ "ok": true, "token": "eyJhbGciOiJIUzI1NiIs..." }
```


**POST /api/auth/email/change** — メールアドレス変更（要認証、レートリミット: 5回/分）

```json
// Request
{ "newEmail": "new@example.com", "currentPassword": "password" }
```

メールアドレスが既に使用されている場合は `409`。パスワード不一致は `401`。

```json
// Response: 200
{ "ok": true, "token": "eyJhbGciOiJIUzI1NiIs..." }
```

#### GitHub OAuth エンドポイント

**POST /api/oauth/github/authorize** — GitHub 認可URL取得（公開）

```json
// Request
{ "origin": "http://localhost:5174" }

// Response: 200
{ "url": "https://github.com/login/oauth/authorize?client_id=...&state=...&redirect_uri=..." }
```

フロントエンドが `window.location.origin` を送信し、サーバーがそれを基に callback URL を構築する（Viteプロキシ環境での不一致防止）。state はインメモリに保存（TTL 5分）。

**GET /api/oauth/github/callback** — GitHub コールバック（公開、レートリミット: 10回/分）

GitHub からのリダイレクト先。state 検証 → code を access_token に交換 → GitHub API でユーザー情報取得 → 許可ユーザー照合 → JWT 発行 → ワンタイム交換コード生成（60秒TTL）→ `/?oauth_code=<code>` にリダイレクト。JWT は URL に載せない。

許可ユーザーが未設定の場合は `GET /applications/{client_id}`（Basic認証）で OAuth App オーナーを取得し、オーナーのみ許可する。

**POST /api/oauth/github/token** — 交換コードをJWTに交換（公開、レートリミット: 5回/分）

```json
// Request
{ "code": "exchange-code-uuid" }

// Response: 200
{ "ok": true, "token": "eyJhbGciOiJIUzI1NiIs..." }
```

ワンタイム交換コードを消費し、紐づいた JWT を返す。コードは1回限り使用可能（リプレイ不可）。

**GET /api/oauth/github/config** — GitHub OAuth設定取得（要認証）

```json
// Response: 200
{ "enabled": true, "configured": true, "clientId": "Iv1.xxx", "allowedUsers": "your-github-username" }
```

`clientSecret` は絶対に返さない。

**POST /api/oauth/github/config** — GitHub OAuth設定更新（要認証）

```json
// Request
{ "clientId": "Iv1.xxx", "clientSecret": "xxx", "allowedUsers": "your-github-username" }
```

`clientSecret` が空文字の場合は既存値を維持（省略可能）。GitHub OAuthが唯一の認証手段の場合、`clientId` や `clientSecret` を空にする更新はブロックされる。

**POST /api/oauth/github/toggle** — GitHub OAuth有効/無効切替（要認証）

```json
// Request
{ "enabled": true }

// Response: 200
{ "ok": true, "enabled": true }
```

有効化時は configured チェック。無効化時はロックアウト防止チェック（Password or Passkey が有効か）。

GitHub OAuth の設定は `settings` テーブルに保存される（追加 env var ゼロ）:

| key | value 例 |
|---|---|
| `oauth_github_enabled` | `1` / `0` |
| `oauth_github_client_id` | `Iv1.xxxxxxxxxxxx` |
| `oauth_github_client_secret` | `xxxxxxxxxxxxxxxx` |
| `oauth_github_allowed_users` | カンマ区切りのGitHubユーザー名（空なら App オーナーのみ） |

#### 要認証（JWT）

認証エンドポイント・Passkey公開エンドポイント以外の全 API は `Authorization: Bearer <token>` ヘッダーの JWT を検証する。JWT の `token_version` がDB上の値と一致しない場合も `401` を返す。未認証の場合は `401 { "error": "Unauthorized" }` を返す。


**GET /api/feeds** — フィード一覧

```json
// Response: 200
{
  "feeds": [
    {
      "id": 1,
      "name": "Cloudflare Blog",
      "url": "https://blog.cloudflare.com",
      "rss_url": "https://blog.cloudflare.com/rss/",
      "rss_bridge_url": null,
      "type": "rss",
      "category_id": 1,
      "category_name": "Tech",
      "article_count": 12,
      "unread_count": 3,
      "articles_per_week": 2.5,
      "latest_published_at": "2026-03-01T12:00:00Z",
      "disabled": 0,
      "last_error": null
    }
  ],
  "clip_feed_id": 42
}
```

`article_count` と `unread_count` は `COUNT` サブクエリで算出する。`articles_per_week` は直近28日の記事数 / 4.0。`latest_published_at` は `MAX(published_at)`。`disabled = 1` のフィードも返す（UIで警告表示するため）。`category_name` は `categories` テーブルとの LEFT JOIN で取得する。`clip_feed_id` はクリップフィードの ID（未作成時は `null`）。クリップフィード自体も `feeds` 配列に含まれる（フロントエンドで `type` を見て分離表示する）。

**GET /api/opml** — OPML エクスポート

フィード一覧を OPML 2.0 形式で返す。Content-Type は `application/xml`。ファイルダウンロード用の `Content-Disposition: attachment; filename="oksskolten.opml"` ヘッダ付き。カテゴリは `<outline>` のネストで表現。`type = 'clip'` のフィードは除外。

**POST /api/opml** — OPML インポート

`multipart/form-data` でファイルを受け取り、フィードを一括登録。

```json
// Response: 200
{ "imported": 12, "skipped": 3, "errors": [] }
```

- `xmlUrl` を持つ `<outline>` のみフィードとして扱う
- 既存フィード（URL 重複）はスキップ
- 親 `<outline>` はカテゴリとして扱い、存在しなければ作成

**GET /api/feeds/:id/metrics** — フィード詳細メトリクス

```json
// Response: 200
{ "avg_content_length": 3245.5 }
```

フィード単体表示時にオンデマンドで取得する重い集計。`avg_content_length` は `AVG(LENGTH(full_text))`（`full_text` が null の記事は除外）。フィードが存在しない場合は `404`。

**GET /api/articles** — 記事一覧（`published_at IS NULL, published_at DESC` でソート、NULLは末尾）

クエリパラメータ:

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `feed_id` | number | — | フィードIDでフィルタ |
| `category_id` | number | — | カテゴリIDでフィルタ（所属フィードの記事を返す） |
| `unread` | `"1"` | — | 指定時は未読（`seen_at IS NULL`）のみ。省略またはそれ以外の値は全件 |
| `bookmarked` | `"1"` | — | 指定時はブックマーク済みのみ |
| `liked` | `"1"` | — | 指定時はいいね済みのみ |
| `read` | `"1"` | — | 指定時は閲読済み（`read_at IS NOT NULL`）のみ。`/history` ルート用 |
| `sort` | `"score"` | — | 指定時はスコア降順でソート。未指定時は既存ロジック（liked→`liked_at DESC`, read→`read_at DESC`, その他→`published_at DESC`） |
| `limit` | number | 20 | 取得件数（最大100） |
| `offset` | number | 0 | オフセット |

```json
// Response: 200
{
  "articles": [
    {
      "id": 1,
      "feed_id": 1,
      "feed_name": "Cloudflare Blog",
      "title": "Markdown for Agents",
      "url": "https://blog.cloudflare.com/new-features-2025",
      "published_at": "2025-02-26T00:00:00Z",
      "lang": "en",
      "summary": "AIエージェント向けに...",
      "excerpt": "This article explains...",
      "og_image": "https://blog.cloudflare.com/content/images/...",
      "seen_at": null,
      "read_at": null,
      "bookmarked_at": null,
      "liked_at": null
    }
  ],
  "total": 42,
  "has_more": true
}
```

`feed_name` は `feeds` テーブルとの JOIN で取得する。`has_more` は `offset + articles.length < total` のとき `true`。フロントエンドは `has_more === false` で無限スクロールを停止する。

**Smart Floor（表示範囲の自動制限）**

特殊フィルタ（`unread`, `bookmarked`, `liked`, `read`）がいずれも指定されていない場合、表示範囲を自動的に制限する（Smart Floor）。これにより、フィード・カテゴリビューで数千件の記事が蓄積されても、実用的な範囲のみを返す。

フロアの決定ロジック:

3つの候補日のうち **最も古い日付** をフロアとして採用し、表示件数が最大になるようにする。

1. **直近1週間**: `now - 7 days`
2. **最新20件**: 新しい方から20番目の記事の `published_at`（20件未満ならすべて）
3. **最古の未読記事**: 未読記事がある場合、その `MIN(published_at)`

つまり `max(1週間分の件数, 20件)` をベースとし、未読がさらに古くまで遡る場合はそこまで拡張する。逆に未読の範囲が1週間や20件より狭い場合はベースが優先される。

`total` と `has_more` はフロア適用後の件数に基づく。`published_at IS NULL` の記事はフロアに関係なく常に含まれる。Inbox（`unread=1`）、Bookmarks、Likes、History ビューではフロアは適用されない。


**GET /api/articles/search** — 記事検索（Meilisearch 全文検索）

- `q`: 必須。Meilisearch による全文検索（タイポ耐性・関連性ランキング付き）。検索対象は `title`, `full_text`, `full_text_ja`
- `feed_id`: 任意。フィードIDで絞り込み（Meilisearch filter）
- `category_id`: 任意。カテゴリIDで絞り込み（Meilisearch filter）
- `since`: 任意。開始日時 ISO 8601（Meilisearch filter）
- `until`: 任意。終了日時 ISO 8601（Meilisearch filter）
- `unread`: 任意。`1` で未読のみ、`0` で既読のみ（SQLite 後段フィルタ）
- `liked`: 任意。`1` でいいね済みのみ（SQLite 後段フィルタ）
- `bookmarked`: 任意。`1` でブックマーク済みのみ（SQLite 後段フィルタ）
- `limit`: 任意（デフォルト 20、最大 50）
- 検索インデックス未構築時は `503` を返す

```json
// Response: 200
{ "articles": [{ "id": 1, "title": "...", "url": "...", "feed_name": "...", "published_at": "..." }, ...] }
```


**GET /api/articles/by-url?url=...** — 記事詳細（URLで取得）

```json
// Response: 200
{
  "id": 1,
  "feed_id": 1,
  "feed_name": "Cloudflare Blog",
  "title": "Markdown for Agents",
  "url": "https://blog.cloudflare.com/new-features-2025",
  "published_at": "2025-02-26T00:00:00Z",
  "lang": "en",
  "summary": "AIエージェント向けに...",
  "og_image": "https://blog.cloudflare.com/content/images/...",
  "full_text": "# Markdown for Agents\n\n...",
  "full_text_ja": "# エージェント向けMarkdown\n\n...",
  "seen_at": null,
  "read_at": null,
  "bookmarked_at": null,
  "liked_at": null
}
```

該当記事が存在しない場合は `404 { "error": "Article not found" }`。


**POST /api/articles/check-urls** — URL一括存在チェック

```json
// Request
{ "urls": ["https://example.com/1", "https://example.com/2"] }

// Response: 200
{ "existing": ["https://example.com/1"] }
```

最大200件。既にDBに存在するURLの一覧を返す。


**PATCH /api/articles/:id/seen** — 認知状態を変更する

```json
// Request
{ "seen": true }
```

`seen` は `true`（認知済み）または `false`（未認知に戻す）。`false` の場合は `seen_at` と `read_at` の両方を `NULL` にする。

```json
// Response: 200
{ "seen_at": "2025-06-01T12:00:00", "read_at": null }
```

該当記事が存在しない場合は `404`。


**POST /api/articles/:id/read** — 記事を読んだことを記録する

リクエストボディなし。`read_at` を現在日時で上書きし、`seen_at` が未設定なら同時にセットする（`COALESCE`）。記事を開くたびに呼ぶ。

```json
// Response: 200
{ "seen_at": "2025-06-01T12:00:00", "read_at": "2025-06-01T14:30:00" }
```

該当記事が存在しない場合は `404`。


**PATCH /api/articles/:id/bookmark** — ブックマークトグル

```json
// Request
{ "bookmarked": true }
```

`bookmarked` は `true`（ブックマーク）または `false`（解除）。

```json
// Response: 200
{ "bookmarked_at": "2025-06-01T12:00:00" }
```

該当記事が存在しない場合は `404`。


**PATCH /api/articles/:id/like** — いいねトグル

```json
// Request
{ "liked": true }
```

`liked` は `true`（いいね）または `false`（解除）。

```json
// Response: 200
{ "liked_at": "2025-06-01T12:00:00" }
```

`liked` が `false` の場合は `{ "liked_at": null }`。該当記事が存在しない場合は `404`。


**POST /api/articles/batch-seen** — 一括認知化

```json
// Request
{ "ids": [1, 2, 3] }

// Response: 200
{ "updated": 3 }
```

最大100件。`seen_at IS NULL` の記事のみ更新する。


**POST /api/articles/:id/summarize** — 記事要約（オンデマンド）

既に `summary` がある場合はキャッシュを返す。`full_text` が NULL の場合は `400`。

クエリパラメータ `stream=1` でSSEストリーミング応答:

```
data: {"type":"delta","text":"AIエージェント..."}
data: {"type":"delta","text":"向けに..."}
data: {"type":"done","summary":"...", "usage":{"input_tokens":1234,"output_tokens":456}}
```

バッチ応答（`stream` パラメータなし）:

```json
// Response: 200
{ "text": "AIエージェント向けに...", "usage": { "input_tokens": 1234, "output_tokens": 456 } }
```


**POST /api/articles/:id/translate** — 記事翻訳（オンデマンド）

既に `full_text_ja` がある場合はキャッシュを返す。`full_text` が NULL の場合は `400`。`lang` が `"ja"` の場合は `400`。

クエリパラメータ `stream=1` でSSEストリーミング応答（形式は summarize と同様）。


**POST /api/articles/from-url** — URLから記事をクリップ保存

```json
// Request
{ "url": "https://example.com/article", "title": "任意のタイトル（省略可）", "force": true }

// Response: 201
{ "article": { ... }, "created": true }
```

`force` は省略可。既存RSS記事をクリップに移動する場合に `true` を指定する。

| ステータス | 条件 |
|---|---|
| 201 | 記事作成成功 |
| 200 | `force=true` で既存RSS記事をクリップに移動（`{ "article": {...}, "moved": true }`） |
| 400 | `url` 未指定 |
| 409 | 同じURLの記事が既に存在（クリップ記事の場合）。RSSフィード記事の場合は `can_force: true` を含む |
| 500 | クリップフィードが未作成（通常発生しない） |

処理フロー:
1. `getClipFeed()` でクリップフィードを取得
2. 既存記事チェック: クリップに既存なら `409`、RSSフィードに既存なら `force` に応じて移動または `409`（`can_force: true`）
3. `fetchFullText(url)` でコンテンツを取得（失敗時は `last_error` に記録し、`full_text = NULL` で記事を作成）
4. `detectLanguage()` で言語判定
5. タイトルの優先順位: リクエストの `title` > ページの `og:title` > URLのホスト名
6. `insertArticle()` でクリップフィードに記事を追加


**DELETE /api/articles/:id** — クリップ記事を削除

```json
// Response: 204 (No Content)
```

| ステータス | 条件 |
|---|---|
| 204 | 削除成功 |
| 403 | RSSフィード記事の削除は禁止（`feed_type !== 'clip'`） |
| 404 | 記事が見つからない |

`images_archived_at` がセットされている場合、ローカルにアーカイブされた画像ファイルも削除する。


**POST /api/articles/:id/archive-images** — 記事内の画像をアーカイブ

```json
// Response: 202
{ "status": "accepted" }
```

| ステータス | 条件 |
|---|---|
| 202 | バックグラウンド処理開始 |
| 400 | `full_text` なし、または画像アーカイブが無効 |
| 404 | 記事が見つからない |
| 409 | 既にアーカイブ済み |

202を返した後、バックグラウンドで画像をダウンロードし、Markdownの画像URLをローカル/リモートURLに書き換える。詳細は [81_feature_images.md](./81_feature_images.ja.md) 参照。


**GET /api/articles/images/:filename** — アーカイブ画像の配信

ローカル保存された画像を配信する。ファイル名のパストラバーサルチェックを行う（`path.basename` + `..` 検出）。

レスポンスヘッダー:
- `Content-Type`: 拡張子に基づくMIMEタイプ（`.jpg`, `.png`, `.gif`, `.webp`, `.svg`, `.avif`）
- `Cache-Control: public, max-age=31536000, immutable`


**POST /api/feeds** — フィード追加

```json
// Request
{
  "name": "Cloudflare Blog",
  "url": "https://blog.cloudflare.com",
  "rss_bridge_url": null,
  "category_id": 1
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| `url` | Yes | ブログのトップURL |
| `name` | No | 表示名（省略時はRSSフィードタイトルまたはホスト名を自動使用） |
| `rss_bridge_url` | No | RSSBridge経由の場合のURL |
| `category_id` | No | カテゴリID |

処理フロー:
1. `url` の重複チェック → 重複時は `409 { "error": "Feed URL already exists" }`
2. `rss_bridge_url` が指定されていればそのまま使用
3. 未指定なら 3 段階のフォールバックチェーンで RSS URL を解決:
   - **Step 1: RSS 自動検出** — URLを取得し、Content-Typeが `xml`/`atom`/`rss` なら直接フィードとして採用。そうでなければHTMLとして `<link rel="alternate">` を探す → 候補パス (`/feed`, `/feed.xml`, `/rss`, `/rss.xml`, `/atom.xml`, `/index.xml`) を試す → 見つかれば `rss_url` に保存
     - **Bot認証フォールバック**: 通常fetchが403を返した場合、FlareSolverr経由でリトライ。FlareSolverrが使われた場合は `requires_js_challenge = 1` を自動セットし、以降のRSS取得・記事本文取得もすべてFlareSolverr経由で実行する
   - **Step 2: RSS Bridge findfeed** — `RSS_BRIDGE_URL` が設定済みなら `?action=findfeed` で問い合わせ → 見つかれば `rss_bridge_url` に保存
   - **Step 3: CssSelectorBridge 自動推定** — LLM でページの HTML を解析し、記事一覧の CSS セレクタを推定 → CssSelectorBridge URL を生成・検証 → `rss_bridge_url` に保存（詳細は「CssSelectorBridge 自動推定」セクション参照）
   - すべて失敗 → `201` で返すが `rss_url = null`、`rss_bridge_url = null`。フロントエンドがユーザーに `rss_bridge_url` の入力を促す
4. RSS URLが確定したら、バックグラウンドで `fetchSingleFeed` を実行（fire-and-forget）

レスポンスは `text/event-stream`（SSE）で、各ステップの進捗をリアルタイムに通知する:

```
data: {"type":"step","step":"rss-discovery","status":"running"}
data: {"type":"step","step":"flaresolverr","status":"running"}       // Bot認証が必要な場合のみ出現
data: {"type":"step","step":"flaresolverr","status":"done","found":true}
data: {"type":"step","step":"rss-discovery","status":"done","found":true}
data: {"type":"step","step":"rss-bridge","status":"skipped"}
data: {"type":"step","step":"css-selector","status":"skipped"}
data: {"type":"done","feed":{"id":1,"name":"...","rss_url":"...","rss_bridge_url":null}}
```

ステップ名: `rss-discovery`, `flaresolverr`（条件付き）, `rss-bridge`, `css-selector`
ステータス: `pending`, `running`, `done`, `skipped`
`flaresolverr` ステップはRSS検出の子ステップとして、UIでは階層表示する。通常時（Bot認証不要）は出現しない。

```json
// Response (最終イベントの feed オブジェクト):
{
  "id": 1,
  "name": "Cloudflare Blog",
  "url": "https://blog.cloudflare.com",
  "rss_url": "https://blog.cloudflare.com/rss/",
  "rss_bridge_url": null,
  "category_id": 1,
  "requires_js_challenge": 0
}
```


**PATCH /api/feeds/:id** — フィード更新

```json
// Request（すべてオプショナル、指定したフィールドのみ更新）
{
  "name": "New Name",
  "rss_bridge_url": "http://rss-bridge/?...",
  "disabled": 0,
  "category_id": 2
}
```

更新可能フィールド: `name`, `rss_bridge_url`, `disabled`（`0` or `1`）, `category_id`。`url`, `rss_url` は変更不可（リクエストに含まれても無視する）。`disabled: 0` を指定すると `error_count` も `0`、`last_error` も `NULL` にリセットする。

```json
// Response: 200（フィードの全フィールドを返す）
{
  "id": 1,
  "name": "New Name",
  "url": "https://blog.cloudflare.com",
  "rss_url": "https://blog.cloudflare.com/rss/",
  "rss_bridge_url": null,
  "category_id": 2,
  "category_name": "Tech",
  "disabled": 0,
  "last_error": null,
  "article_count": 12,
  "unread_count": 3
}
```

該当フィードが存在しない場合は `404`。


**DELETE /api/feeds/:id** — フィード削除

紐づく記事は `ON DELETE CASCADE` で自動削除される。クリップフィード（`type = 'clip'`）の削除は `403` で拒否する。

```json
// Response: 204 (No Content)
```

該当フィードが存在しない場合は `404`。


**POST /api/feeds/:id/mark-all-seen** — フィード内全記事を認知済みにする

```json
// Response: 200
{ "updated": 5 }
```


**GET /api/feeds/:id/fetch-progress** — フィード取得進捗（SSE）

フィード追加後の記事取得進捗をSSEストリームで返す。遅延接続にも対応（現在の状態をリプレイ）。

```
data: {"type":"feed-articles-found","feed_id":1,"total":10}
data: {"type":"article-done","feed_id":1,"fetched":1,"total":10}
data: {"type":"article-done","feed_id":1,"fetched":2,"total":10}
...
data: {"type":"feed-complete","feed_id":1}
```


**GET /api/discover-title?url=...** — ブログタイトル自動取得

```json
// Response: 200
{ "title": "Cloudflare Blog" }
```

RSS自動検出を実行し、フィードタイトルまたはページタイトルを返す。見つからない場合は `{ "title": null }`。


#### カテゴリエンドポイント

**GET /api/categories** — カテゴリ一覧

```json
// Response: 200
{
  "categories": [
    { "id": 1, "name": "Tech", "sort_order": 0, "collapsed": 0, "created_at": "..." }
  ]
}
```

`sort_order ASC, name COLLATE NOCASE ASC` でソート。

**POST /api/categories** — カテゴリ作成

```json
// Request
{ "name": "Tech" }

// Response: 201
{ "id": 1, "name": "Tech", "sort_order": 0, "collapsed": 0, "created_at": "..." }
```

`sort_order` は既存の最大値+1を自動設定。

**PATCH /api/categories/:id** — カテゴリ更新

```json
// Request（すべてオプショナル）
{ "name": "Technology", "sort_order": 1, "collapsed": 0 }
```

該当カテゴリが存在しない場合は `404`。

**DELETE /api/categories/:id** — カテゴリ削除

紐づくフィードの `category_id` は `NULL` に更新される（フィード自体は削除されない）。

```json
// Response: 204 (No Content)
```

**POST /api/categories/:id/mark-all-seen** — カテゴリ内全記事を認知済みにする

```json
// Response: 200
{ "updated": 15 }
```


#### 設定エンドポイント

**GET /api/settings/profile** — プロフィール取得

```json
// Response: 200
{
  "account_name": "user@example.com",
  "avatar_seed": "abc123",
  "language": "ja",
  "email": "user@example.com"
}
```

`account_name` が未設定の場合は認証メールアドレスを初期値として保存する。

**PATCH /api/settings/profile** — プロフィール更新

```json
// Request（すべてオプショナル）
{ "account_name": "My Name", "avatar_seed": "xyz", "language": "ja" }
```

`language` は `"ja"` または `"en"` のみ。

**GET /api/settings/preferences** — 表示設定取得

```json
// Response: 200
{
  "appearance.color_theme": "nord",
  "reading.date_mode": "relative",
  "reading.auto_mark_read": "on",
  "reading.unread_indicator": "on",
  "reading.internal_links": "off",
  "reading.show_thumbnails": "on",
  "reading.show_feed_activity": "on",
  "reading.chat_position": "fab",
  "reading.article_open_mode": "page",
  "appearance.highlight_theme": "github-dark",
  "appearance.font_family": null,
  "appearance.list_layout": "list",
  "appearance.mascot": "off"
}
```

未設定の項目は `null`。

**PATCH / POST /api/settings/preferences** — 表示設定更新

```json
// Request（すべてオプショナル）
{ "appearance.color_theme": "nord", "reading.date_mode": "absolute" }
```

| キー | 許可値 |
|---|---|
| `appearance.color_theme` | 任意の文字列（テーマ名） |
| `reading.date_mode` | `"relative"` / `"absolute"` |
| `reading.auto_mark_read` | `"on"` / `"off"` |
| `reading.unread_indicator` | `"on"` / `"off"` |
| `reading.internal_links` | `"on"` / `"off"` |
| `reading.show_thumbnails` | `"on"` / `"off"` |
| `reading.show_feed_activity` | `"on"` / `"off"` |
| `reading.chat_position` | `"fab"` / `"inline"` |
| `reading.article_open_mode` | `"page"` / `"overlay"` |
| `appearance.highlight_theme` | 任意の文字列（テーマ名）。空文字で削除 |
| `appearance.font_family` | 任意の文字列（フォント名）。空文字で削除 |
| `appearance.list_layout` | `"list"` / `"card"` / `"magazine"` / `"compact"` |
| `appearance.mascot` | `"off"` / `"dream-puff"` / `"sleepy-giant"` |
| `chat.provider` | `"anthropic"` / `"gemini"` / `"openai"` / `"claude-code"` |
| `chat.model` | プロバイダーに応じたモデルID |
| `summary.provider` | `"anthropic"` / `"gemini"` / `"openai"` / `"claude-code"` |
| `summary.model` | プロバイダーに応じたモデルID |
| `translate.provider` | `"anthropic"` / `"gemini"` / `"openai"` / `"claude-code"` / `"google-translate"` / `"deepl"` |
| `translate.model` | プロバイダーに応じたモデルID（google-translate / deepl 時は不要） |


**GET /api/settings/api-keys/:provider** — APIキー設定状態確認（要認証）

`provider` は `anthropic`, `gemini`, `openai`, `google-translate`, `deepl` のいずれか。

```json
// Response: 200
{ "configured": true }
```

未知のプロバイダーは `400`。

**POST /api/settings/api-keys/:provider** — APIキー保存/削除（要認証）

```json
// Request
{ "apiKey": "sk-..." }
```

`apiKey` が空文字または省略の場合はキーを削除する。

```json
// Response: 200
{ "ok": true, "configured": true }
```


**GET /api/settings/google-translate/usage** — Google Translate 月間使用量（要認証）

```json
// Response: 200
{ "monthlyChars": 12345, "freeTierRemaining": 487655 }
```

**GET /api/settings/deepl/usage** — DeepL 月間使用量（要認証）

```json
// Response: 200
{ "monthlyChars": 12345, "freeTierRemaining": 487655 }
```


#### 画像ストレージ設定エンドポイント

**GET /api/settings/image-storage** — 画像ストレージ設定取得

```json
// Response: 200
{
  "images.enabled": "1",
  "mode": "local",
  "url": "",
  "headersConfigured": false,
  "fieldName": "image",
  "respPath": "",
  "images.storage_path": null,
  "images.max_size_mb": null
}
```

**PATCH /api/settings/image-storage** — 画像ストレージ設定更新

```json
// Request（すべてオプショナル）
{
  "images.enabled": "1",
  "images.storage_path": "/custom/path",
  "images.max_size_mb": "20",
  "mode": "local",
  "url": "https://upload.example.com/api",
  "headers": "{\"Authorization\":\"Bearer token\"}",
  "fieldName": "file",
  "respPath": "data.url"
}
```

| フィールド | バリデーション |
|---|---|
| `images.max_size_mb` | 1〜100の数値。空文字で削除 |
| `mode` | `"local"` / `"remote"` |
| `url` | SSRF チェック（`assertSafeUrl`）。空文字で削除 |
| `headers` | 有効なJSONオブジェクト（配列・非JSONは拒否）。空文字で削除 |

settings テーブルのキー:

| key | 説明 |
|---|---|
| `images.enabled` | `'1'` / `'true'` で有効 |
| `images.storage` | `'local'` / `'remote'` |
| `images.storage_path` | ローカル保存先パス（デフォルト: `data/articles/images`） |
| `images.max_size_mb` | 最大ファイルサイズ（MB、デフォルト: 10） |
| `images.upload_url` | リモートアップロード先URL |
| `images.upload_headers` | リモートアップロード時のHTTPヘッダー（JSON文字列） |
| `images.upload_field` | フォームフィールド名（デフォルト: `'image'`） |
| `images.upload_resp_path` | レスポンスからURLを抽出するドットパス（例: `'data.url'`） |


**POST /api/settings/image-storage/test** — リモートアップロードテスト

1x1透過PNGをリモートサーバーにアップロードし、レスポンスからURLを抽出できるか検証する。

```json
// Response: 200
{ "success": true, "url": "https://cdn.example.com/test.png" }
```

| ステータス | 条件 |
|---|---|
| 200 | テスト成功 |
| 400 | `mode` が `remote` でない / 設定不完全 / アップロード失敗 / URL抽出失敗 |


**POST /api/settings/image-storage/healthcheck** — リモートストレージ疎通確認

`images.healthcheck_url` に設定されたURLにGETリクエストを送信し、疎通を確認する。タイムアウト10秒。

```json
// Response: 200
{ "ok": true, "status": 200 }
```

| ステータス | 条件 |
|---|---|
| 200 | 疎通成功 |
| 400 | `images.healthcheck_url` 未設定 / SSRF ブロック / 疎通失敗 |


#### 管理エンドポイント

**POST /api/admin/fetch-all** — 全フィードを即時取り込み（SSE）

全フィードの記事を取得し、進捗をSSEストリームで返す。

```
data: {"type":"feed-articles-found","feed_id":1,"total":5}
data: {"type":"article-done","feed_id":1,"fetched":1,"total":5}
...
data: {"type":"feed-complete","feed_id":1}
data: {"type":"feed-articles-found","feed_id":2,"total":3}
...
data: {"type":"feed-complete","feed_id":2}
```


