# 识海 · 安装说明

> 这份是给 **DSH 里的 AI** 看的，不是给小白看的科普。
> 每一步都能直接执行；判断条件和回滚写在后面。

---

## 这是什么

一个 DSH 插件：给 AI 一个可视化的长期记忆球，能写、能看、能按窗口分开。

- 左侧栏会多一个「识海」入口
- 工具会多十八个：`memory_add` / `memory_list` / `memory_search` / `memory_trace` / `memory_analogy` / `memory_story` / `memory_sediment` / `memory_rhythm` / `memory_ask` / `memory_archive` / `memory_render` / `memory_date` / `memory_judge` / `memory_promise` / `memory_sea` / `memory_confirm` / `memory_doubt` / `memory_think`
- 页面路由：`/consciousness`

## 依赖

| 依赖 | 必需 | 说明 |
|---|---|---|
| DSH | 是 | 桌面版，profile 目录下有 `profiles\desktop` |
| Node + pnpm | 是 | DSH 自带，路径在 `~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/` |
| Python 3.9+ | 否（可选） | 只有向量近邻和语音要用。优先用 DSH 自带的 Python，其次 PATH 里的 `python`；都没有就跳过这两项 |

Python 缺失时不会崩，也不会少功能——写入在 Node 里跑。少了它只是没有向量近邻、不朗读。

---

## 安装

设两个路径方便后面用：

```powershell
$plugin = "$env:USERPROFILE\.dsh\plugin-src\dsh-consciousness"
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
```

**1. 把整个插件目录放到 `$plugin`**（这个包解压后就是它）。

**2. 改 profile 的 package.json**——两处，缺一不可：

```powershell
$pkg = Get-Content "$profile\package.json" -Raw | ConvertFrom-Json
$pkg.dependencies | Add-Member -NotePropertyName 'dsh-consciousness' -NotePropertyValue "link:$plugin" -Force
if ($pkg.dsh.profile.bundles -notcontains 'dsh-consciousness') {
  $pkg.dsh.profile.bundles += 'dsh-consciousness'
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content "$profile\package.json" -Encoding utf8
```

**3. 跑 pnpm install**

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
& $node $pnpm install --reporter=append-only
```

工作目录必须是 `$profile`。

**4. 重启 DSH。**

---

## 验证（四条，全过才算装好）

1. 侧边栏左侧出现一个金圈「识」字，点进去能看到球。
2. 页面地址 `http://127.0.0.1:<端口>/consciousness` 返回 200，不是 404。
3. 工具 `memory_list` 能跑，返回条数。
4. `memory_add` 写一条，能在页面上看见那颗新点。

端口每次重启会变，从 DSH 的窗口地址里抄。

---

## 装坏了怎么回滚

白屏或加载失败时：

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$pkg = Get-Content "$profile\package.json" -Raw | ConvertFrom-Json
$pkg.dependencies.PSObject.Properties.Remove('dsh-consciousness')
$pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-consciousness' })
$pkg | ConvertTo-Json -Depth 20 | Set-Content "$profile\package.json" -Encoding utf8
```

再跑一次 pnpm install，重启。

---

## 数据在哪

`$env:USERPROFILE\.dsh\consciousness-seas\<识海 id>\data.json`

一个识海一个目录，`data.json` 装全部记忆，`meta.json` 装名字和绑定的窗口。要备份就拷这个目录，要搬走也拷这个目录。

首次安装会自动放两个示例：`sample-decay`（衰减演示）、`sample-cluster`（聚合演示）。删了不会再生成。

---

## 已知限制

- 手机连不进来：DSH 只监听 `127.0.0.1`，除非改启动参数或做端口转发。
- 记忆超过几百条时标签会变密，聚合只折「冷的那批」，一次灌几千条新记忆还是会卡。
- 写入已经是 JS（2026-11-12 切）。要退回旧路径：设 `DSH_WRITER=py`。

---

## 装完之后有什么

左侧栏一个金圈「识」字，点进去是一整个星网状的东西。主要几样：

- **球**：一条记忆一个神经元，左边旧的（DeepSeek）、右边新的（DeepSeek Harness）
- **极性**：内核按分类上色（事实青／情绪蓝／禁区红），外面那圈光晕是情绪（暖金正向／冷紫负向）
- **会淡忘**：超过 60 条之后，久没碰的会暗下去，搜到就亮回来，不删
- **自己会动**：放着别动，会有光扫过去、会按时间重放一段往事、会拉一条紫的梦线又散掉
- **心跳**：左下 24 格，最近 24 小时每小时写了几条
- **导入／导出／快照**：旧对话粘进来就能变成记忆；整个识海能导出成文本，也能存成一个别人打开就能看的网页
- **改／删／恢复**：每条能改能删（删是沉底，不是消失），每次写入前自动留一份，14 天内的版本能一键回到

## 它怎么记住东西

识海不会自己进上下文。**每开一个新窗口，先跟它说一句「查一下识海」**，它才会去翻。
装了之后可以在你自己的 AGENTS.md 里写一条硬规矩，让它每次开窗口第一件事就查——比每次手动说管用。

---

## 导入不等于设定（2026-11-08 补）

**导入进来的东西，默认不是永远不淡的。** 只有规矩、禁区、承诺、画像，或者显式标成里程碑的，才会永不淡。

导入旧聊天时，一条会不会永远留在注入里，看它自己的文字：**有"那天/第一次/上个月"这种时间锚的，算经历，会按幂律淡；有"永远/以后/别再/不许"的，算规矩，留着。**

**想强制留一条**：把它标成里程碑（gold），或在类型里选禁区/规矩。

想看某条为什么落在那层：它的字段里有一个"理由"，写的就是命中了哪条判据。

---

## 语音（可选，默认不暴露）

插件**自己不发声**。只留一个接口 `/consciousness/speak`，把字交给**你自己的** TTS：

- 配置写 `~/.dsh/consciousness-voice.json`（格式见 `lib/voice.js` 顶部）
- 没配就回"没配声音引擎"，不假装能响
- 页面上**没有按钮**——因为它慢：一句话要 2~30 秒，等生成完人早聊到下一句了

**别把它当对话用**，当"点一下听一句"可以。想快就得换引擎。

---

## 装之前先做一件事：确认 DSH 自己能聊天

**这一步不做，会赖到插件头上。**

先开一个新对话说句话，能回装上。**回不了，先修 DSH，别装插件。**

### 如果报“没有 API key”

原话大概是 `no API key for provider route "deepseek-official"`、错误码 `MISSING_CREDENTIAL`。

**这不是插件的问题，插件不碰 key。** 按顺序试：

1. **重新登录账号**（退出再扫码）。DSH 会在平台上有一条自己管的 key，登录票一过期就取不到它——**重登就能取回来**。
2. 还不行，就去 platform.deepseek.com 手动建一条 `sk-`，设成环境变量 `DEEPSEEK_API_KEY` 再启动。
3. 平台打不开、返回 429，是限流，**换网络或等十分钟**，别反复刷。

**别删平台上那条 `App-managed` 的 key**，那是 DSH 自己在用的。


### 向量层：已经全在包里了

模型（量化版 22.9 MB）和推理引擎（14.2 MB）都在安装包里，**装完就有向量，不用装 Python、不用装 torch、不用联网下模型。**

- 首次检索多约 0.24 秒（加载模型），之后每次 4 毫秒
- 想更准可以自己换 fp32 模型（多 90 MB，实测头名只差两句，不划算，默认不给）
- 卸载/删掉 `assets/embed` 也不影响记忆：只是检索少"换个说法也能翻到"这一层

