# 本机 HTTP 接口（给别的程序读这套记忆）

识海默认只在 DSH 窗口里用。这一页是给「别的程序也想问它」准备的：
一个本机小服务，只绑回环地址，带令牌，默认只读。

## 起服务

装完插件后，包在 DSH 的 node_modules 里，直接跑那个文件：

```bash
# 路径按你机器上的 profile 名改，一般是 desktop
node "<DSH>/profiles/desktop/node_modules/dsh-consciousness2/bin/sea-api.mjs" --port 8765
```

看到这三行就是起来了：

```
识海接口: http://127.0.0.1:8765
token 文件: C:\Users\<你>\.dsh\consciousness-api-token
写入: 关（只读）
```

要允许写，加 `--allow-write`（或者环境变量 `SEA_API_WRITE=1`）。默认别开。

## 拿令牌

第一次启动会自动生成一串，存在上面那个文件里。读出来：

```bash
cat ~/.dsh/consciousness-api-token
```

## 调

```bash
TOKEN=$(cat ~/.dsh/consciousness-api-token)

curl -s -X POST http://127.0.0.1:8765/search \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"query":"那个脚本","limit":3,"review":false}'
```

- `review:false` 表示这次不算「被想起」，不会拉高那条记忆的强度；调试时用它。
- 返回里的 `result.log` 就是插件里那句人话答案，`result` 里带原始字段。

端点一共五个：

- `GET /health` —— 不用令牌，只看活没活。
- `GET /seas` —— 有哪几个海。
- `POST /search` —— 查（参数 query / sea / limit / review）。
- `POST /list` —— 最近几条（参数 sea / limit）。
- `POST /write` —— 写（要开写入）。

## 安全边界

- 只绑 `127.0.0.1`，外网进不来。
- 令牌等于钥匙，别贴到群里、别提交到仓库。
- 想让同一局域网的别的机器用，得自己改绑 `0.0.0.0`、开防火墙、换强令牌——那已经超出这份文档的范围，风险自负。

## 它和插件是同一套东西

接口内部直接调插件里那套查询实现，没有第二套检索。
所以同一个问题，在窗口里问和在接口里问，答案一样。
