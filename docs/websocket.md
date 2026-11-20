# ygoangelus.v1 WebSocket

- 路径为 `GET /duel`，升级时协商 `Sec-WebSocket-Protocol: ygoangelus.v1`。
- 所有应用消息均为 binary。一次 `send()` 对应一条完整应用消息，按 WebSocket 重组后的 message 边界读取，传输层可以分片。
- 下文 `S` 指调用方（游戏服或归档器），`A` 指 Angelus。字段紧密排列，所有多字节整数采用小端序。`u8/u16/u32` 为无符号整数，`i32` 为有符号整数。
- 公共头共 **5 字节**。WS 给出整条消息的长度，余下字节属于 body。

```text
偏移   类型   含义
0      u8     opcode
1      u32    requestId
5      bytes  body，直到本条 WS 消息末尾
```

请求 ID 在一条连接内从 1 递增且唯一。每个成功接收的请求有一条成功或错误回复，沿用请求 ID。主动推送用 ID 0。A 按接收顺序串行执行对同一 duel 的命令。S 可以关联多个查场请求的回复，但一次推进产生的消息和查场都处理完以后，才发下一次 `PROCESS`。

### 2.1 请求与成功回复

| S → A | 请求 body，字段按顺序编码 | A → S | 回复 body |
| --- | --- | --- | --- |
| `0x01 START` | `Start` | `0x81 START_OK` | 空 |
| `0x02 PROCESS` | 空 | `0x82 PROCESS_RESULT` | `status:u8`，随后零至多个 `[byteLength:u16][message]` |
| `0x03 RESPONSE` | 原始玩家响应，1–255 字节 | `0x83 RESPONSE_OK` | 空 |
| `0x04 QUERY_CARD` | `player:u8, location:u8, sequence:u8, queryFlag:u32, useCache:u8` | `0x84 QUERY_CARD_RESULT` | `query_card` 原始查询 buffer |
| `0x05 QUERY_FIELD_CARD` | `player:u8, location:u8, queryFlag:u32, useCache:u8` | `0x85 QUERY_FIELD_CARD_RESULT` | `query_field_card` 原始查询 buffer |
| `0x06 QUERY_FIELD_INFO` | 空 | `0x86 QUERY_FIELD_INFO_RESULT` | `query_field_info` 原始查询 buffer |
| `0x07 QUERY_FIELD_COUNT` | `player:u8, location:u8` | `0x87 QUERY_FIELD_COUNT_RESULT` | `count:u32` |
| `0x08 FINISH` | 空 | `0x88 FINISH_OK` | 原生 `Registry` dump，随后正常关闭 WS |

`player` 为内核的 0/1 位置，`location` 和 `queryFlag` 使用现有 ocgcore 常量。`useCache` 明确传 0 或 1。在查询的二进制结果中保留内核写入的字段、长度和空位表示，S 可以复用 `parseCardQuery`、`parseFieldCardQuery` 和 `parseFieldInfo`。`QUERY_FIELD_COUNT` 是计数值，其余查询回复取整个剩余 body 作为原始字节。

### 2.2 START 与 Deck

首条应用请求为 `START`，每条 WS 只能开一盘。解码器依次读取以下字段。

```text
seed       u32[8]
duelRule   u8
flags      u8      bit 0 = tag，bit 1 = noShuffleDeck，其余位填 0
startLp    i32
startHand  u8
drawCount  u8
decks      Deck[普通 2 副，Tag 4 副]
registry   Registry，直到本条消息末尾

Deck = [count:u8][cardCode:u32 × count]
```

`seed` 对应 `createDuelV2` 的 8 个种子字。`duelRule` 和两个标志映射到原有 `calculateDuelOptions`，`startLp`、`startHand`、`drawCount` 用于两方的 `setPlayerInfo`。S 提供已经确定好座位、完成房间洗牌和开盘调整的卡组。A 加载初始 registry 与配置的预加载脚本，按下列规则装牌并启动 duel，成功后返回空的 `START_OK`。

**`Deck.codes` 表示卡组顺序。主卡与额外卡允许在同一串中交错。** A 用本实例 CDB 及 `TYPES_EXTRA_DECK` 保序分出两个子序列，然后先倒序装主卡，再倒序装额外卡。每一项代表一张牌，重复卡号保留各自的位置与张数。`count` 是两区合计，最大 255，发送方遇到不可表示的数量应报告编码错误，避免截断卡组。

