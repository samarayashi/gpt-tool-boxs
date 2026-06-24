# 規格書：ChatGPT 批次工具（批次刪除 + 批次移至專案）

> 狀態：v1（全部讀寫端點皆已用實機請求 + chatgpt.com.har 驗證，API 層無待驗證項，可進入開發）
> 最後更新：2026-06-24

---

## 1. 背景與目標

### 1.1 現況
本專案是一個 Chrome MV3 擴充功能，目前只做一件事：**批次刪除** ChatGPT 最近對話。
流程是：開 popup → 載入最近對話（可 Load All、可關鍵字過濾）→ 勾選 → `Delete Selected` →
對每個對話打 `PATCH /backend-api/conversation/{id}` 設 `is_visible:false`（最多 5 個並行）。

### 1.2 問題
在 ChatGPT 網站上要把多個對話歸類到某個 **Project（專案）**，目前只能一個一個手動移動，很麻煩。
而「勾選一批最近對話、對它們做同一件事」這個互動，跟現有的批次刪除幾乎一樣。

### 1.3 目標
在現有擴充功能上新增「**批次把選取的對話移到某個專案**」的能力，專案可以是
**既有專案**或**當下新建的專案**；同時保留原本的批次刪除。

### 1.4 名詞釐清
- **「批次」**：指一次選取多筆對話、對它們做同一個操作。repo 名 `chatgpt-batch-delete` 即「ChatGPT 批次刪除」。
- **Project / 專案 / Gizmo / Snorlax**：ChatGPT 的 Project 在後端是 `kind = "snorlax"` 的 gizmo。本文件中「專案」「gizmo」可互換。
- **對話 / Conversation**：一則 ChatGPT 對話，唯一識別為 `conversation id`。

---

## 2. 範圍（Scope）

### 2.1 本期要做（In scope）
1. 在 popup 頂部新增**模式切換**：`刪除` ｜ `移至專案`。兩種模式共用同一份對話清單與勾選狀態。
2. `移至專案` 模式：勾選對話 → 選擇目標專案 → 批次移動。
3. 目標專案來源（MVP 即支援兩者）：
   - 從**既有專案清單**挑一個。
   - **新建一個專案**（在擴充功能內輸入名稱建立）後移入。
4. 批次移動沿用既有的「並行佇列 + 進度 + 可取消 + 部分失敗統計」機制。
5. 移動成功的對話，從目前清單移除（與刪除後行為一致，因為移入專案後就不在 root 最近清單）。
6.（追加）**專案 tag**：清單中已屬於某專案的對話（`gizmo_id` 為 `g-p-…`）顯示該專案名稱的小標籤，刪除/移動兩模式皆顯示。專案名由 `fetchProjects` 的 id→name 對照取得（啟動時背景載入）。
7.（追加）**過濾「已在專案內」**：提供「Hide conversations already in a project」勾選，勾選時濾掉 `gizmo_id` 為 `g-p-…` 的對話，避免誤刪或重複移動專案內的內容。

> 依據：root `GET /conversations` 的每筆對話帶 `gizmo_id`（HAR 實測 28 筆中 3 筆非空）。`g-p-…`＝專案（snorlax），`g-<hex>`＝自訂 GPT。僅 `g-p-…` 視為「在專案內」。

### 2.2 本期不做（Out of scope）
- 從專案中「移出」對話、在專案之間搬移、重新命名／刪除專案。
- 編輯專案指示（custom instructions）、上傳檔案到專案。
- 將對話複製（保留一份在 root）；本工具語意是「移動」，不是「複製」。
- 跨 workspace / team 空間的切換 UI（但 API 預留 `ChatGPT-Account-Id` 標頭，見 §6.5）。
- 任何把資料送到第三方伺服器的行為（維持現狀：只跟 chatgpt.com 溝通）。

---

## 3. 使用者流程（User Flows）

### 3.1 主流程：批次移至既有專案
1. 在 chatgpt.com 已登入，點擴充功能圖示開 popup。
2. 自動載入最近對話（沿用現況；可 Load All、可過濾）。
3. 頂部模式切到 `移至專案`。
4. 勾選一個或多個對話（沿用現況的勾選 / 全選 / 過濾）。
5. 點主按鈕 `移至專案…`，跳出**專案選擇器**。
6. 選一個既有專案 → 按 `確認移動`。
7. 顯示進度 `移動中… x/N`，可 `取消`。
8. 完成顯示結果（成功 N、失敗 M、取消與否），成功的對話自動從清單移除。

