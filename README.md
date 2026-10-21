# 3D 魔物獵人 Web 原型

這是一個以 Three.js、Blender GLB 資產與原生 Web Audio API 製作的純前端 3D 動作遊戲原型。遊戲執行時不需要 Node.js、npm 或建置工具；主要畫面與遊戲迴圈在 `index.html`，共用規則則由 `src/game-rules.mjs` 提供。Three.js 與 GLTFLoader 由 CDN 載入，角色與魔物資產由 `assets/models/` 提供。

## 目前功能

- 原創生態系奇幻視覺：骨骼與甲殼工藝、自然獵場地表、植被、骨骸遺跡、光照、陰影與霧效。
- Blender 產出的高密度平滑曲面獵人、骨製大劍、甲殼魔物與獵場環境 GLB 模型，並以受控程序位移打破規則球體輪廓；同時保留部位節點供頭部與尾部破壞判定使用。
- Blender 資產內嵌 256×256 程序化顏色、法線與粗糙度紋理；獵場另有中央平整、外圍自然起伏的地形環，並在資產完成載入前鎖定遊戲流程。
- 獵場資產已與實際戰鬥中線對齊，並使用可控的遠景霧保留近景石、倒木與遠景樹群的可見度。
- 載入 GLB 後保留材質、貼圖與金屬／粗糙度資訊；GLB 內含可重複播放的 `HunterIdle` 與 `MonsterIdleSpine` 動畫片段，並依移動、蓄力、龍吼、甩尾與狂暴狀態疊加部件級程序動畫。
- 大劍揮擊拖影、雙劍雙刃蓄力與雙軌刀光、魔物蓄力／甩尾預警圈，以及狂暴狀態的色彩、光暈與程序化提示音。
- 獵人移動、翻滾無敵時間、三段輕攻擊連段、依蓄力時間分級的重斬、回覆藥與砥石。
- 可在畫面按鈕或 `1`／`2` 切換原創大劍與雙劍；兩種武器有不同攻擊速度、耐力消耗、傷害與有效距離。
- 斬味等級與傷害倍率：白斬 `1.32x`、藍斬 `1.20x`、綠斬 `1.05x`、黃斬 `0.85x`。
- 魔物追蹤、龍車、迴旋甩尾、冷卻、倒地硬直，以及依血量門檻觸發的龍吼與限時狂暴。
- 頭部弱點、斷角與斷尾；尾巴被破壞後，甩尾攻擊範圍與傷害會降低。
- 以 Web Audio API 即時合成斬擊、命中、龍吼、蓄力預警、翻滾、治療、研磨、腳步與荒野低頻環境音，並加入短森林空間反射；不使用外部音檔。
- 命中火花、龍吼震波、短暫卡肉、鏡頭震動、傷害數字與勝負結算畫面。
- 目標鎖定與自由視角：鎖定時相機追蹤魔物，未鎖定時可用滑鼠右鍵拖曳旋轉視角。
- 受傷時顯示紅色邊緣警示與攻擊來源方向指示；觸控版提供鎖定魔物按鈕。
- 魔物受擊會短暫閃白並產生身體反應；頭角與尾巴破壞時會追加高密度火花與破壞音效。
- 模型資產改用 Blender 平滑曲面、三段倒角、輪廓化大劍與雙手持握雙劍；獵場包含完整連續地表、遠古巨獸骨骸遺跡、圓潤巨石、倒木、遠景樹群、苔蘚與蕈類環境資產。
- `P` 或畫面上的按鈕可暫停／繼續遊戲；失去視窗焦點時會清除輸入狀態。
- 小螢幕提供觸控方向鍵，以及攻擊、翻滾、蓄力、回復、磨刀與鎖定按鈕。
- `localStorage` 存檔可保存獵人／魔物狀態、部位破壞與外顯同步、龍吼階段、戰鬥位置、視角、目前武器與永久狩獵戰績統計，並提供儲存、讀取與清除操作。

## 操作方式