例如 `[A, X, B, Y, C]` 中 `X/Y` 为额外卡。分组得到主卡 `[A,B,C]`、额外 `[X,Y]`，内核装牌顺序为主卡 `C → B → A`，额外 `Y → X`。发送 `[A,B,C,X,Y]` 有相同结果。主卡按 `sequence=0` 加到牌顶，这个约定保留当前游戏服的开局牌序。

| 模式 | `decks` 中的座位 | 内核装牌 |
| --- | --- | --- |
| 普通 | 先后手换位后的 `[P0, P1]` | 两副均用 `newCard` |
| Tag | `[P0主, P0队友, P1主, P1队友]` | 沿用当前 Worker 的关联，索引 0、3 用 `newCard`，索引 1、2 用 `newTagCard`，实际装入四副牌的索引次序为 0、1、3、2，前一队归属玩家 0，后一队归属玩家 1。 |

`sideins` 在游戏服准备 `START` 时处理。Side 有牌时，通过 `GET /card-data?id=...` 批量取这些卡号的记录，以 `code` 建立索引。按原 Side 数组的顺序和张数，把命中 `(type & TYPES_EXTRA_DECK) !== 0` 的牌追加到额外卡组，再编码 `Deck`。Side 为空时直接编码已有卡组。完整的 Side 和换 Side 检查仍由房间持有。Undo 应使用这盘已准备好的开局输入。

### 2.3 Registry 与跨盘交接

直接采用 ocgcore `dump_registry/load_registry` 的序列化格式。两段长度连续在前，key 和 value 的内容紧随其后。

```text
Registry = 以下条目重复到消息末尾
[keyByteLength:u16][valueByteLength:u16][key bytes][value bytes]
```

长度单位为字节。空 registry 占 **0 字节**。`START` 的其余字段都可以先读完，`FINISH_OK` 整个 body 就是 dump，两处都可以从 WS 边界确定 registry 的终点。条目不带总数。单个 key 或 value 的原生导出长度最多 65,535 字节，C++ 会截到这个值。接收原始 dump 时校验每组头和内容完整，逐项消费到末尾。

现有 `koishipro-core.js` 提供 `loadRegistry(Uint8Array)` 和 `dumpRegistry().raw`。实现可以直接传原始格式，需要构造或更新游戏服的字符串键值时再按字节长度编码。游戏服应保留本盘的**初始** registry 给 Undo，正常收盘时接收**最终** registry，完成上盘交接后再构造下一盘的 `duel_count`、座位和玩家名称等开局项。

当前锁定的 `koishipro-core.js 1.5.5` 使用 256 KiB 共享接收缓冲区，原生 dump 入口接收输出指针，没有容量参数。每项的 `u16` 描述单字段可表示的长度。若要支持更大的总 dump，需要在导出前获得大小或提供可检查容量的导出路径，仅在写完后检查 WS 长度来不及保护该缓冲区。

### 2.4 PROCESS、拆包与 status

**一次 `PROCESS` 恰好执行一次原生 `duel.process({ noParse: true })`。** Angelus 对该次 `get_message` 输出拆包，用 `ygopro-msg-encode` 识别各条 `MSG_*` 的类型和边界，写入 WS 时使用原 buffer 对应的字节切片。验收时，顺序拼接所有切片应逐字节等于这一次的原始输出。

```text
PROCESS_RESULT body = [status:u8]
                      [message1Length:u16][message1 原始字节]
                      [message2Length:u16][message2 原始字节] …
```

- `messageLength` 包括该条 `MSG_*` 的编号。每条长度为 1–65,535 字节，读到 WS 消息末尾即完成本批。空批次的 body 是单字节 `00`。
- `status` 是 Angelus **由本批消息推导**的提示。按消息顺序取第一个命中下表的控制消息，仍发回完整的一批。其余消息的 `0` 不覆盖已经命中的结果。
- S 先处理本批消息，可以插入查询，再决定提交玩家响应、继续 `PROCESS` 或 `FINISH`。计时、消息拦截、判胜和可见性分别沿用调用方的业务流程。

