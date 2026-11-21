# Angelus API

示例地址为 `http://localhost:3001`。更改监听地址或端口时，使用实际的服务地址。

## 端点

| 方法和路径 | 用途 |
| --- | --- |
| [`GET /lflists`](#get-lflists) | 获取可用于验卡的禁限表 |
| [`GET /card-data`](#get-card-data) | 查询卡片数据 |
| [`POST /check-deck`](#post-check-deck) | 检查卡组是否合法 |
| [`GET /readyz`](#get-readyz) | 检查服务是否已就绪 |
| [`GET /docs`、`GET /docs-json`、`GET /docs-yaml`](#openapi) | 查看或下载 OpenAPI 文档 |
| `GET /duel` | [WebSocket 协议](websocket.md) |

## 认证与响应格式

配置了 `SERVER_TOKEN` 时，三个资源接口要求请求头 `x-server-token` 与配置值一致。未配置或配置为空时可匿名调用。`/readyz` 和 OpenAPI 文档端点可匿名访问。

资源接口和就绪探针返回 JSON，其中 `statusCode` 与 HTTP 状态码一致，`timestamp` 是 ISO 8601 时间。成功响应的 `success` 为 `true`，资源接口将结果放在 `data` 中。错误响应的 `success` 为 `false`，无 `data` 字段。

| HTTP 状态 | `message` | 含义 |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | 请求格式或参数不合法 |
| `401` | `Unauthorized` | 缺少正确的服务令牌 |
| `404` | `LFLIST_NOT_FOUND` | 指定的禁限表名称不存在 |
| `500` | `INTERNAL_SERVER_ERROR` | 服务处理失败 |
| `503` | `NOT_READY` | 就绪探针检测到服务尚未就绪或正在退出 |

## GET /lflists

无需请求参数。返回当前资源快照中的禁限表列表，顺序与资源加载顺序一致。

```json
{
  "statusCode": 200,
  "message": "success",
  "success": true,
  "timestamp": "2026-11-21T03:54:18.889Z",
  "data": {
    "lists": [{ "name": "Example OCG", "hash": 1979248234 }]
  }
}
```

`hash` 是禁限表的无符号 32 位哈希。调用 `/check-deck` 时使用返回的完整 `name`。重名表的首次出现保留原名，后续依次加上 ` (2)`、` (3)` 等后缀，跳过资源已使用的名称。没有禁限表时返回 `{"lists":[]}`。

## GET /card-data

可选查询参数 `id` 接受逗号分隔的十进制卡号，范围为 `1` 至 `2147483647`。

- 省略 `id` 时返回当前快照的全部卡片，按卡号升序排列。
- 传入 `?id=101,1,101` 时，按请求中首次出现的顺序返回命中项。重复、格式无效和卡库中不存在的卡号会被跳过。
- 传入空的 `?id=` 或没有命中项时，返回 `data: []`。

下面是测试卡库中 `GET /card-data?id=101` 的 `data` 示例。数值字段均为整数，`setcode` 固定包含 16 项无符号 16 位整数。

```json
[
  {
    "code": 101,
    "ot": 3,
    "alias": 0,
    "setcode": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "type": 67108897,
    "level": 1,
    "attribute": 1,
    "race": 1,
    "attack": 1000,
    "defense": 0,
    "lscale": 0,
    "rscale": 0,
    "linkMarker": 2,
    "ruleCode": 0
  }
]
```

`ot` 是卡片的可用范围位掩码，`alias` 是别名卡号，`ruleCode` 是验卡时优先采用的同名计数卡号。连接怪兽的箭头用 `linkMarker` 表示。

## POST /check-deck

请求体为 `application/json`。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `deck` | 字符串，必填 | YDKE 卡组，格式为 `ydke://<主卡组>!<额外卡组>!<副卡组>!`。每个区段由小端序无符号 32 位卡号的标准 Base64 编码组成，空区段保留分隔符。 |
| `lflist` | 字符串或 `null`，可选 | `GET /lflists` 返回的准确名称。省略或为 `null` 时只执行基本校验。 |
| `rule` | 整数，可选 | 卡片可用范围。 `0` 为 OCG，`1` 为 TCG，`2` 为简中，`3` 为自定义，`4` 要求同时具有 OCG 和 TCG 标志，`5` 允许全部范围。默认 `5`。带自定义标志的卡可通过可用范围检查。 |
| `limits` | 对象，可选 | 用请求值覆盖指定的卡组限制。未指定的限制继承服务端配置。 |

`limits` 的各项须为非负整数，`minMain` 不得大于 `maxMain`。

| 字段 | 服务默认值 | 含义 |
| --- | --- | --- |
| `minMain` | `40` | 主卡组最少张数 |
| `maxMain` | `60` | 主卡组最多张数 |
| `maxExtra` | `15` | 额外卡组最多张数 |
| `maxSide` | `15` | 副卡组最多张数 |
| `maxCopies` | `3` | 三个区段加起来的同名卡张数上限 |

例如，下面的请求使用测试卡库，允许一张主卡的卡组通过基本校验。

```json
{
  "deck": "ydke://AQAAAA==!!!",
  "limits": { "minMain": 0 }
}
```

完成校验后返回 HTTP `200`。合法时 `data` 为 `{"valid":true}`，不合法时 `data.valid` 为 `false`，并返回遇到的第一个错误。比如上例省略 `limits`，服务用默认的 40 张下限验卡，将返回以下 `data`。

```json
{
  "valid": false,
  "error": { "reason": 6, "code": 1 }
}
```

| `error.reason` | 说明 | `error.code` |
| --- | --- | --- |
| `1` | 违反禁限表 | 禁限表计数使用的卡号 |
| `2` | 卡片限 OCG | 卡号 |
| `3` | 卡片限 TCG | 卡号 |
| `4` | 未知卡片 | 卡号 |
| `5` | 超出同名卡上限 | 卡号 |
| `6` | 主卡组张数或卡种不符 | 主卡组张数或违规卡号 |
| `7` | 额外卡组张数或卡种不符 | 额外卡组张数或违规卡号 |
| `8` | 副卡组张数或卡种不符 | 副卡组张数或违规卡号 |
| `9` | 卡片不在所选可用范围 | 卡号 |

YDKE 格式或请求字段无效时返回 HTTP `400`。指定的禁限表不存在时返回 HTTP `404`。

## GET /readyz

无需参数。资源完成首次加载并可以接受新请求时返回 HTTP `200`。未就绪或进入关闭流程时返回 HTTP `503` 和 `NOT_READY`。两个响应都使用通用 JSON 格式，仅含通用字段。

## OpenAPI

- `GET /docs` 打开 Swagger UI。
- `GET /docs-json` 返回 OpenAPI JSON，可供客户端代码生成工具使用。
- `GET /docs-yaml` 返回 OpenAPI YAML。

设置 `NO_OPENAPI=1` 会关闭上述文档端点。