### 3.2 變體：批次移至新建專案
- 在第 5 步的專案選擇器中選「＋ 新建專案」，輸入名稱 → `建立並移動`。
- 系統先建立專案（§6.3），取得新 `gizmoId`，再走 3.1 的第 7~8 步。
- 若建立成功但移動部分失敗：專案已存在（不回滾），結果訊息要說明「已建立專案，移動 N 成功 / M 失敗」。

### 3.3 既有流程：批次刪除（不變）
- 頂部模式在 `刪除` 時，行為與目前完全相同（含確認 modal、進度、取消）。

---

## 4. UI 規格

### 4.1 版面（popup，寬 420px）
```
┌────────────────────────────────────────┐
│ ChatGPT 批次工具                          │
│ [ 刪除 ][ 移至專案 ]   ← 模式切換 (segmented) │
│ [status bar]                              │
│ ☑ 全選          [Load All] [主要動作按鈕]    │
│ [ 過濾對話… ]                              │
│ ┌──────────────────────────────────────┐ │
│ │ ☐ 對話標題 ........... Jun 1, 2026     │ │
│ │ ☐ ...                                  │ │
│ └──────────────────────────────────────┘ │
│ N loaded / N conversations                │
└────────────────────────────────────────┘
```

### 4.2 模式切換（新增）
- 兩個分段按鈕：`刪除`（預設）、`移至專案`。
- 切換時：**保留**已載入清單、勾選狀態、過濾字串；只改變「主要動作按鈕」與其行為。
- 進行中（刪除中或移動中）時，模式切換**禁用**。

### 4.3 主要動作按鈕（依模式變化）
| 模式 | 未選 | 已選 N | 進行中 |
|------|------|--------|--------|
| 刪除 | `Delete Selected`(disabled) | `Delete Selected (N)` | `Cancel Delete` |
| 移至專案 | `移至專案…`(disabled) | `移至專案… (N)` | `取消移動` |

### 4.4 專案選擇器（新增，modal）
觸發：移至專案模式下、已選 ≥1，點主按鈕。內容：
- 標題：`將 N 個對話移到…`
- 既有專案清單（可捲動、可即時用名稱過濾）。每列：專案名稱（＋可選的對話數，如 API 有提供）。
- 一個固定選項：`＋ 新建專案`，展開後是名稱輸入框（預設值可為空，需非空白才可送出），下方再附 context 模式兩選項：「Shared memory」(`global`，預設) /「Project-only context」(`project_v2`)。
- 動作鈕：`確認移動`（選既有時）／`建立並移動`（新建時）／`取消`。
- 載入專案清單時顯示 loading；清單為空時顯示「尚無專案，請新建一個」。
- 失敗（抓專案清單失敗）顯示錯誤並可重試。

> 確認移動前的二次確認：移動可逆（之後可在 ChatGPT 把對話移回），風險低於刪除，
> 故**不需**像刪除那樣的紅色危險確認；專案選擇器本身的 `確認移動` 即視為確認。

### 4.5 狀態與訊息（沿用 status bar 樣式）
- 進行中：`移動中… x/N`（不自動隱藏，可取消）。
- 成功：`成功移動 N 個對話到「<專案名>」。`
- 部分失敗：`移動完成：成功 N、失敗 M。`（error 樣式）
- 取消：`已取消：成功 N、失敗 M。`（info 樣式）
- 新建專案後：訊息含專案名。

---

## 5. 功能需求（Functional Requirements）

- **FR-1** 模式切換不得清空已載入清單或勾選狀態。
- **FR-2** `移至專案` 模式下，未勾選任何對話時主按鈕禁用。
- **FR-3** 專案選擇器需列出使用者既有專案（名稱），並可在其中過濾。
- **FR-4** 可在選擇器內輸入名稱新建專案；名稱去除前後空白後不可為空。
- **FR-5** 批次移動需並行處理（沿用 `DELETE_CONCURRENCY = 5` 的上限，或為移動另設常數），顯示 `已處理/總數` 進度。
- **FR-6** 移動過程可隨時取消；取消後回報已成功與失敗數。
- **FR-7** 單筆移動失敗不可中斷整批；最後彙總成功 / 失敗數。
- **FR-8** 移動成功的對話即時從目前清單與勾選集合移除。
- **FR-9** 任一 API 回 401/未登入時，顯示「請先登入 ChatGPT」類訊息（沿用 `getAccessToken` 既有錯誤）。
- **FR-10** 新建專案成功後，需用回傳的 gizmoId 進行後續移動；若該專案隨後也要可被選，可選擇刷新專案清單。

