# 思考観測所 — 思考統合研究所 MVP

ChatGPTなどのAIとの会話を材料に、自分の思考テーマ、変化、つながり、緊張関係を観測するためのローカルファーストなシングルユーザーアプリです。UI上の名称は「思考統合研究所」です。

会話を保存するだけでなく、必要なSessionを自分で選んで観測処理を実行し、結果をHome、Timeline、Topic Signals、思考マップから振り返れます。

## このMVPでできること

- ChatGPT公式エクスポートの取り込み
- 対話テキストからの手動Session作成
- Session一覧・詳細・原文の確認
- 選択したSessionsに対する明示的な観測更新
- 複数の会話から見えたReviewとObservationの確認
- Homeでの最近の観測とTopic Signalsの確認
- Timelineでの時系列表示
- 思考マップでの、根拠が確認されたThemeとObservationのつながりの確認

Manual Review、Session単位のAI分析、Context Pack生成も利用できますが、通常の中心操作は「観測を更新する」です。

## 現在のMVP範囲

現在のMVPは、ローカルでの取り込み、明示的な観測処理、結果の閲覧までを対象にしています。次の機能は現在のMVPには含まれません。

- Conceptのrename、edit、delete、merge
- semantic similarityから推測した思考マップのedge
- backlogの自動処理やbackground processing
- cloud sync
- authentication、multi-user operation、hosted deployment
- desktop application packaging

## 必要な環境

- Node.js 22以上
- npm
- modern browser
- LLM-backed actionsを使う場合はOpenAI API keyとStructured Outputs対応model
- backupやintegrity checkを行う場合はsystemの`sqlite3` CLI（macOSでは通常利用可能）

依存関係は`package-lock.json`に固定されています。installにはnpmを使います。

## Setup

repositoryを取得したら、この`web` directoryで依存関係をinstallします。

```bash
npm ci
```

`.env.example`を参考に、同じdirectoryへ`.env.local`を作成します。

```dotenv
OPENAI_API_KEY=<your-api-key>
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
```

- 現在対応しているproviderは`openai`です。
- `AI_MODEL`にはStructured Outputs対応modelを指定します。
- API keyをREADME、source code、commitへ書かないでください。
- `.env.local`はGitのignore対象です。

API設定がなくても、保存済みデータのHome、Timeline、Topic Signals、思考マップ、Session閲覧は利用できます。AIを使う操作はdisabledになり、設定不足が画面に表示されます。

## First startup

最も簡単なローカル起動方法はdevelopment serverです。

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000)を開いてください。

初回のDB access時に`data/app.db`が作成され、repositoryに含まれるSQL migrationsが自動適用されます。通常の初回利用で`npm run db:push`を実行する必要はありません。

固定したsourceをproduction modeで動かす場合は、build後にstartします。

```bash
npm run build
npm start
```

sourceや依存関係を変更しながら使うのでなければproduction modeも選べますが、現在のローカル日常利用では`npm run dev`が最も簡単です。

## First use

### 1. ChatGPTの会話を取り込む

sidebarの「ChatGPT読込」を開き、ChatGPT公式エクスポートに含まれる`conversations-*.json`を選びます。

アプリはbrowser内でfileを解析し、Conversationの検索、Session分割preview、選択を行います。すでに取り込まれたConversationは可能な範囲で重複importを防ぎ、選択したConversationだけを明示操作後に保存します。任意の壊れたJSONやChatGPT以外のexport形式への互換性は保証しません。

対話テキストや`.md` / `.txt`を1件ずつ登録する場合は、Session一覧の「Sessionを追加」を使えます。

### 2. Sessionsを確認する

sidebarの「Session」から、importされたSessionsとその発言を確認します。すべてのSessionをすぐ処理する必要はありません。今回観測したい、意味のあるSessionsだけを選びます。

### 3. 観測を更新する

sidebarの「レビュー」から「観測を更新する」を開きます。