| 操作按鍵 | 實際動作 |
| :--- | :--- |
| `W` / `A` / `S` / `D` | 依目前相機方向移動獵人 |
| `Space` | 翻滾閃避，消耗耐力並提供短暫無敵時間 |
| `J` / 滑鼠左鍵 | 輕攻擊；在連段窗口內再次輸入可接續三段連斬 |
| `1` / `2` | 切換大劍／雙劍 |
| 按住 `K` 後放開 | 依蓄力等級施放重斬 |
| `E` | 飲用回覆藥，恢復 `45 HP` |
| `R` | 使用砥石，恢復至最高斬味 |
| `P` / 畫面上的「暫停」按鈕 | 暫停或繼續遊戲 |
| `Tab` / `F` | 開關目標鎖定 |
| 滑鼠右鍵拖曳 | 未鎖定時旋轉相機視角 |
| 觸控方向鍵／動作按鈕 | 移動、攻擊、翻滾、蓄力、回復與鎖定 |

## 啟動

建議使用專案內的 PowerShell 啟動器，讓瀏覽器透過本機 HTTP 伺服器載入遊戲：

```powershell
pwsh -NoProfile -File .\mh-3d-web.ps1
```

啟動器預設監聽 `http://localhost:8080/`，並嘗試自動開啟瀏覽器。需要其他連接埠時可使用 `-Port`：

```powershell
pwsh -NoProfile -File .\mh-3d-web.ps1 -Port 5173
```

若只想啟動伺服器而不自動開啟瀏覽器，可加上 `-NoBrowser`。啟動器以 `$PSScriptRoot` 作為服務根目錄，只提供檔案、不建立或覆寫專案檔；按 `Ctrl+C` 可停止伺服器。若環境使用 Windows PowerShell，也可將 `pwsh` 替換為 `powershell`。

## 專案架構

```text
mh-3d-web/
├─ index.html                 # HUD、樣式、Three.js 場景與主要遊戲邏輯
├─ mh-3d-web.ps1              # 唯讀的本機 PowerShell 靜態伺服器啟動器
├─ package.json               # Node.js 檢查與測試命令
├─ src/game-rules.mjs         # 可獨立測試的戰鬥規則函式
├─ src/save-system.mjs        # 可獨立測試的瀏覽器存檔與資料清理
├─ tests/game-rules.test.mjs  # Node 原生測試
├─ assets/models/             # Blender 匯出的 hunter.glb、monster.glb 與 hunting_ground.glb
├─ tools/generate_assets.py   # 以 Blender 背景模式重新產生 GLB 資產
└─ README.md                 # 使用與功能說明
```

`index.html` 內的程式區塊目前依序包含程式化音效、粒子效果、自然獵場、GLB 模型載入、玩家狀態及輸入、魔物 AI、攻擊判定、相機、HUD 與主遊戲迴圈，並以 ES module 匯入 `src/game-rules.mjs`。外部執行期依賴是帶有完整性驗證的 CDN Three.js `r128` 與 GLTFLoader；若無法連線至 CDN，頁面會顯示載入錯誤，3D 遊戲畫面無法初始化。

## Blender 資產

目前的模型是用 Blender Python 腳本程序化產生的原創高密度平滑曲面資產，不依賴外部版權模型；目前仍屬可即時執行的 Web 原型，而非完整商業遊戲等級的人工雕刻與攝影測量資產。若已安裝 Blender，可在專案根目錄執行：

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python tools\generate_assets.py
```

腳本會重新產生 `assets/models/hunter.glb`、`assets/models/monster.glb` 與 `assets/models/hunting_ground.glb`。模型中的 `weaponPivot`、`weapon_blade`、`head`、`tail`、`horn_l` 與 `horn_r` 節點名稱是遊戲互動整合的一部分，修改模型時請保留這些名稱。

## 技術備註

- `mh-3d-web.ps1` 使用 .NET `HttpListener` 綁定 `http://localhost:<Port>/`，提供常見 MIME type（包含 `.mjs` 與 `.glb`），並拒絕路徑穿越與服務根目錄外的路徑。
- `package.json` 要求 Node.js `20` 以上，可用 `npm run check` 檢查模組語法、`npm test` 執行規則測試；修改遊戲邏輯後仍請在瀏覽器中實際操作確認。