---

## 6. API 規格

> 區分兩種可信度：
> ✅ **已驗證**＝多個公開逆向專案一致確認；
> ⚠️ **待驗證**＝公開資料查無，為合理推測，**開發第一步必須用實機 Network 擷取校正**（見 §6.6）。

共通：Base = `https://chatgpt.com/backend-api`，`credentials:'include'`，
標頭 `Authorization: Bearer <accessToken>`（token 來自既有的 `GET /api/auth/session`）。

### 6.1 ✅ 列出既有專案（實機 HAR 驗證）
```
GET /backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0&limit=100
→ {
    "items": [
      {
        "gizmo": {                     // ← 注意：外層還有一層 wrapper
          "gizmo": {                   // ← 真正的專案物件在這層
            "id": "g-p-...",
            "gizmo_type": "snorlax",
            "display": { "name": "專案名", ... },
            ...
          },
          "tools": [], "files": [], "product_features": {...}
        },
        "conversations": { "items": [ ...每專案最近 N 筆... ] }   // conversations_per_gizmo 控制
      }
    ],
    "cursor": null                     // null = 沒有下一頁
  }
```
- **⚠️ 雙層巢狀**：專案 id = `items[].gizmo.gizmo.id`，名稱 = `items[].gizmo.gizmo.display.name`。（逆向文件寫的單層 `items[].gizmo.id` 與實機不符，以此為準。）
- 防禦性過濾 `items[].gizmo.gizmo.gizmo_type === 'snorlax'`（HAR 中 `owned_only=true` 回傳的 8 筆全為 snorlax，自訂 GPT 不在其中）。
- 查詢參數：`owned_only=true&conversations_per_gizmo=0&limit=50`。**`limit` 上限為 50**（`limit=100` 實測回 HTTP 422：`{"detail":[{"loc":["query","limit"],"msg":"Input should be less than or equal to 50"}]}`）。`conversations_per_gizmo=0` 合法（422 未對它報錯），用來略過不需要的對話預覽。
- **分頁**：回應 `cursor` 為 `null` 表示已到底；非 null 時帶 `cursor=<值>` 續抓直到 null。HAR 中 8 個專案 < limit，cursor=null。

### 6.2 ✅ 列出某專案內對話（實機 HAR 驗證；本期非必要，先列備用）
```
GET /backend-api/gizmos/{gizmoId}/conversations?cursor=0
→ { items: [ { id, title, create_time, update_time, gizmo_id, ... } ], cursor }
```
- 採 cursor 分頁（與 root 的 offset 不同）；`cursor=null` 表示已到底。
- 對話物件結構與 root `/conversations` 的 items 相同（含 `id`/`title`/`update_time`/`gizmo_id`）。
- 本期不需要，但若日後要顯示「專案已有幾則」會用到。

### 6.3 ✅ 新建專案（實機驗證，含回應結構）
```
POST /backend-api/projects
headers: { Authorization: Bearer …, Content-Type: application/json }
body: { "instructions": "", "name": "<專案名>", "memory_scope": "global" }
→ 200, 回應結構：
  {
    "resource": {
      "gizmo": {
        "id": "g-p-...",              // ← 新專案 id，作為 §6.4 的 gizmo_id
        "gizmo_type": "snorlax",
        "display": { "name": "<專案名>", ... },
        "memory_scope": "global",
        "memory_enabled": true,
        ...
      },
      "tools": [], "files": [], ...
    },
    "error": null
  }
```
- **取新專案 id 的路徑：`resource.gizmo.id`**（名稱在 `resource.gizmo.display.name`）。
- `instructions`：專案自訂指示，新建時傳空字串即可。
- `memory_scope`（實機確認三值行為）：
  - `"global"` 或 `"unset"` → 回應 `memory_scope:"global"`, `memory_enabled:true`（與全域記憶共用，網站「新建專案」預設）。
  - `"project_v2"` → 回應 `memory_scope:"project_v2"`, `memory_enabled:false`（專案獨立 context）。
  - **已開放讓使用者選**：新建表單提供兩個選項 — 「Shared memory」→ `"global"`（預設）、「Project-only context」→ `"project_v2"`。由 `createProject(token, name, memoryScope)` 帶入。

