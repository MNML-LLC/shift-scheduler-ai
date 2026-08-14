# LINE通知（リマインド含む）再有効化ランブック

Issue #244 対応。`NOTIFICATION_ENABLED=false` で意図的に無効化されている LINE 通知機能
（第1案承認通知・シフト確定通知・月次バッチ通知・リマインド系）を、安全に再有効化する
ための **判断基準（チェックリスト）・手順・モニタリング・ロールバック** を規定する。

- **前提**: 実装自体は完了・デプロイ済み（Issue #160 で `NOTIFICATION_ENABLED` フラグ導入、
  Issue #240 系で cron 実装済み）。本ドキュメントは「機能追加」ではなく「フラグの ON 切替」に
  伴う運用手順の SoT。
- **原則**: **CEO の明示的承認なしに `NOTIFICATION_ENABLED=true` へ切替してはならない**
  （本番のスタッフ端末に直接届く通知であり、誤送信のリカバリコストが高いため）。
- 関連ドキュメント: [`monthly-first-plan-batch.md`](monthly-first-plan-batch.md) /
  [`staging-verification-flow.md`](staging-verification-flow.md) /
  [`../MESSAGES_AND_ALERTS.md`](../MESSAGES_AND_ALERTS.md)

---

## 1. 影響範囲（何が有効化されるか）

`NOTIFICATION_ENABLED=true` を設定すると、以下のトリガーで LIFF backend の通知エンドポイントが
呼ばれ、対象スタッフの LINE アカウントへメッセージが送信される
（実装: `backend/src/routes/shifts.js` の `isLineNotificationEnabled()`）。

| # | トリガー | 呼び出し先エンドポイント | 送信対象 |
|---|---|---|---|
| 1 | `POST /api/shifts/plans/approve-first` （第1案承認） | `POST {LIFF_BACKEND_URL}/api/notification/first-plan-approved` | 対象店舗の全 LINE 連携スタッフ |
| 2 | `POST /api/shifts/plans/monthly-first-plan-batch` （月次バッチ・毎月1日 9:00 JST） | 同上 | 新規作成された店舗の全 LINE 連携スタッフ |
| 3 | `PUT /api/shifts/plans/:plan_id/status` （FIRST→APPROVED） | 同上 | 対象店舗の全 LINE 連携スタッフ |
| 4 | `PUT /api/shifts/plans/:plan_id/status` （CONFIRMED） | `POST {LIFF_BACKEND_URL}/api/notification/shift-confirmed` | 対象店舗の全 LINE 連携スタッフ（個別シフト情報付き） |
| 5 | LIFF backend のリマインド cron（Issue #240 系） | LIFF backend 内部処理 | 未提出スタッフ（詳細は LIFF リポの実装参照） |

**フラグは backend 側の判定**。LIFF backend 側では常に受信可能な状態のため、
backend の `NOTIFICATION_ENABLED` を `true` にした瞬間から上記全てが有効化される
（トリガーごとの部分有効化はできない）。

---

## 2. 再有効化の判断チェックリスト（CEO 承認前）

以下の全項目を確認し、いずれか一つでも "NG" があれば `NOTIFICATION_ENABLED=true` に切り替えない。
チェック実施者（shift M層）は結果を Slack thread または対象 Issue に貼り付ける。

### 2.1 コード・実装の健全性

- [ ] `backend/src/routes/shifts.js` の `isLineNotificationEnabled()` 判定ロジックが
      `NOTIFICATION_ENABLED === 'true'` の厳密比較になっている（`'1'` や truthy 変換を含まない）
- [ ] `backend/test/routes/shifts.plan-status.test.js` の "NOTIFICATION_ENABLED guard" テストが
      直近の CI で全通過している（`cd backend && npm run test -- --run` で緑）
- [ ] `LIFF_BACKEND_URL` が本番の LIFF backend URL（`https://shift-scheduler-ai-liff-production.up.railway.app`）に
      正しく設定されている（Railway ダッシュボードで確認）
- [ ] LIFF backend 側の通知受信エンドポイント（`/api/notification/first-plan-approved`・`/api/notification/shift-confirmed`）が
      直近1週間の `/api/health` で 200 を返し続けている

### 2.2 通知対象データの健全性

- [ ] LINE 連携済みスタッフの人数を本番 DB で確認済み
      （オペレータに実行してもらう:
      `SELECT COUNT(*) FROM hr.staff_line_accounts sla JOIN hr.staff s ON sla.staff_id = s.staff_id WHERE sla.is_active = true AND s.is_active = true;`）
