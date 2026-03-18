# Oksskolten 実装仕様書 — 類似記事検出

> [概要に戻る](./01_overview.ja.md)

## 類似記事検出

### 課題

同じトピック（例: テックニュース）をカバーする複数のフィードを購読しているユーザーは、異なるソースから同じニュースを何度も目にする。これはフィード一覧のノイズとなる。

### 解決策

異なるフィード間で類似記事を検出し、2つの動作を提供する:

1. **類似記事バナー**: 記事閲覧時に、同じニュースを報じた他のソースを通知表示
2. **自動既読化**: 別のソースで類似記事を既に読んでいる場合、重複記事の `seen_at` を自動的にセット（未読カウントから除外）

### 検出アルゴリズム

**2段階: Meilisearch タイトル検索 + Bigram Dice 係数**

1. 新記事の挿入後、タイトルをクエリとして Meilisearch を検索
2. 候補をフィルタ: 異なるフィード（`feed_id != X`）、`published_at` の ±3日以内
3. 新記事のタイトルと各候補のタイトルで bigram Dice 係数を計算
4. スコア 0.4 以上をマッチとして採用

```
Dice(A, B) = 2 × |bigrams(A) ∩ bigrams(B)| / (|bigrams(A)| + |bigrams(B)|)
```

`bigrams(s)` は各単語から小文字化・句読点除去後に文字バイグラムを抽出する。閾値 0.4 は言い換えた見出し（「Appleが iPhone 17を発表」vs「Apple、新型iPhone 17を披露」）を検出しつつ、共通語を含むだけの無関係な記事は除外する。

LLM や Embedding のコスト不要 — 既存の Meilisearch キーワード検索インフラを使用。

### ストレージ

```sql
CREATE TABLE article_similarities (
  article_id    INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  similar_to_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  score         REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, similar_to_id)
);

CREATE INDEX idx_similarities_similar_to ON article_similarities(similar_to_id);
```

- 双方向: AがBに類似する場合、`(A, B)` と `(B, A)` の両方を格納
- 検索は常に `WHERE article_id = ?`（単方向クエリ）
- `ON DELETE CASCADE` により記事削除時に自動クリーンアップ

### 検出タイミング

フェッチャーパイプラインの `insertArticle()` 後に非同期（fire-and-forget）で実行:

```
insertArticle()
  → syncArticleToSearch()           [既存, fire-and-forget]
  → detectAndStoreSimilarArticles() [新規, fire-and-forget]
      → Meilisearch タイトル検索（同一フィード除外、±3日）
      → Bigram Dice フィルタ（>= 0.4）
      → article_similarities に INSERT（双方向）
      → 類似記事に read_at あり → 新記事を markArticleSeen
```

取り込みパイプラインをブロックしない。`full_text` が null でもタイトルで検出可能。

### 自動既読ロジック

`read_at IS NOT NULL` の類似記事が見つかった場合、新記事の `seen_at` を現在時刻にセットする。`read_at` は**セットしない** — この区別は意図的:

- `seen_at` により未読カウントから除外され、フィードのノイズが軽減される
- `read_at` はユーザーが実際に記事を開いた場合にのみ使用
- ユーザーは記事を開いて別ソースの視点を読むことができる

### API

**GET /api/articles/:id/similar** — 類似記事を取得

```json
// Response: 200
{
  "similar": [
    {
      "id": 123,
      "feed_name": "TechCrunch",
      "title": "Apple announces iPhone 17",
      "url": "https://techcrunch.com/...",
      "published_at": "2026-03-18T10:00:00Z",
      "read_at": "2026-03-18T11:05:00Z",
      "score": 0.82
    }
  ]
}
```

類似度スコア降順でソート。

**記事一覧・詳細レスポンス** に `similar_count`（整数）を追加。サブクエリで計算:

```sql
(SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
```

### フロントエンド

**記事詳細ビュー**: `similar_count > 0` の場合、要約セクションの下に折りたたみ可能なバナーを表示:

- 「この記事は {feedNames} でも報じられています」— 類似記事に `read_at` がある場合は「この記事は {feedNames} でも報じられており、既に読んでいます」
- 展開可能な `<details>` セクションに各類似記事のタイトル、フィード名、既読状態を表示
- 類似記事クリックでアプリ内遷移（`articleUrlToPath` による SPA ナビゲーション）

**記事リスト**: `similar_count > 0` の記事のメタデータ行（日付の後）に小さな `Layers` アイコンを表示。

### 主要ファイル

| ファイル | 用途 |
|---------|------|
| `migrations/0004_article_similarities.sql` | スキーマ |
| `server/db/similarities.ts` | DB関数: insertSimilarity, getSimilarArticles, findReadSimilarArticle |
| `server/similarity.ts` | 検出ロジック: detectAndStoreSimilarArticles, computeTitleSimilarity |
| `server/fetcher.ts` | フック: insertArticle 後に detectAndStoreSimilarArticles を呼び出し |
| `server/routes/articles.ts` | エンドポイント: GET /api/articles/:id/similar |
| `server/db/articles.ts` | getArticles, getArticleByUrl, getArticleById に similar_count サブクエリ追加 |
| `src/components/article/article-similar-banner.tsx` | フロントエンド バナーコンポーネント |