### 6.4 ✅ 把對話移入專案（實機驗證 — 與刪除同端點）
```
PATCH /backend-api/conversation/{conversationId}
headers: { Authorization: Bearer …, Content-Type: application/json }
body: { "gizmo_id": "g-p-..." }
→ { "success": true }
```
- **與既有刪除 (`{ "is_visible": false }`) 是同一個端點、同一種 PATCH**，只差 body 欄位 → 可與 `deleteConversation` 共用底層 `patchConversation()`，風險極低。
- 回應為 `{"success":true}`（實機確認兩次）。
- 移出專案（歸回 root）為同端點 `body: { "gizmo_id": "" }`（空字串）。本期 out of scope，僅記錄供未來「移出」功能使用。
- 實機請求另帶了 `oai-device-id` / `oai-client-version` / `oai-session-id` / `x-openai-target-*` 等標頭，但既有刪除打同端點時並未帶這些也能成功，故判定**非必要**；實作沿用刪除的最小標頭組，若遇 4xx 再逐一補上。

### 6.5 標頭：團隊 / workspace
- 若使用者在 team 空間，部分請求需要 `ChatGPT-Account-Id: <workspaceId>`。MVP 假設個人空間；§9 列為待確認。

### 6.6 ✅ 已擷取的實機請求（v1 依據）
- 新建專案（預設全域）：`POST /projects`，body `{"instructions":"","name":"...","memory_scope":"global"}`（送 `"unset"` 結果同樣回 `global`）→ 回應 `resource.gizmo.id` + `memory_enabled:true`。
- 新建專案（專案獨立）：`POST /projects`，body `{... "memory_scope":"project_v2"}` → 回應 `memory_scope:"project_v2"`, `memory_enabled:false`。
- 移入專案：`PATCH /conversation/{id}`，body `{"gizmo_id":"g-p-..."}` → `{"success":true}`。
- 移出專案（附帶）：`PATCH /conversation/{id}`，body `{"gizmo_id":""}`。

列出專案（由 `chatgpt.com.har`，90 筆請求的瀏覽 session 驗證）：
- `GET /gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=5&limit=20` → `{items:[…], cursor:null}`，8 筆全為 snorlax 專案；id 在 `items[].gizmo.gizmo.id`（見 §6.1）。
- 同 HAR 另確認：`GET /gizmos/{id}/conversations?cursor=0`、`GET /gizmos/{id}`（專案詳情）、root `GET /conversations?offset=0&limit=28&order=updated&is_archived=false&is_starred=false`（比現有擴充多帶 `is_archived`/`is_starred`，但非必要）。

✅ **API 層已無待驗證項**，可全面進入開發。

---

## 7. 技術設計（對應現有檔案）

### 7.1 既有架構（沿用）
- `chatgpt-api.js`：API 封裝（`getAccessToken`, `fetchConversations`, `deleteConversation`）。
- `delete-queue.js`：並行佇列（5 worker、可取消、回報進度與成敗）。
- `popup.js`：狀態機與事件繫結；`popup-view.js`：DOM 渲染；`popup.html` / `popup.css`：UI。

### 7.2 預計改動
- **`chatgpt-api.js`** 新增：
  - `fetchProjects(token)` → §6.1：`GET /gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0&limit=100`，解析 `items[].gizmo.gizmo.{id, display.name}`，過濾 `gizmo_type==='snorlax'`，若 `cursor` 非 null 則續抓。
  - `createProject(token, name, memoryScope='global')` → §6.3：`POST /projects`，body `{instructions:'', name, memory_scope}`，回傳取 `resource.gizmo.id`。
  - `moveConversationToProject(token, conversationId, gizmoId, {signal})` → §6.4：`PATCH /conversation/{id}`，body `{gizmo_id}`。
  - 重構：把現有 `deleteConversation` 與新 `moveConversationToProject` 共用一個 `patchConversation(token, id, patch, {signal})`（刪除傳 `{is_visible:false}`、移動傳 `{gizmo_id}`），因兩者是同一端點。
- **`delete-queue.js` → 泛化**為 `task-queue.js`：把 `deleteWithQueue` 抽成通用
  `runWithQueue({ ids, worker, signal, onProgress })`，刪除與移動各傳入自己的 `worker`。
  （或新增 `moveWithQueue`，但泛化較不重複。）
- **`popup.js`**：`state` 增加 `mode: 'delete' | 'move'`、`projects`、`isMoving`、`moveAbortController`、
  `selectedProjectId`；新增 `performMove()`、`loadProjects()`、`handleModeSwitch()`。