- [ ] 上記人数が想定範囲内であること（テスト用の古い LINE ID や退職済みスタッフが混入していないか）
- [ ] 直近1ヶ月に退職・異動したスタッフの `is_active=false` 反映が完了している
      （退職者に通知が飛ばないことを確認）
- [ ] LINE 連携済みスタッフのうち、テスト店舗（fixtures 由来のダミー店舗）に紐づくレコードが
      本番 DB に残っていないこと

### 2.3 メッセージ文言の最終確認

- [ ] `docs/MESSAGES_AND_ALERTS.md` に記載された通知文言（第1案承認・シフト確定）が最新版で、
      CEO / shift M層のレビュー済みであること
- [ ] LIFF backend 側の Flex Message テンプレートに古いテスト文言（`【TEST】` 等のプレフィックス）が
      残っていないこと
- [ ] 差出人アカウント名（LINE 公式アカウント表示名）が本番用の正式名称になっていること

### 2.4 staging での事前検証

- [ ] staging 環境（`NOTIFICATION_ENABLED=true`）で以下を smoke test 済み:
  1. 第1案承認 → staging 用テスト LINE アカウントに1通届く
  2. 月次バッチ（workflow_dispatch で手動起動）→ 対象店舗数と Slack 通知が一致
  3. CONFIRMED 遷移 → シフト確定通知が届く（自分のシフト情報が正しく載っていること）
  4. リマインド cron（LIFF backend 側で対応する staging 実装を手動起動）→ 未提出スタッフのみに届く
- [ ] 上記 smoke test の実施日時（JST）・件数・結果を Issue の「smoke test 結果」欄に記録済み

### 2.5 段階的ロールアウトの計画

- [ ] **最初は1店舗のみ**で本番検証する運用計画になっている（DB でその店舗のスタッフ以外の
      `hr.staff_line_accounts.is_active` を一時的に `false` にする、または LIFF backend 側で
      店舗フィルタを効かせる等）
- [ ] 1店舗検証で 24 時間問題がないことを確認してから全店舗展開する順序が合意済み
- [ ] 段階拡大の各ステップで、次項「モニタリング」を実施できる時間帯（営業時間内・オペレータ待機）に
      切り替えを行う計画

### 2.6 CEO 承認

- [ ] 上記 2.1〜2.5 全てをまとめて CEO に共有し、書面（Slack thread）で「有効化承認」の
      明示的な返答を得た

---

## 3. 再有効化の手順

**環境変数の SoT は Railway ダッシュボード**（backend サービスの Variables）。
`backend/.env.example` のデフォルトは開発参照用であり、本番挙動には影響しない。

### 3.1 staging での事前確認（本番切替の直前）

1. Railway ダッシュボード → **staging environment** → **shift-scheduler-ai** サービス → **Variables**
2. `NOTIFICATION_ENABLED` を `true` に設定（既に `true` の場合はスキップ）
3. サービスを **Restart**（環境変数を反映）
4. `GET {staging_backend}/api/health` で 200 & `database.host` に `switchyard` が含まれることを確認
5. § 2.4 の staging smoke test を再度1回実施（切替直前に最終確認）

### 3.2 本番切替（1店舗検証フェーズ）

1. **切替の直前**に、以下のいずれかの方法で通知対象を1店舗に限定する:
   - **推奨**: LIFF backend 側で環境変数 `NOTIFICATION_STORE_ALLOWLIST=<store_id>` 等の
     フィルタを効かせる（LIFF リポで実装がある場合）
   - **フォールバック**: 本番 DB で対象1店舗以外のスタッフの
     `hr.staff_line_accounts.is_active` を一時的に `false` にする SQL を用意し、事前に切戻し
     SQL（`is_active = true` へ戻す）とセットでオペレータに送付する
     （`line_user_id` は `NOT NULL` 制約があるため NULL 退避は使えない。無効化は
     `is_active` トグルで行う）
2. Railway ダッシュボード → **production environment** → **shift-scheduler-ai** サービス → **Variables**
3. `NOTIFICATION_ENABLED` を `true` に設定
4. サービスを **Restart**（Variables 変更後は自動で再起動されるが、明示的に確認）
5. `GET {prod_backend}/api/health` で 200 を確認
6. 対象1店舗で意図的にトリガーを発火（例: 第1案の再承認）し、1通だけ届くことを確認
7. § 4 のモニタリングを 24 時間実施

### 3.3 本番切替（全店舗展開フェーズ）

