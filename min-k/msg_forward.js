/**
 * @author min-k
 * @name msg_forward
 * @team min-k
 * @version 1.0.0
 * @description 消息转发插件 - 支持多平台消息转发，内置敏感词过滤，支持外部HTTP推送接入
 * @rule ^([\s\S]*)$
 * @admin false
 * @public true
 * @priority 1
 * @disable false
 * @classification ["消息转发"]
 */

const axios = require('axios');

// ─── 配置 Schema ────────────────────────────────────────────────────────────

const jsonSchema = BncrCreateSchema.object({
  sensitive_api: BncrCreateSchema.object({
    url: BncrCreateSchema.string()
      .setTitle('敏感词API地址')
      .setDescription('sensitive_words_api_service 的服务地址，如 http://127.0.0.1:9090')
      .setDefault('http://127.0.0.1:9090'),
    token: BncrCreateSchema.string()
      .setTitle('敏感词API Token')
      .setDescription('留空则不启用认证')
      .setDefault(''),
    enable: BncrCreateSchema.boolean()
      .setTitle('启用敏感词过滤')
      .setDefault(true)
  }).setTitle('敏感词API配置').setDefault({}),

  rules: BncrCreateSchema.array(
    BncrCreateSchema.object({
      name: BncrCreateSchema.string()
        .setTitle('规则名称')
        .setDescription('便于识别的规则名，仅用于日志')
        .setDefault(''),
      enable: BncrCreateSchema.boolean()
        .setTitle('启用此规则')
        .setDefault(true),

      source: BncrCreateSchema.object({
        type: BncrCreateSchema.string()
          .setTitle('来源类型')
          .setDescription('bncr=BNCR平台消息, http=外部HTTP推送')
          .setDefault('bncr'),
        platform: BncrCreateSchema.string()
          .setTitle('来源平台(bncr类型用)')
          .setDescription('填写adapter名称，如 tgBot2、qq1、wxGGBon4。留空=所有平台')
          .setDefault(''),
        group_type: BncrCreateSchema.string()
          .setTitle('来源类型(bncr类型用)')
          .setDescription('group=群, private=私聊, all=全部')
          .setDefault('all'),
        id: BncrCreateSchema.string()
          .setTitle('来源ID(bncr类型用)')
          .setDescription('群号或个人ID，留空=不限制')
          .setDefault(''),
        http_source: BncrCreateSchema.string()
          .setTitle('HTTP来源标识(http类型用)')
          .setDescription('外部请求body中的source字段值，用于匹配此规则')
          .setDefault('')
      }).setTitle('来源配置').setDefault({}),

      targets: BncrCreateSchema.array(
        BncrCreateSchema.object({
          platform: BncrCreateSchema.string()
            .setTitle('目标平台')
            .setDescription('adapter名称，如 qq1、tgBot2、wxGGBon4、email、qqPD')
            .setDefault(''),
          type: BncrCreateSchema.string()
            .setTitle('目标类型')
            .setDescription('group=群, private=私聊')
            .setDefault('group'),
          id: BncrCreateSchema.string()
            .setTitle('目标ID')
            .setDescription('群号或个人ID')
            .setDefault('')
        })
      ).setTitle('目标列表').setDefault([])
    })
  ).setTitle('转发规则列表').setDefault([])
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

// ─── HTTP 路由（外部推送接入）────────────────────────────────────────────────

/**
 * 外部HTTP推送接口
 * POST /api/msg-forward/push
 * Body: {
 *   source: string,        // 对应规则中 source.http_source
 *   msg: string,           // 文本内容
 *   type?: string,         // 消息类型 text|image，默认 text
 *   path?: string,         // 图片URL（type=image时使用）
 *   from_name?: string,    // 发送者名称（用于日志）
 *   from_group?: string,   // 来源群名（用于日志）
 *   token?: string         // 可选认证token（与敏感词API token共用）
 * }
 */
router.post('/api/msg-forward/push', async (req, res) => {
  try {
    await ConfigDB.get();
    const config = ConfigDB.userConfig;

    const { source, msg, type = 'text', path: mediaPath, from_name, from_group, token } = req.body || {};

    if (!source) {
      return res.status(400).json({ success: false, message: '缺少 source 字段' });
    }
    if (!msg && type === 'text') {
      return res.status(400).json({ success: false, message: '缺少 msg 字段' });
    }

    const sentCount = await processHttpMessage({ config, source, msg, type, mediaPath, fromName: from_name, fromGroup: from_group });

    res.json({ success: true, sent: sentCount });
  } catch (err) {
    console.error('[msg_forward] HTTP推送处理失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// API状态
router.get('/api/msg-forward/status', (req, res) => {
  res.json({ success: true, service: 'msg_forward', version: '1.0.0' });
});

// ─── 敏感词过滤 ──────────────────────────────────────────────────────────────

async function filterSensitiveWords(config, text) {
  if (!text || !config.sensitive_api?.enable) return text;

  try {
    const url = (config.sensitive_api?.url || 'http://127.0.0.1:9090').replace(/\/$/, '');
    const token = config.sensitive_api?.token;

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await axios.post(`${url}/api/sensitive-words/filter`, { text }, { headers, timeout: 5000 });

    if (resp.data?.success && resp.data?.data?.filteredText) {
      return resp.data.data.filteredText;
    }
  } catch (err) {
    console.error('[msg_forward] 敏感词过滤失败:', err.message);
  }

  return text;
}

// ─── 构建 push 参数（处理各平台差异）────────────────────────────────────────

function buildPushParams(target, msg, type, mediaPath) {
  const { platform, type: targetType, id } = target;

  const isGroup = targetType === 'group';
  const groupId = isGroup ? id : '0';
  const userId = isGroup ? '0' : id;

  const base = { platform, msg, type, groupId, userId };

  if ((type === 'image') && mediaPath) {
    base.path = mediaPath;
  }

  // email 特殊处理：userId 需要是邮箱地址，groupId 是 label
  // 调用方需自行在 id 字段填写收件邮箱，type 填 private
  if (platform === 'email') {
    return {
      platform,
      msg,
      type: 'text',
      groupId: isGroup ? id : '0',  // email 的 groupId 是 label
      userId: isGroup ? '0' : id,   // email 的 userId 是收件邮箱
      groupName: '消息转发通知'
    };
  }

  // qqPD 强制 toMsgId=0
  if (platform === 'qqPD' || platform.startsWith('qqPD')) {
    base.toMsgId = 0;
  }

  return base;
}

// ─── 实际发送 ────────────────────────────────────────────────────────────────

async function sendToTarget(target, filteredMsg, type, mediaPath, logPrefix) {
  try {
    const params = buildPushParams(target, filteredMsg, type, mediaPath);
    await sysMethod.push(params);
    console.log(`${logPrefix} => 已推送到 [${target.platform}] ${target.type}:${target.id}`);
    return true;
  } catch (err) {
    console.error(`${logPrefix} => 推送到 [${target.platform}] ${target.type}:${target.id} 失败:`, err.message);
    return false;
  }
}

// ─── 处理 BNCR 平台消息 ──────────────────────────────────────────────────────

async function processBncrMessage(s, config) {
  const fromPlatform = s.getFrom();
  const groupId = s.getGroupId();
  const userId = s.getUserId();
  const msg = s.getMsg();
  const msgInfo = s.msgInfo || {};
  const isGroup = groupId && groupId !== '0';

  // 读取媒体信息
  const hasMedia = !!(msgInfo.media && msgInfo.mediaType);
  const mediaType = msgInfo.mediaType || '';
  const isImage = mediaType === 'image';

  // 只处理文字和图片
  if (hasMedia && !isImage) return;

  const rules = config.rules || [];
  let matched = false;

  for (const rule of rules) {
    if (!rule.enable) continue;
    if (rule.source.type !== 'bncr') continue;

    const src = rule.source;

    // 平台匹配
    if (src.platform && src.platform !== fromPlatform) continue;

    // 群/私聊类型匹配
    if (src.group_type === 'group' && !isGroup) continue;
    if (src.group_type === 'private' && isGroup) continue;

    // ID匹配
    if (src.id) {
      const targetId = isGroup ? groupId : userId;
      if (src.id !== targetId) continue;
    }

    matched = true;

    const fromGroupName = (s.getGroupName ? s.getGroupName() : null) || groupId;
    const fromUserName = (s.getUserName ? s.getUserName() : null) || userId;
    const logPrefix = `[msg_forward] [${rule.name || rule.source.platform || 'rule'}] [${fromGroupName}] ${fromUserName}`;

    console.log(`${logPrefix}: ${msg || '[图片]'}`);

    const filteredMsg = msg ? await filterSensitiveWords(config, msg) : '';
    const msgType = isImage ? 'image' : 'text';
    // media 可能是对象(含url/path)或字符串(直接是路径)
    const mediaPath = isImage
      ? (typeof msgInfo.media === 'string' ? msgInfo.media : (msgInfo.media?.url || msgInfo.media?.path || ''))
      : undefined;

    for (const target of (rule.targets || [])) {
      if (!target.platform || !target.id) continue;
      await sendToTarget(target, filteredMsg || '', msgType, mediaPath, logPrefix);
    }
  }

  return matched;
}

// ─── 处理外部 HTTP 消息 ──────────────────────────────────────────────────────

async function processHttpMessage({ config, source, msg, type, mediaPath, fromName, fromGroup }) {
  const rules = config.rules || [];
  let sentCount = 0;

  for (const rule of rules) {
    if (!rule.enable) continue;
    if (rule.source.type !== 'http') continue;
    if (rule.source.http_source !== source) continue;

    const logPrefix = `[msg_forward][HTTP][${rule.name || source}] [${fromGroup || '-'}] ${fromName || '-'}`;
    console.log(`${logPrefix}: ${msg || '[图片]'}`);

    const filteredMsg = msg ? await filterSensitiveWords(config, msg) : msg;

    for (const target of (rule.targets || [])) {
      if (!target.platform || !target.id) continue;
      const ok = await sendToTarget(target, filteredMsg || '', type || 'text', mediaPath, logPrefix);
      if (ok) sentCount++;
    }
  }

  return sentCount;
}

// ─── 插件主函数 ──────────────────────────────────────────────────────────────

module.exports = async s => {
  await ConfigDB.get();
  const config = ConfigDB.userConfig;

  if (!config || !config.rules || config.rules.length === 0) return;

  await processBncrMessage(s, config);
};