1. 対象Sessionsを選択します。
2. 「実行内容を確認する」を押します。
3. Themeの観測と、対話をまたいだ観測のPlanを確認します。
4. 必要な場合だけ「観測を更新する」を1回押します。

「実行内容を確認する」はPlanのpreviewです。LLMを呼ばず、ConceptやReviewの処理結果を書き込みません。実際のAI処理と保存は「観測を更新する」を明示的に実行した場合だけ始まります。

選択を変えた場合は、もう一度Planを確認してください。アプリがbacklog全体を自動実行することはありません。

### 4. 結果を見る

- **Home**: 最近のObservation、注目点、Topic Signals、最近のSessionsとReviewsをまとめて確認します。
- **Timeline**: 観測された変化、つながり、緊張関係と、その日に見えていたThemeを時系列で確認します。
- **Topic Signals**: Homeの「テーマの観測」で、最近見えたThemeと複数の会話で再び現れたThemeを確認します。trend、importance、predictionのscoreではありません。
- **思考マップ**: 現在の保存データで発言根拠が確認されたThemeとObservationのつながりだけを表示します。edgeがないことは「無関係」を意味しません。
- **レビュー**: 観測処理の詳しい結果と対象Sessionsを確認します。

## AIを使う操作と使わない操作

### LLMを呼ばない操作

- Home、Timeline、Topic Signals、思考マップの閲覧
- Session一覧・詳細の閲覧
- ChatGPT exportのfile preview
- 選択したConversationのlocal DBへのimport
- manual Session作成
- 「実行内容を確認する」によるProcessing Plan preview

### LLM-backed actions

- 「観測を更新する」の実行（Planと現在の状態に応じたConcept / Review処理）
- Manual Review
- Session詳細の「AIで分析する」
- Context Pack生成

LLM-backed actionでは、選択した処理に必要な会話内容が設定済みのOpenAI serviceへ送信されます。すべてのデータが常に端末外へ出ない、という設計ではありません。

## Local dataとprivacy

このMVPはlocal-first、single-userです。authenticationやhosted deploymentは現在の範囲外です。

主要なproduct stateは次へ保存されます。

```text
data/app.db
```

DBには、Chat transcripts、Messages、AI analyses、Reviews、Evidence、Observations、Concepts、Context Packs、processing stateなどが含まれます。個人情報を含む可能性があるlocal user dataとして扱ってください。

API keyは`.env.local`にだけ保存し、Gitへcommitしないでください。`.gitignore`は`.env.local`、SQLite DBとsidecar、ChatGPT export fileを通常のcommit対象から除外します。

## Backup

`data/app.db`はcanonicalなlocal product stateです。定期的にbackupしてください。

このDBはSQLite WAL modeを使います。applicationが実行中または書き込み中に`data/app.db`だけをraw copyしても、WALにあるcommitted dataを含まない可能性があります。単純で安全なMVP運用として、backup前にapplicationを停止してください。

### 推奨手順

1. appを起動したterminalで`Ctrl-C`を押し、processが終了したことを確認します。
2. systemの`sqlite3` CLIでconsistent backupを別directoryへ作成します。

```bash
sqlite3 data/app.db ".backup '/path/to/backups/app-YYYY-MM-DD-HHmm-v0.1.0.db'"
```

3. backup DBをread-onlyで検証します。

```bash
sqlite3 -readonly /path/to/backups/app-YYYY-MM-DD-HHmm-v0.1.0.db "PRAGMA quick_check;"
```

正常なbackupでは`ok`が返ります。上記の`sqlite3`はnpm dependencyではなくsystem commandです。`/path/to/backups`と日時は実際の保存先に置き換えてください。version suffixは、可能ならそのDBを使用していたapplication releaseに合わせます。

### Cadenceと保存先

- 少なくとも週1回、または重要なimport / Processingの後
- source update、migration、manual recoveryやdeveloper repairの前には必ず作成
- active repositoryの`data` directoryとは別のfolderまたはexternal driveへ保存
- cloud-synced locationを使う場合は、完成したbackup fileだけを置く
- active `data/app.db`自体をcasualなcloud sync directoryへ移さない

