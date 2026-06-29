# msg_forward 消息转发插件

版本：1.0.0 | 作者：min-k

---

## 功能概述

- 支持 BNCR 平台间消息转发（qq1、tgBot2、wxGGBon4、qqPD、email 等）
- 支持外部 HTTP 推送接入（go-cqhttp、青龙、自建服务等）
- 内置敏感词过滤（依赖 `sensitive_words_api_service` 插件）
- 支持文字和图片转发，日志只打印到后台

---

## 依赖

| 依赖 | 说明 |
|------|------|
| `sensitive_words_api_service.js` | 同目录下的敏感词插件，需先启动 |
| `axios` | BNCR 框架已内置，无需额外安装 |

---

## 配置说明

在 BNCR Web 面板 → 插件管理 → `msg_forward` → 配置 中填写。

### 一、敏感词API配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| url | sensitive_words_api_service 的地址 | `http://127.0.0.1:9090` |
| token | API 认证 Token，留空=不认证 | 空 |
| enable | 是否启用敏感词过滤 | true |

### 二、转发规则列表

每条规则包含**来源配置**和**目标列表**，支持配置多条规则。

#### 规则基本字段

| 字段 | 说明 |
|------|------|
| name | 规则名称，仅用于日志识别 |
| enable | 是否启用此规则 |

#### 来源配置（source）

| 字段 | 说明 | 可选值 |
|------|------|--------|
| type | 来源类型 | `bncr`=BNCR平台消息 / `http`=外部HTTP推送 |
| platform | 来源平台（bncr类型用） | adapter名称，如 `tgBot2`、`qq1`、`wxGGBon4`，留空=所有平台 |
| group_type | 群或私聊（bncr类型用） | `group`=群 / `private`=私聊 / `all`=全部 |
| id | 来源ID（bncr类型用） | 群号或个人ID，留空=不限制 |
| http_source | HTTP来源标识（http类型用） | 与外部请求 body 中 `source` 字段匹配 |

#### 目标列表（targets）

每条规则可配置多个目标，同时推送。

| 字段 | 说明 | 可选值 |
|------|------|--------|
| platform | 目标平台 adapter 名称 | `qq1`、`tgBot2`、`wxGGBon4`、`qqPD`、`email` 等 |
| type | 目标类型 | `group`=群 / `private`=私聊 |
| id | 目标ID | 群号、个人ID 或邮箱地址（email平台） |

---

## 配置示例

### 示例1：TG群消息转发到QQ群

```
规则名称: TG转QQ
来源类型: bncr
来源平台: tgBot2
群/私聊:  group
来源ID:   -1001234567890

目标:
  平台: qq1  类型: group  ID: 1045345246
```

### 示例2：QQ群消息同时转发到微信群和TG群

```
规则名称: QQ多播
来源类型: bncr
来源平台: qq1
群/私聊:  group
来源ID:   1045345246

目标1: 平台: wxGGBon4  类型: group  ID: 12345678
目标2: 平台: tgBot2    类型: group  ID: -1001234567890
```

### 示例3：外部服务推送到TG群

```
规则名称: 青龙通知
来源类型: http
HTTP来源标识: qinglong_notify

目标: 平台: tgBot2  类型: group  ID: -1001234567890
```

### 示例4：转发到邮件

```
规则名称: 消息转邮件
来源类型: bncr
来源平台: tgBot2
群/私聊:  group
来源ID:   -1001234567890

目标: 平台: email  类型: private  ID: your@email.com
```

> email 平台说明：`type` 必须填 `private`，`id` 填收件人邮箱地址。

---

## 外部 HTTP 推送接口

### 接口地址

```
POST http://<BNCR地址>/api/msg-forward/push
```

### 请求参数（JSON Body）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source | string | 是 | 来源标识，对应规则中 `http_source` 字段 |
| msg | string | 文字必填 | 消息文本内容 |
| type | string | 否 | `text`（默认）或 `image` |
| path | string | 图片必填 | 图片 URL，type=image 时使用 |
| from_name | string | 否 | 发送者名称（仅用于后台日志） |
| from_group | string | 否 | 来源群名（仅用于后台日志） |

### 响应格式

```json
{ "success": true, "sent": 2 }
```

`sent` 为成功推送的目标数量。

### 调用示例

**发送文字（curl）：**

```bash
curl -X POST http://192.168.2.5:9090/api/msg-forward/push \
  -H "Content-Type: application/json" \
  -d '{
    "source": "qinglong_notify",
    "msg": "任务执行完成",
    "from_name": "青龙面板",
    "from_group": "定时任务"
  }'
```

**go-cqhttp 环境变量接入：**

```bash
export GOBOT_URL="http://192.168.2.5:9090/api/msg-forward/push"
export GOBOT_TOKEN=""   # 如敏感词API未启用认证则留空

# 发送消息
curl -X POST $GOBOT_URL \
  -H "Content-Type: application/json" \
  -d "{\"source\": \"gocqhttp_main\", \"msg\": \"$MESSAGE\"}"
```

**发送图片：**

```bash
curl -X POST http://192.168.2.5:9090/api/msg-forward/push \
  -H "Content-Type: application/json" \
  -d '{
    "source": "gocqhttp_main",
    "type": "image",
    "path": "http://example.com/image.jpg",
    "from_name": "机器人"
  }'
```

### 状态查询

```bash
GET http://<BNCR地址>/api/msg-forward/status
```

---

## 各平台特殊说明

| 平台 | 特殊处理 |
|------|---------|
| `email` | `id` 填收件人邮箱；`type` 必须填 `private`；`groupId` 留空或填邮箱 label |
| `qqPD` | 自动设置 `toMsgId=0`，确保推送模式不触发引用回复 |
| `wxGGBon4` | 群号不需要加 `@chatroom`，插件内部自动处理 |
| `tgBot2` | `id` 填 chat_id，群组为负数（如 `-1001234567890`） |

---

## 日志格式

所有转发消息只打印到后台日志，不会显示在目标平台：

```
[msg_forward] [规则名] [来源群名] 用户名: 消息内容
[msg_forward] [规则名] [来源群名] 用户名 => 已推送到 [tgBot2] group:-1001234567890
```

HTTP 推送日志：

```
[msg_forward][HTTP][规则名] [来源群名] 发送者: 消息内容
[msg_forward][HTTP][规则名] [来源群名] 发送者 => 已推送到 [tgBot2] group:-1001234567890
```

---

## 注意事项

1. 插件优先级为 `1`，不会抢占其他插件的命令触发
2. 未匹配任何规则的消息会直接跳过，不产生任何副作用
3. 只支持**文字**和**图片**转发，音频/视频/文件消息自动忽略
4. 敏感词过滤失败时不阻断转发，原文直接发送并打印错误日志
5. 推送单个目标失败不影响其他目标的发送
