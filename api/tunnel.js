// Vercel中转服务 - 水下机器人母船控制
// 支持绞盘收/放/停、查询设备状态

const https = require('https');

// 环境变量（在 Vercel 项目中配置）
const IAM_USERNAME = process.env.IAM_USERNAME;
const IAM_PASSWORD = process.env.IAM_PASSWORD;
const IAM_DOMAIN = process.env.IAM_DOMAIN;
const PROJECT_ID = process.env.HUAWEI_PROJECT_ID;
const DEVICE_ID = process.env.HUAWEI_DEVICE_ID;
const IOTDA_ENDPOINT = process.env.HUAWEI_IOTDA_ENDPOINT;

let cachedToken = null;
let tokenExpireTime = 0;

// 获取华为云 IAM Token
async function getIAMToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpireTime) return cachedToken;

  const postData = JSON.stringify({
    auth: {
      identity: {
        methods: ["password"],
        password: {
          user: {
            name: IAM_USERNAME,
            password: IAM_PASSWORD,
            domain: { name: IAM_DOMAIN }
          }
        }
      },
      scope: { project: { id: PROJECT_ID } }
    }
  });

  const options = {
    hostname: 'iam.cn-south-1.myhuaweicloud.com',
    port: 443,
    path: '/v3/auth/tokens',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          cachedToken = res.headers['x-subject-token'];
          tokenExpireTime = now + 23 * 60 * 60 * 1000;
          resolve(cachedToken);
        } else reject(new Error(`Token获取失败: ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 通用华为云 API 请求
async function huaweiRequest(method, path, body = null) {
  const token = await getIAMToken();
  const options = {
    hostname: IOTDA_ENDPOINT,
    port: 443,
    path: path,
    method: method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * 查询设备状态（设备影子）
 * 返回水下机器人的关键属性
 */
async function getDeviceStatus() {
  const shadowPath = `/v5/iot/${PROJECT_ID}/devices/${DEVICE_ID}/shadow`;
  const shadowData = await huaweiRequest('GET', shadowPath);
  let properties = {};
  if (shadowData.shadow && Array.isArray(shadowData.shadow)) {
    const controlService = shadowData.shadow.find(s => s.service_id === 'control');
    if (controlService?.reported?.properties) properties = controlService.reported.properties;
  }
  // 映射为小程序友好的字段（单位已转换，深度 cm→m，角度 0.1°→°）
  return {
    depth: properties.depth !== undefined ? (properties.depth / 100).toFixed(1) : '--',      // 米
    heading: properties.heading !== undefined ? (properties.heading / 10).toFixed(0) : '--', // 度
    pitch: properties.pitch !== undefined ? (properties.pitch / 10).toFixed(1) : '--',
    roll: properties.roll !== undefined ? (properties.roll / 10).toFixed(1) : '--',
    speed_forward: properties.speed_forward ?? '--',
    battery: properties.battery ?? '--',
    fiber_link: properties.fiber_link ?? '--',
    acoustic_link: properties.acoustic_link ?? '--',
    emergency_state: properties.emergency_state ?? 0,
    winch_limit: properties.winch_limit ?? 0   // 0=无触发,1=上限位,2=下限位（可选）
  };
}

/**
 * 下发命令到设备
 * @param {string} command 命令名称（winch_up, winch_down, winch_stop, 其他）
 * @param {number} speed 可选参数（例如绞盘速度百分比）
 */
async function sendCommand(command, speed = null) {
  let paras = { command: command };
  if (speed !== null && command === 'winch_speed') {
    paras.speed = speed;
  }
  const body = {
    service_id: 'control',
    command_name: 'control',   // 统一使用 control 命令
    paras: paras
  };
  const fullPath = `/v5/iot/${PROJECT_ID}/devices/${DEVICE_ID}/commands`;
  await huaweiRequest('POST', fullPath, body);
}

// Vercel Serverless 入口
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const urlWithoutQuery = req.url.split('?')[0];
    let path = urlWithoutQuery.replace('/api/tunnel', '');

    // 查询设备状态
    if (path === '/device-status') {
      const status = await getDeviceStatus();
      return res.status(200).json(status);
    }
    // 下发命令
    else if (path === '/command') {
      const { command, speed } = req.body || {};
      if (!command) {
        return res.status(400).json({ error: 'missing command' });
      }
      // 只支持绞盘相关命令（扩展可加）
      const validCommands = ['winch_up', 'winch_down', 'winch_stop', 'winch_speed'];
      if (!validCommands.includes(command)) {
        return res.status(400).json({ error: 'invalid command' });
      }
      await sendCommand(command, speed);
      return res.status(200).json({ success: true });
    }
    else {
      res.status(404).json({ error: 'Invalid endpoint' });
    }
  } catch (error) {
    console.error('处理请求出错:', error);
    res.status(500).json({ error: error.message });
  }
};