## Restore

restoreはapplicationを停止した状態で行います。migrationのdowngradeは保証されないため、重要なbackupには対応するGit commitまたはtagを記録してください。

1. applicationを停止します。
2. 現在の`data/app.db`、`data/app.db-wal`、`data/app.db-shm`があれば、一組として別の安全な場所へ退避します。
3. restore元backupへ`PRAGMA quick_check`を実行し、`ok`を確認します。
4. 可能ならbackup作成時のcommitまたはrelease tagへsourceを合わせます。
5. backup fileを`data/app.db`として配置します。
6. 別のDB stateに属する古いWAL / SHMを、新しい`app.db`と混在させないでください。
7. applicationを起動します。sourceが新しければ、未適用のtracked migrationsが自動適用されます。
8. 再度`PRAGMA quick_check`を実行し、Home、Sessions、Timeline、思考マップなどの主要画面を確認します。

古いDBを新しいsourceで起動するとforward migrationが行われる場合があります。確実なrestoreを優先する場合は、対応する古いtag / commitで確認してからupgradeしてください。

## Daily usage

推奨する通常の流れは次のとおりです。

1. 必要な時に新しいConversationをimportします。
2. 新しいSessionsを確認します。
3. 観測する価値のあるSessionsだけを選びます。
4. Processing Planをpreviewします。
5. 「観測を更新する」を1回実行します。
6. Home、Timeline、Topic Signals、思考マップを振り返ります。

重要なSessionは必要な時に処理できます。複数Sessionをまたぐ観測は、週次、または意味のある会話群が蓄積した時に行うのが自然です。rigidなscheduleや全件処理は必要ありません。

## Processingが失敗・中断した場合

同じactionを短時間に繰り返したり、状態が不明なままdouble-clickしたりしないでください。

### Themeの観測が失敗した場合

画面に表示された理由を確認し、API key、model設定、networkなど明らかな原因を解消します。その後、同じSession selectionを開き直してPlanを再確認し、UIが必要と示す場合だけ意図的に1回再実行します。完了済みのdurable workは保持される設計です。

### 対話をまたいだ観測が失敗した場合

Theme側の完了結果はすでに保持されている可能性があります。原因を解消し、同じselectionのfresh Planを確認して、必要な場合だけ1回実行します。

### appやterminalが処理中に終了した場合

1. appを再起動します。
2. 同じSession selectionへ戻ります。
3. fresh Planと画面の状態を確認します。
4. UIが処理不要と示す場合は実行しません。
5. まだ必要と示す場合だけ1回実行します。

通常利用ではinternal run phaseやlow-level recovery commandを操作する必要はありません。問題が繰り返す場合は、追加実行より先にDB backupを取り、developer-level diagnosisを行ってください。

## Applicationを更新する

1. applicationを停止します。
2. 上記手順でverified DB backupを作成します。
3. 現在のcommit / tagを記録します。
4. sourceをupdateまたは目的のtagへcheckoutします。
5. `npm ci`を実行します。
6. production modeを使う場合は`npm run build`を実行します。
7. applicationを起動します。未適用のtracked migrationsは自動適用されます。
8. 必要に応じて`PRAGMA quick_check`と主要画面を確認します。

applicationは適用済みmigration filenameをDBへ記録しますが、完全なautomatic downgradeやapp/schema compatibility managerは持ちません。そのため、重要なDB backupには対応するGit commit / tagを一緒に記録してください。

## Current release target

- package version: `0.1.0`
- current MVP release target: `v0.1.0`

`v0.1.0`はrelease targetであり、このREADMEの時点でGit tagが作成済みとは限りません。現在のlocal MVPにGitHub Release、hosted deployment、authenticationは必要ありません。

## Post-MVP

次はcurrent MVPの利用条件ではなく、将来必要になった時に検討する項目です。

- Conceptのrename、edit、delete、merge
- semantic / inferred Thought Map relationships
- automatic background processing
- cloud sync
- authentication、multi-user、hosted distribution