- **`popup-view.js`**：新增模式切換渲染、主按鈕依模式變文案、專案選擇器 modal 的顯示/隱藏/填表。
- **`popup.html` / `popup.css`**：加模式切換 segmented control、專案選擇器 modal 結構與樣式。
- **`manifest.json`**：名稱與描述可改為「ChatGPT 批次工具 / Batch delete & move to project」（§9 待你定）。host/permission 不變。

### 7.3 並行與節流
- 沿用 5 並行；若實測移動 API 較易被限流，將移動的並行數下調（例如 3）並在 §9 記錄實測值。
- 沿用 `Load All` 之間的 700ms 間隔策略精神。

---

## 8. 非功能需求

- **隱私**：維持現狀——只與 chatgpt.com 溝通，token 僅存記憶體，不寫 storage、不外傳。
- **權限**：`manifest.json` 既有 `host_permissions: https://chatgpt.com/*` 已足夠，無需新增。
- **錯誤處理**：所有新 API 比照既有 `fetchJson` 帶 `errorMessage` 與 HTTP 狀態。
- **可取消**：移動佇列吃 `AbortController`，與刪除一致。
- **無破壞性誤觸**：移動模式的主按鈕在未選時禁用；新建專案需有效名稱。

---

## 9. 開放問題 / 待你確認

1. ✅ ~~§6.3 / §6.4 endpoint 與 payload~~ — 已確認（新建 `POST /projects`、移動 `PATCH /conversation/{id}`+`gizmo_id`）。
2. ✅ ~~新建專案回應取 id 的欄位路徑~~ — 已確認為 `resource.gizmo.id`。
3. ✅ ~~列出專案的端點與結構~~ — 已由 HAR 確認 `GET /gizmos/snorlax/sidebar`，id 在 `items[].gizmo.gizmo.id`（§6.1）。
4. ✅ ~~專案清單分頁~~ — 用回應 `cursor`（null = 到底）續抓即可。
5. **團隊空間**：是否需要支援？需要的話要處理 `ChatGPT-Account-Id`。（HAR 為個人空間，`workspace_id:null`。）預設：MVP 不支援。
6. **移動並行數**：沿用 5 或調低？（待實測限流。）預設：沿用 5。
7. ✅ ~~`memory_scope`~~ — 已決定**開放選擇**：新建表單兩選項「Shared memory」(`global`，預設) / 「Project-only context」(`project_v2`)。
8. **擴充功能改名**：是否將名稱／描述改為「批次工具」？
9. **新建專案後**是否要自動刷新專案清單（讓新專案出現在選擇器）？預設：是。
10. **移動後是否仍出現在 root 清單**：理論上移入專案後該對話會帶 `gizmo_id` 並從 root `/conversations` 消失；Phase 2 實測確認（風險低，與刪除後移除清單的處理一致）。

---

## 10. 驗收條件（Acceptance Criteria）

- [ ] 模式可在 `刪除` / `移至專案` 間切換，且清單與勾選不被清空。
- [ ] `刪除` 模式行為與現況完全一致（迴歸不破壞）。
- [ ] `移至專案` 模式可列出既有專案並過濾。
- [ ] 可選既有專案，批次移動 N 個對話，顯示進度、可取消、回報成敗。
- [ ] 可輸入名稱新建專案並把選取對話移入。
- [ ] 移動成功的對話即時從清單移除。
- [ ] 未登入 / 401 有清楚錯誤訊息。
- [ ] 不對 chatgpt.com 以外發出任何請求。

---

## 11. 開發里程碑（依規格分階段）

- **Phase 0 — API spike**：✅ 完成。新建 / 移入 / 列表全部端點與回應結構皆已由實機請求 + `chatgpt.com.har` 驗證，無待確認項。
- **Phase 1 — 共用層**：✅ 完成。`delete-queue.js` → `task-queue.js`（`runWithQueue`）；`chatgpt-api.js` 加 `fetchProjects` / `createProject` / `moveConversationToProject`，刪除/移動共用 `patchConversation`。以真實 HAR + stub 測試驗證解析與請求 body。
- **Phase 2 — UI**：✅ 完成。模式切換、專案選擇器、移動流程、進度/取消/結果訊息。
- **Phase 3 — 新建專案**：✅ 完成。選擇器內輸入名稱 → `createProject` → 移入。
- **Phase 4 — 收尾**：✅ 程式完成（README、manifest 改名 v1.1.0）。**待人工**：在 Chrome `Load unpacked` 對真實帳號點測完整流程（驗收條件 §10）。