1. § 3.2 の 24 時間観察で問題がなければ、店舗フィルタ / 退避 SQL を解除する
2. 解除後、次のトリガー発火（月次バッチ / 承認操作）を Slack で全員が観察できる時間帯に実施する
3. 再度 24 時間モニタリング（§ 4）

---

## 4. モニタリング（切替後・最低 24 時間）

### 4.1 サーバーログでの検知

Railway backend のログを継続監視し、以下を確認する:

| ログパターン | 意味 | 対応 |
|---|---|---|
| `LINE notification sent for first plan approval` | 第1案承認通知の送信成功 | 想定通り。件数を Slack で共有 |
| `LINE shift-confirmed notification sent` | シフト確定通知の送信成功 | 想定通り |
| `LINE notification skipped: NOTIFICATION_ENABLED is not "true"` | フラグが `true` になっていない | 環境変数を再確認・Restart |
| `Failed to send LINE notification` | LIFF backend 呼び出しが失敗 | LIFF backend のヘルスチェック → ロールバック判断 |
| `Failed to send shift-confirmed notification` | 同上（CONFIRMED 側） | 同上 |

### 4.2 誤送信・重複送信の検知

- **誤送信**: 想定外のスタッフ・退職者からの「通知が来た」問い合わせが Slack で発生していないか、
  切替後 24 時間は Slack #shift-oncall（または担当チャンネル）を常時監視する。
- **重複送信**: 月次バッチが1日に複数回実行されていないかを GitHub Actions の
  `Monthly First Plan Batch` ワークフロー履歴で確認（cron ずれ・手動再実行の重複）。
  同一店舗で同月内に `created` に2回計上されていた場合はロールバックを検討する
  （冪等性実装により本来は `skipped_already` になるため、`created` が重複するのは異常）。
- **文字化け**: 実際に届いた LINE メッセージのスクリーンショットを1件取得し、絵文字・改行・
  URL が壊れていないかを目視確認する。

### 4.3 LIFF backend 側の監視

LIFF backend の `/api/health` を最低1時間ごとにチェックする
（既存の health-check ワークフローで自動化済み。§ [`health-check-setup.md`](health-check-setup.md) 参照）。

---

## 5. ロールバック手順

**判断基準**: 誤送信 / 重複送信 / LIFF backend の 5xx が連続 / スタッフからのクレームが
複数件、のいずれかが発生した場合は即時ロールバックする。**判断に迷ったら止める**。

### 5.1 即時停止（最も優先度が高い操作・所要 1〜2 分）

1. Railway ダッシュボード → **production environment** → **shift-scheduler-ai** → **Variables**
2. `NOTIFICATION_ENABLED` を `false` に変更
3. サービスを **Restart**（Variables 変更で自動再起動されることが多いが、明示的に実行）
4. `GET {prod_backend}/api/health` が 200 を返すことを確認
5. 停止直後にトリガーを1件発火させ、ログに
   `LINE notification skipped: NOTIFICATION_ENABLED is not "true"` が出ることを確認

### 5.2 事後対応

1. Slack で shift M層 → CEO へ「停止完了」報告（発生時刻・想定影響範囲・原因調査状況）
2. 誤送信を受信したスタッフには、店長経由で手動フォロー
   （「テスト通知でした」等の説明を Slack 定型文で共有）
3. 原因調査:
   - Railway backend ログ（切替から停止までの全ログ）を保存
   - LIFF backend ログを同時刻範囲で照合
   - 対象 Issue にタイムライン・原因・恒久対策を記録
4. 恒久対策を打つまで、`NOTIFICATION_ENABLED=false` を維持する

### 5.3 段階復旧

原因が特定・修正された後、再度 § 2 のチェックリストから通す（1回失敗した以上、
staging smoke test は必ず再実施）。

---

## 6. 恒久無効化を継続する場合

「機能自体が不要になった」と CEO が判断した場合は、環境変数の維持ではなくコードから削除する:

1. `backend/src/routes/shifts.js` の `isLineNotificationEnabled()` と全ての呼び出し箇所を削除
2. `notifyFirstPlanApproved()` ヘルパーと関連テスト（`shifts.plan-status.test.js`・
   `shifts.approve-first.test.js`・`shifts.monthly-first-plan-batch.test.js` の通知セクション）を削除
3. `backend/.env.example` から `NOTIFICATION_ENABLED` の項目を削除
4. `docs/operations/monthly-first-plan-batch.md` / 本ドキュメントを削除または「廃止済み」として保持

削除 PR は staging 検証を通し、CEO 承認のうえマージする。

---

## 変更履歴

| 日付 | 変更 | Issue |
|---|---|---|
| 2026-08-14 | 初版作成 | #244 |
