# 模擬庭提問陪伴台帳 (Debate Companion Desk)

專為國際法模擬法庭（Moot Court）研究員與教練打造之 Windows 桌面端陪伴練習助手。深度適配 Microsoft Surface Pro 等 Windows 觸控平板，完全繼承本站傳統墨色、胡粉、朱色系美學與無邊框（Frameless）客製化視窗設計。

---

## 核心功能特色

### 1. 即時口說稿對照與爭點架構圖 (Roadmap DAG)
- **語音辨識即時同步**：即時比對辯士口說與英文口說稿（`OralUnit`），以單詞與句子層級高亮目前朗讀進度。
- **立體架構圖導引**：以 DAG 樹狀圖動態展示爭點階段（開場陳述、管轄權、實質論點、各爭點要件、結論訴之聲明），隨朗讀進度即時呼吸高亮，研究員一目了然辯士目前進度與剩餘論點。
- **智慧提問時機點提示**：當辯士論及國家實質控制、自衛權迫切性、目標區分與比例原則等核心爭點時，系統立即提示最佳提問時機點。

### 2. 研究員發音朗讀小幫手 (TTS Pronunciation Drill)
- **法官標準語音示範**：一鍵聆聽法官標準英文朗讀，支援 0.8x 慢速、1.0x 標準、1.2x 實戰語速切換。
- **拉丁法學專有名詞讀音解析**：內建 *opinio juris*, *jus cogens*, *chapeau*, *ratione materiae*, *mens rea*, *ultra vires* 等發音音標與發音提示，解決研究員「想問卻不知道怎麼念」的痛點。

### 3. 動態即時追問與隨念隨摘中文摘要
- **AI 動態追問生成**：即時辨識辯士脫稿回答的關鍵漏洞，動態生成高法理精確度之追問（Follow-up question）。
- **隨念隨摘即時中文摘要**：隨辯士口說流動即時萃取簡短中文摘要條列，即時掌握英文辯論的核心脈絡。

### 4. 智慧計時器與模擬庭響鈴規則
- **語音感應自動起計**：自動偵測練習開始並依正式比賽規則計時。
- **法庭響鈴機制**：殘餘 2 分鐘自動敲響預備單鈴，時間截止敲響時間到雙鈴（以 Web Audio 合成自然銅鈴聲學共鳴）。

### 5. 智慧錄音與老師講評獨立切分
- **離線優先本機快取**：錄音安全儲存於本機，離線隊列自動重試同步至雲端（Supabase `debate-audio` 儲存槽）。
- **老師講評自動辨識切分**：自動識別練習結束後之教練與裁判講評（「老師講評」、「評語」、「feedback」），獨立切為獨立音檔與紀錄進行雲端備份。

### 6. 雙形態視窗與 Surface 觸控深度支援
- **雙模式自由切換**：
  - **懸浮球微型視窗 (Floating Ball)**：縮小為桌面邊緣懸浮球，呈現 REC 錄音中與計時狀態，支援觸控展開環形快捷功能。
  - **即時吐出小視窗 (Popout HUD)**：當提問契機點出現時自動吐出，設有倒數進度條，超時或失去焦點自動收回；碰觸或游標停留時自動暫停倒數。
  - **全螢幕設定面板**：支援研究員依當日專注需求，自選開啟/關閉架構圖、口說追蹤、摘要串流或發音小幫手。
- **Surface 觸控手勢**：
  - 左滑／右滑：切換爭點節點與簡扁方立場。
  - 下滑：快速收回即時提問小視窗。
  - 長按：呼叫 360 度觸控快捷操作環。
  - 44px+ 觸控目標標準與觸控漣漪反饋。

### 7. 網頁全身驗證連通 (Web Handoff)
- 支援本機超輕量 HTTP 橋接伺服器 (`http://127.0.0.1:48231`)。
- 支援 Windows 自訂通訊協定 `debate-companion://auth?token=...`。

---

## 模組化 MVC 架構設計