| status | 判定 | 通常的调用方行为 |
| --- | --- | --- |
| `0` | 本批无以下三类消息，包括空批次 | 处理展示、效果与刷新等消息，按本盘状态决定后续操作 |
| `1` | `message instanceof YGOProMsgResponseBase` | 等操作方输入，录像翻译取下一条历史响应 |
| `2` | `MSG_WIN` | 读取该消息中的胜者和原因，由房间或归档流程收盘 |
| `3` | `MSG_RETRY` | 上一次输入被退回，回到原选择点，归档器走已有的恢复逻辑 |

原生 `PROCESSOR_WAITING` 可出现在展示卡片等场景，仅展示牌堆顶也会经过 `PROCESSOR_WAIT`。线上 `status` 只按上述 `MSG_*` 计算，原生 `PROCESSOR_END` 本身也不生成 `MSG_WIN` 或 `CORE_ERROR`。这让 `0` 的含义始终是“本批没有上述控制消息”。

如原始输出只成功解析了一段前缀，不能把遗留尾部当作成功的空消息，也不能扫描字节值猜下一条 MSG 的起点。建议将无法完整划分或无法用 `u16` 表达的本批作为 `CORE_ERROR` 处理。内核已推进的命令不能靠重发来补救。

### 2.5 RESPONSE、推送、错误及结束

`RESPONSE` 的 body 直接交给 `set_responseb`。`RESPONSE_OK` 表示收到了这份输入，输入是否被接受由后续 `PROCESS_RESULT` 显示。`MSG_RETRY` 是游戏内结果，玩家可以重新选择。S 保留 request ID 与调用之间的关联，也接收内核主动推送的消息。

| A → S | ID | Body |
| --- | --- | --- |
| `0x90 CORE_MESSAGE` | `0` | `[type:u8][UTF-8 文本到末尾]`。`0` 为 `DebugMessage`，`1` 为 `ScriptError`。 |
| `0xFF ERROR` | 原请求 ID | `[code:u16][UTF-8 文本到末尾]`。取代该条请求的成功回复。 |

`ERROR.code` 为 `1 BAD_REQUEST`（字段、长度或取值错误）、`2 BAD_STATE`（例如同一 WS 第二次开盘）、`3 CORE_ERROR`（内核或输出处理异常）、`4 CORE_TIMEOUT`（内核调用超时）。`CORE_MESSAGE` 可以在 `START_OK` 前或普通回复之间到达，客户端应在发送 `START` 前开始接收推送。

开盘后可以在需要时 `FINISH`，包括投降、房间规则提前判胜，以及正常打完后的最后一次查场。正常路径先取得最终 registry 并发出 `FINISH_OK`，再关闭 WS 和释放 Worker。意外断线直接回收该 WS 的 Worker。进行中的正式对局遇到意外断线沿用现有内核崩溃平局，调用方主动结束、丢弃 Undo 候选连接或替换旧连接均按对应生命周期处理，只有当前主对局的意外终止触发平局。

WS 客户端在连接终止时结束所有尚未完成的请求。`PROCESS` 和 `RESPONSE` 超时可能发生在命令已经执行之后，调用方走内核异常路径。对于卡死在同步 WASM 中的 Worker，超时和回收应由 Worker 外的宿主执行。

### 2.6 线上消息示例

以下为完整 WS 应用消息的十六进制字节。`|` 只用来标注字段。第一个往返包含一条推进请求和两条内核消息。

```text
S → A  02 | 08 00 00 00
A → S  82 | 08 00 00 00 | 00 | 02 00 | 28 00 | 03 00 | 29 04 00
                          正常   长度2    NEW_TURN  长度3    NEW_PHASE

S → A  02 | 09 00 00 00
A → S  82 | 09 00 00 00 | 03 | 01 00 | 01
                          重试   长度1    MSG_RETRY

S → A  08 | 0A 00 00 00
A → S  88 | 0A 00 00 00
                          空 registry，本盘正常关闭
```

第二个例子是独立的重试结果示意。实际游戏中，收到选择请求后，S 先发 `RESPONSE`、收到 `RESPONSE_OK`，下一次 `PROCESS` 才能看到该输入带来的游戏消息。