```
src/
├── models/                     # 資料模型與核心狀態
│   ├── ArgumentRoadmapModel.ts # 爭點架構圖 DAG 狀態機
│   ├── AuthModel.ts            # 認證與工作階段
│   ├── ContextEngineModel.ts   # 簡方/扁方、書狀與賽題脈絡引擎
│   ├── DebateModel.ts          # 口說稿與題庫資料集
│   ├── QuestionBankModel.ts    # 智慧題目推薦與隨念隨摘中文摘要
│   ├── RecordingModel.ts       # 錄音分段與講評自動切分模型
│   └── SettingsModel.ts        # 介面開關與規則設定
├── controllers/                # 邏輯控制與協同器
│   ├── AlignmentController.ts  # 口說稿字句對照與提問熱點判定
│   ├── AudioRecordingController.ts # 錄音與講評關鍵字監聽
│   ├── BridgeController.ts     # 網頁端 SSO 橋接器
│   ├── DebatePracticeController.ts # 總控調度核心
│   ├── SpeechRecognitionController.ts # 語音辨識串流
│   ├── TimerController.ts      # 模擬庭計時與銅鈴合成
│   └── TTSController.ts        # 語音示範與拉丁讀音指南
└── views/                      # 視圖呈現
    ├── AppView.ts              # 視圖組合與手勢管理器
    ├── CustomTitleBarView.ts   # 客製化無框視窗選單與控制列
    ├── FloatingBallView.ts     # 懸浮球小幫手
    ├── PopoutHudView.ts        # 即時吐出小視窗
    ├── QuestionPrompterView.ts # 提問與追問提示卡片
    ├── RoadmapView.ts          # 爭點架構圖視覺化
    ├── ScriptAlignmentView.ts  # 口說對照與隨念隨摘串流
    ├── SettingsView.ts         # 全螢幕偏好自選面板
    └── TouchGestureManager.ts  # Surface 平板手勢監聽
```

---

## 安裝程式、熱更新與 CI/CD

- **原生 C# WPF 安裝精靈 (`installer/InstallerApp.cs`)**：
  - 透過 Windows 內建 `.NET Framework 4.0 csc.exe` 編譯，無須額外安裝編譯環境。
  - 自動寫入 Windows 協定註冊表、新增/移除程式清單與桌面捷徑。
- **線上自動更新 (`installer/UpdaterApp.cs`)**：
  - 啟動時自動比對 GitHub Releases `latest.json`，校驗 SHA256 完整性並執行就地更新。
- **乾淨解除安裝 (`installer/UninstallerApp.cs`)**：
  - 乾淨清除登錄檔與系統捷徑。
- **GitHub Actions 自動化打包 (`.github/workflows/release.yml`)**：
  - 推送 Tag 時由雲端 Windows Runner 自動執行全量測試、TypeScript 打包與 Setup 安裝檔產出，並直接發布 GitHub Release。

---

## 研究流程與資料來源（目前版本）

介面依研究員的工作順序排列：**研究台（總覽）→ 開庭（即時陪練）→ 準備 → 練習 → 檢討**。

- **研究台**：下一場賽程，以及五個階段的實際進度（對方書狀、口說段數、法官題數、模擬庭問答、待同步紀錄）。
- **開庭**：即時陪練。口說同步、爭點架構圖、提問時機提示、計時響鈴、錄音與老師講評切分。錄音會依段落切檔，逐段上傳到網站的紀錄庫。
- **準備 / 練習 / 檢討**：網站辯論練習模組的各分頁（對戰準備、題庫稿件、口說教練、單題攻防、模擬庭、練習紀錄），與網站使用同一份程式與同一套資料。

### 登入與題庫只有一個來源

- 授權流程不變：桌面端開啟網站 → 網站授權 → 透過 `debate-companion://auth` 交回桌面端。交回的內容另外包含 Supabase 的 access / refresh token，桌面端用它還原同一個登入狀態。
- 題庫即網站的共用題庫（`src/web/lib/debateStorage.ts`）：有雲端題庫就使用雲端版本；尚未取得時顯示內建示範案例，並標示為示範、不會寫回雲端。
- 桌面端與網站模組共用同一組資料型別（`src/types` 由 `src/web/lib` 重新匯出）。

### 已知限制

- Google 登入需要網頁跳轉，在桌面端只能透過網站授權交接完成；桌面端內建的登入表單目前只支援帳號密碼與通行碼。
- 語音辨識的本機 Whisper 與離線語音合成（Kokoro）屬於語音功能，保留在本機。
- AI 評審只有 Claude 雲端與離線規則引擎；不包含本機大型語言模型。
