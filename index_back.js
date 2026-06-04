const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { execSync } = require('child_process');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// 只填写UPLOAD_URL将上传节点,同时填写UPLOAD_URL和PROJECT_URL将上传订阅
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址,需填写部署Merge-sub项目后的首页地址,例如：https://merge.xxx.com
const PROJECT_URL = process.env.PROJECT_URL || '';    // 需要上传订阅或保活时需填写项目分配的url,例如：https://google.com
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; // false关闭自动保活，true开启,需同时填写PROJECT_URL变量
const FILE_PATH = process.env.FILE_PATH || '.tmp';   // 运行目录,sub节点文件保存目录
const SUB_PATH = process.env.SUB_PATH || 'sub';      // 订阅路径
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        // http服务订阅端口
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913'; // 在不同的平台运行需修改UUID,否则会覆盖
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          // 固定隧道域名,留空即启用临时隧道
const ARGO_AUTH = process.env.ARGO_AUTH || '';              // 固定隧道密钥json或token,留空即启用临时隧道,json获取地址：https://json.zone.id
const ARGO_PORT = process.env.ARGO_PORT || 8001;            // 固定隧道端口,使用token需在cloudflare后台设置和这里一致
const CFIP = process.env.CFIP || '';           // 节点优选域名或优选ip
const CFPORT = process.env.CFPORT || 443;                   // 节点优选域名或优选ip对应的端口
const VLESS_PATH = process.env.VLESS_PATH || '/vless-argo';   // vless ws路径
const VMESS_PATH = process.env.VMESS_PATH || '/vmess-argo';   // vmess ws路径
const TROJAN_PATH = process.env.TROJAN_PATH || '/trojan-argo'; // trojan ws路径
const ECH_CONFIG = process.env.ECH_CONFIG || '';               // ECH配置, 支持格式: "域名+DoH地址" 如 "crypto.cloudflare.com+https://1.1.1.1/dns-query"
const VLESS_ECH = process.env.VLESS_ECH || '';                 // vless是否启用ECH, 非空即启用
const VMESS_ECH = process.env.VMESS_ECH || '';                 // vmess是否启用ECH, 非空即启用
const TROJAN_ECH = process.env.TROJAN_ECH || '';               // trojan是否启用ECH, 非空即启用
const FRAGMENT_PACKETS = process.env.FRAGMENT_PACKETS || 'tlshello'; // 分片模式: tlshello 或 1-3
const FRAGMENT_LENGTH = process.env.FRAGMENT_LENGTH || '100-200';    // 分片包长度(字节)
const FRAGMENT_INTERVAL = process.env.FRAGMENT_INTERVAL || '10-20';  // 分片间隔(ms)
const VLESS_FRAGMENT = process.env.VLESS_FRAGMENT || '';        // vless是否启用分片, 非空即启用
const VMESS_FRAGMENT = process.env.VMESS_FRAGMENT || '';        // vmess是否启用分片, 非空即启用
const TROJAN_FRAGMENT = process.env.TROJAN_FRAGMENT || '';      // trojan是否启用分片, 非空即启用
const VLESS_XUDP = process.env.VLESS_XUDP || '';               // vless是否启用xudp, 非空即启用
const VMESS_XUDP = process.env.VMESS_XUDP || '';               // vmess是否启用xudp, 非空即启用
const TROJAN_XUDP = process.env.TROJAN_XUDP || '';             // trojan是否启用xudp, 非空即启用
const VLESS_ENABLE = process.env.VLESS_ENABLE !== '0';          // vless节点生成开关, 设为0关闭
const VMESS_ENABLE = process.env.VMESS_ENABLE !== '0';          // vmess节点生成开关, 设为0关闭
const TROJAN_ENABLE = process.env.TROJAN_ENABLE !== '0';        // trojan节点生成开关, 设为0关闭
const CFIP_URL = process.env.CFIP_URL || '';                    // 优选IP列表URL, 如 https://raw.githubusercontent.com/colloq168/sub/refs/heads/raw/ips_tencent/gb.txt
const CFIP_COUNT = parseInt(process.env.CFIP_COUNT || '');    // 从列表中取前N个IP生成节点

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 生成随机6位字符文件名
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// 全局常量
const webName = generateRandomName();
const botName = generateRandomName();
const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);
const subPath = path.join(FILE_PATH, 'sub.txt');
const listPath = path.join(FILE_PATH, 'list.txt');
const bootLogPath = path.join(FILE_PATH, 'boot.log');
const configPath = path.join(FILE_PATH, 'config.json');

// 如果订阅器上存在历史运行节点则先删除
function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;

    let fileContent;
    try {
      fileContent = fs.readFileSync(subPath, 'utf-8');
    } catch {
      return;
    }

    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line =>
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    axios.post(`${UPLOAD_URL}/api/delete-nodes`,
      JSON.stringify({ nodes }),
      { headers: { 'Content-Type': 'application/json' } }
    ).catch(() => {});
  } catch (err) {
    console.error('deleteNodes error:', err.message);
  }
}

// 清理历史文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`cleanupOldFiles: failed to delete ${filePath}:`, err.message);
      }
    });
  } catch (err) {
    console.error('cleanupOldFiles error:', err.message);
  }
}

// 生成xr-ay配置文件
function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: VLESS_PATH, dest: 3002 }, { path: VMESS_PATH, dest: 3003 }, { path: TROJAN_PATH, dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: VLESS_PATH } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: VMESS_PATH } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: TROJAN_PATH } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// 判断系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  }
  return 'amd';
}

// 下载对应系统架构的依赖文件
function downloadFile(fileName, fileUrl) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FILE_PATH)) {
      fs.mkdirSync(FILE_PATH, { recursive: true });
    }

    const writer = fs.createWriteStream(fileName);

    axios({ method: 'get', url: fileUrl, responseType: 'stream' })
      .then(response => {
        response.data.pipe(writer);
        writer.on('finish', () => {
          writer.close();
          console.log(`Download ${path.basename(fileName)} successfully`);
          resolve(fileName);
        });
        writer.on('error', err => {
          fs.unlink(fileName, () => {});
          reject(new Error(`Download ${path.basename(fileName)} failed: ${err.message}`));
        });
      })
      .catch(err => {
        reject(new Error(`Download ${path.basename(fileName)} failed: ${err.message}`));
      });
  });
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`Can't find a file for the current architecture`);
    return;
  }

  try {
    await Promise.all(filesToDownload.map(f => downloadFile(f.fileName, f.fileUrl)));
  } catch (err) {
    console.error('Error downloading files:', err.message);
    return;
  }

  // 授权文件
  const filesToAuthorize = [webPath, botPath];
  for (const filePath of filesToAuthorize) {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o775);
      console.log(`Empowerment success for ${filePath}`);
    }
  }

  // 运行xr-ay
  try {
    await exec(`nohup ${webPath} -c ${configPath} >/dev/null 2>&1 &`);
    console.log(`${webName} is running`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`web running error: ${error.message}`);
  }

  // 运行cloud-fared
  if (fs.existsSync(botPath)) {
    let args;

    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
    }

    try {
      await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
      console.log(`${botName} is running`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`bot running error: ${error.message}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

// 根据系统架构返回对应的url
function getFilesForArchitecture(architecture) {
  if (architecture === 'arm') {
    return [
      { fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }
    ];
  }
  return [
    { fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" },
    { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }
  ];
}

// 获取固定隧道json
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log("ARGO_DOMAIN or ARGO_AUTH variable is empty, use quick tunnels");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const tunnelYaml = `
tunnel: ${ARGO_AUTH.split('"')[11]}
credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
protocol: http2

ingress:
  - hostname: ${ARGO_DOMAIN}
    service: http://localhost:${ARGO_PORT}
    originRequest:
      noTLSVerify: true
  - service: http_status:404
`;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  } else {
    console.log("ARGO_AUTH mismatch TunnelSecret, use token connect to tunnel");
  }
}

// 获取isp信息
async function getMetaInfo() {
  try {
    const response1 = await axios.get('https://api.ip.sb/geoip', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 3000
    });
    if (response1.data && response1.data.country_code && response1.data.isp) {
      return `${response1.data.country_code}-${response1.data.isp}`.replace(/\s+/g, '_');
    }
  } catch (error) {
    try {
      const response2 = await axios.get('http://ip-api.com/json', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 3000
      });
      if (response2.data && response2.data.status === 'success' && response2.data.countryCode && response2.data.org) {
        return `${response2.data.countryCode}-${response2.data.org}`.replace(/\s+/g, '_');
      }
    } catch (error2) {
      // 备用API也失败
    }
  }
  return 'Unknown';
}

// 从URL获取优选IP列表
async function fetchCfipList() {
  if (!CFIP_URL) return [];
  try {
    const response = await axios.get(CFIP_URL, { timeout: 5000 });
    const lines = response.data.split(/\n+/).map(l => l.trim()).filter(Boolean);
    return lines.slice(0, CFIP_COUNT).map(line => {
      const [ipPort, ...rest] = line.split('#');
      const [ip, port] = ipPort.trim().split(':');
      const remark = rest.join('#').trim();
      return { ip, port: port || '443', remark };
    });
  } catch (error) {
    console.error('Fetch CFIP_URL error:', error.message);
    return [];
  }
}

// 生成 list 和 sub 信息
async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = ISP;
  const echSuffix = ECH_CONFIG ? `&ech=${encodeURIComponent(ECH_CONFIG)}` : '';
  const vlessEch = (VLESS_ECH && ECH_CONFIG) ? echSuffix : '';
  const vmessEch = (VMESS_ECH && ECH_CONFIG);
  const trojanEch = (TROJAN_ECH && ECH_CONFIG) ? echSuffix : '';
  const fragmentSuffix = `&fragment=${FRAGMENT_PACKETS},${FRAGMENT_LENGTH},${FRAGMENT_INTERVAL}`;
  const vlessFragment = VLESS_FRAGMENT ? fragmentSuffix : '';
  const vmessFragment = VMESS_FRAGMENT;
  const trojanFragment = TROJAN_FRAGMENT ? fragmentSuffix : '';
  const xudpSuffix = '&mux=8&muxType=xudp';
  const vlessXudp = VLESS_XUDP ? xudpSuffix : '';
  const vmessXudp = VMESS_XUDP;
  const trojanXudp = TROJAN_XUDP ? xudpSuffix : '';

  const vlessPath = encodeURIComponent(`${VLESS_PATH}?ed=2560`);
  const trojanPath = encodeURIComponent(`${TROJAN_PATH}?ed=2560`);

  // 生成单个IP的节点组
  function buildNodes(ip, port, name) {
    const nodes = [];
    if (VLESS_ENABLE) {
      nodes.push(`vless://${UUID}@${ip}:${port}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${vlessPath}${vlessEch}${vlessFragment}${vlessXudp}&tfo=1&udp=0#${name}`);
    }
    if (VMESS_ENABLE) {
      const vmessBase = { v: '2', ps: name, add: ip, port: port, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: `${VMESS_PATH}?ed=2560`, tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox', tfo: '1' };
      const vmessObj = Object.assign({}, vmessBase,
        vmessEch ? { ech: ECH_CONFIG } : {},
        vmessFragment ? { fragment: `${FRAGMENT_PACKETS},${FRAGMENT_LENGTH},${FRAGMENT_INTERVAL}` } : {},
        vmessXudp ? { mux: '8', muxType: 'xudp' } : {}
      );
      nodes.push(`vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`);
    }
    if (TROJAN_ENABLE) {
      nodes.push(`trojan://${UUID}@${ip}:${port}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${trojanPath}${trojanEch}${trojanFragment}${trojanXudp}&tfo=1#${name}`);
    }
    return nodes.join('\n');
  }

  // 默认节点
  let subTxt = buildNodes(CFIP, CFPORT, nodeName);

  // 从URL获取额外优选IP
  const cfipList = await fetchCfipList();
  for (const item of cfipList) {
    const ipName = item.remark ? item.remark : `${nodeName}-${item.ip}`;
    subTxt += '\n' + buildNodes(item.ip, item.port, ipName);
  }

  const encoded = Buffer.from(subTxt).toString('base64');
  console.log(encoded);
  fs.writeFileSync(subPath, encoded);
  console.log(`${FILE_PATH}/sub.txt saved successfully`);

  await uploadNodes();
}

// 获取临时隧道domain
async function extractDomains() {
  if (ARGO_AUTH && ARGO_DOMAIN) {
    console.log('ARGO_DOMAIN:', ARGO_DOMAIN);
    await generateLinks(ARGO_DOMAIN);
    return;
  }

  try {
    const fileContent = fs.readFileSync(bootLogPath, 'utf-8');
    const lines = fileContent.split('\n');
    const argoDomains = [];
    lines.forEach((line) => {
      const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
      if (domainMatch) {
        argoDomains.push(domainMatch[1]);
      }
    });

    if (argoDomains.length > 0) {
      console.log('ArgoDomain:', argoDomains[0]);
      await generateLinks(argoDomains[0]);
    } else {
      console.log('ArgoDomain not found, re-running bot to obtain ArgoDomain');
      fs.unlinkSync(bootLogPath);

      try {
        await exec(`pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`);
      } catch (error) {
        // 忽略
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
      try {
        await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
        console.log(`${botName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await extractDomains();
      } catch (error) {
        console.error(`Error executing command: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('Error reading boot.log:', error.message);
  }
}

// 自动上传节点或订阅
async function uploadNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    try {
      const response = await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, {
        subscription: [subscriptionUrl]
      }, { headers: { 'Content-Type': 'application/json' } });

      if (response && response.status === 200) {
        console.log('Subscription uploaded successfully');
      }
    } catch (error) {
      if (error.response && error.response.status !== 400) {
        console.error('Upload subscription error:', error.message);
      }
    }
  } else if (UPLOAD_URL) {
    if (!fs.existsSync(listPath)) return;
    const content = fs.readFileSync(listPath, 'utf-8');
    const nodes = content.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));

    if (nodes.length === 0) return;

    try {
      const response = await axios.post(`${UPLOAD_URL}/api/add-nodes`,
        JSON.stringify({ nodes }),
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (response && response.status === 200) {
        console.log('Nodes uploaded successfully');
      }
    } catch (error) {
      console.error('Upload nodes error:', error.message);
    }
  }
}

// 90s后删除相关文件
function cleanFiles() {
  setTimeout(async () => {
    const filesToDelete = [bootLogPath, configPath, webPath, botPath];

    try {
      await exec(`rm -rf ${filesToDelete.map(f => `"${f}"`).join(' ')} >/dev/null 2>&1`);
    } catch (error) {
      // 忽略删除错误
    }
    console.clear();
    console.log('App is running');
    console.log('Thank you for using this script, enjoy!');
  }, 90000);
}
cleanFiles();

// 自动访问项目URL
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("Skipping adding automatic access task");
    return;
  }

  try {
    await axios.post('https://oooo.serv00.net/add-url', {
      url: PROJECT_URL
    }, { headers: { 'Content-Type': 'application/json' } });
    console.log('automatic access task added successfully');
  } catch (error) {
    console.error(`Add automatic access task failed: ${error.message}`);
  }
}

// 主运行逻辑
async function startserver() {
  argoType();
  deleteNodes();
  cleanupOldFiles();
  generateConfig();
  await downloadFilesAndRun();
  await extractDomains();
  await AddVisitTask();
}

startserver().catch(error => {
  console.error('Unhandled error in startserver:', error);
});

// 动态获取当前 argoDomain
function getArgoDomain() {
  if (ARGO_AUTH && ARGO_DOMAIN) return ARGO_DOMAIN;
  try {
    const lines = fs.readFileSync(bootLogPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

// 动态生成订阅内容
async function buildSubContent() {
  const argoDomain = getArgoDomain();
  if (!argoDomain) return null;

  // 实时读取环境变量
  const uuid = process.env.UUID || UUID;
  const cfip = process.env.CFIP || CFIP;
  const cfport = process.env.CFPORT || CFPORT;
  const vlessPathVal = process.env.VLESS_PATH || VLESS_PATH;
  const vmessPathVal = process.env.VMESS_PATH || VMESS_PATH;
  const trojanPathVal = process.env.TROJAN_PATH || TROJAN_PATH;
  const echConfig = process.env.ECH_CONFIG || '';
  const vlessEchFlag = process.env.VLESS_ECH || '';
  const vmessEchFlag = process.env.VMESS_ECH || '';
  const trojanEchFlag = process.env.TROJAN_ECH || '';
  const fragPackets = process.env.FRAGMENT_PACKETS || FRAGMENT_PACKETS;
  const fragLength = process.env.FRAGMENT_LENGTH || FRAGMENT_LENGTH;
  const fragInterval = process.env.FRAGMENT_INTERVAL || FRAGMENT_INTERVAL;
  const vlessFragFlag = process.env.VLESS_FRAGMENT || '';
  const vmessFragFlag = process.env.VMESS_FRAGMENT || '';
  const trojanFragFlag = process.env.TROJAN_FRAGMENT || '';
  const vlessXudpFlag = process.env.VLESS_XUDP || '';
  const vmessXudpFlag = process.env.VMESS_XUDP || '';
  const trojanXudpFlag = process.env.TROJAN_XUDP || '';

  const ISP = await getMetaInfo();
  const nodeName = ISP;
  const echSuffix = echConfig ? `&ech=${encodeURIComponent(echConfig)}` : '';
  const vlessEch = (vlessEchFlag && echConfig) ? echSuffix : '';
  const vmessEch = (vmessEchFlag && echConfig);
  const trojanEch = (trojanEchFlag && echConfig) ? echSuffix : '';
  const fragmentSuffix = `&fragment=${fragPackets},${fragLength},${fragInterval}`;
  const vlessFragment = vlessFragFlag ? fragmentSuffix : '';
  const vmessFragment = vmessFragFlag;
  const trojanFragment = trojanFragFlag ? fragmentSuffix : '';
  const xudpSuffix = '&mux=8&muxType=xudp';
  const vlessXudp = vlessXudpFlag ? xudpSuffix : '';
  const vmessXudp = vmessXudpFlag;
  const trojanXudp = trojanXudpFlag ? xudpSuffix : '';

  const vlessPathEnc = encodeURIComponent(`${vlessPathVal}?ed=2560`);
  const trojanPathEnc = encodeURIComponent(`${trojanPathVal}?ed=2560`);

  function buildNodes(ip, port, nodename) {
    const vlessEnable = process.env.VLESS_ENABLE !== '0';
    const vmessEnable = process.env.VMESS_ENABLE !== '0';
    const trojanEnable = process.env.TROJAN_ENABLE !== '0';
    const nodes = [];
    if (vlessEnable) {
      nodes.push(`vless://${uuid}@${ip}:${port}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${vlessPathEnc}${vlessEch}${vlessFragment}${vlessXudp}&tfo=1&udp=0#${nodename}`);
    }
    if (vmessEnable) {
      const vmessBase = { v: '2', ps: nodename, add: ip, port: port, id: uuid, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: `${vmessPathVal}?ed=2560`, tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox', tfo: '1' };
      const vmessObj = Object.assign({}, vmessBase,
        vmessEch ? { ech: echConfig } : {},
        vmessFragment ? { fragment: `${fragPackets},${fragLength},${fragInterval}` } : {},
        vmessXudp ? { mux: '8', muxType: 'xudp' } : {}
      );
      nodes.push(`vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`);
    }
    if (trojanEnable) {
      nodes.push(`trojan://${uuid}@${ip}:${port}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${trojanPathEnc}${trojanEch}${trojanFragment}${trojanXudp}&tfo=1#${nodename}`);
    }
    return nodes.join('\n');
  }

  let subTxt = buildNodes(cfip, cfport, nodeName);
  const cfipList = await fetchCfipList();
  for (const item of cfipList) {
    const ipName = item.remark ? item.remark : `${nodeName}-${item.ip}`;
    subTxt += '\n' + buildNodes(item.ip, item.port, ipName);
  }
  return Buffer.from(subTxt).toString('base64');
}

// mihomo 专用订阅路由(YAML proxies 格式, 支持 ech/fragment/tfo/xudp)
app.get(`/${SUB_PATH}/mihomo`, async (req, res) => {
  res.set('Content-Type', 'text/yaml; charset=utf-8');
  const argoDomain = getArgoDomain();
  if (!argoDomain) return res.status(503).send('Subscription not ready');

  const uuid = process.env.UUID || UUID;
  const cfip = process.env.CFIP || CFIP;
  const cfport = process.env.CFPORT || CFPORT;
  const vlessPathVal = process.env.VLESS_PATH || VLESS_PATH;
  const vmessPathVal = process.env.VMESS_PATH || VMESS_PATH;
  const trojanPathVal = process.env.TROJAN_PATH || TROJAN_PATH;
  const vlessEnable = process.env.VLESS_ENABLE !== '0';
  const vmessEnable = process.env.VMESS_ENABLE !== '0';
  const trojanEnable = process.env.TROJAN_ENABLE !== '0';
  const echConfig = process.env.ECH_CONFIG || ECH_CONFIG || '';
  const vlessEchFlag = process.env.VLESS_ECH || VLESS_ECH;
  const vmessEchFlag = process.env.VMESS_ECH || VMESS_ECH;
  const trojanEchFlag = process.env.TROJAN_ECH || TROJAN_ECH;
  const fragPackets = process.env.FRAGMENT_PACKETS || FRAGMENT_PACKETS;
  const fragLength = process.env.FRAGMENT_LENGTH || FRAGMENT_LENGTH;
  const fragInterval = process.env.FRAGMENT_INTERVAL || FRAGMENT_INTERVAL;
  const vlessFragFlag = process.env.VLESS_FRAGMENT || VLESS_FRAGMENT;
  const vmessFragFlag = process.env.VMESS_FRAGMENT || VMESS_FRAGMENT;
  const trojanFragFlag = process.env.TROJAN_FRAGMENT || TROJAN_FRAGMENT;

  let echDomain = '';
  if (echConfig && echConfig.includes('+')) {
    echDomain = echConfig.split('+')[0];
  }

  const ISP = await getMetaInfo();
  const proxies = [];

  function echBlock(flag) {
    if (!flag || !echConfig) return '';
    return `\n  ech-opts:\n    enable: true\n    query-server-name: ${echDomain}`;
  }
  function fragBlock(flag) {
    if (!flag) return '';
    return `\n  fragment:\n    packets: ${fragPackets}\n    length: ${fragLength}\n    interval: ${fragInterval}`;
  }

  function addNodes(ip, port, name) {
    if (vlessEnable) {
      proxies.push(`- name: "${name}-vless"\n  type: vless\n  server: ${ip}\n  port: ${port}\n  uuid: ${uuid}\n  tfo: true\n  tls: true\n  network: ws\n  servername: ${argoDomain}\n  client-fingerprint: firefox\n  packet-encoding: xudp\n  ws-opts:\n    path: "${vlessPathVal}?ed=2560"\n    headers:\n      Host: ${argoDomain}${echBlock(vlessEchFlag)}${fragBlock(vlessFragFlag)}`);
    }
    if (vmessEnable) {
      proxies.push(`- name: "${name}-vmess"\n  type: vmess\n  server: ${ip}\n  port: ${port}\n  uuid: ${uuid}\n  alterId: 0\n  cipher: auto\n  tfo: true\n  tls: true\n  network: ws\n  servername: ${argoDomain}\n  client-fingerprint: firefox\n  packet-encoding: xudp\n  ws-opts:\n    path: "${vmessPathVal}?ed=2560"\n    headers:\n      Host: ${argoDomain}${echBlock(vmessEchFlag)}${fragBlock(vmessFragFlag)}`);
    }
    if (trojanEnable) {
      proxies.push(`- name: "${name}-trojan"\n  type: trojan\n  server: ${ip}\n  port: ${port}\n  password: ${uuid}\n  tfo: true\n  network: ws\n  sni: ${argoDomain}\n  client-fingerprint: firefox\n  ws-opts:\n    path: "${trojanPathVal}?ed=2560"\n    headers:\n      Host: ${argoDomain}${echBlock(trojanEchFlag)}${fragBlock(trojanFragFlag)}`);
    }
  }

  if (cfip) addNodes(cfip, cfport, ISP);
  const cfipList = await fetchCfipList();
  for (const item of cfipList) {
    const ipName = item.remark || `${ISP}-${item.ip}`;
    addNodes(item.ip, item.port, ipName);
  }
  res.send(`proxies:\n${proxies.map(p => p.replace(/^/gm, '  ')).join('\n')}\n`);
});

// Shadowrocket 专用订阅路由 —— 小火箭原生 obfs=websocket URL 格式
// 字段对照(基于真实可用样本):
//   vless://base64(":uuid@ip:port")?path=...&remarks=...&obfsParam=域名
//     &obfs=websocket&tls=1&peer=域名&tfo=1
//     &fragment=1,length,interval,packets    ← 分片(注意顺序)
//     &ech=域名%2BDoH地址                    ← ECH(只把 + 转成 %2B)
//   path 编码: 仅 ? → %3F、= → %3D, 斜杠保留
//   注: XUDP 不通过 URL 参数自动启用, 需在节点 ⓘ 里手动选择
app.get(`/${SUB_PATH}/shadowrocket`, async (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  const argoDomain = getArgoDomain();
  if (!argoDomain) return res.status(503).send('Subscription not ready');

  const uuid = process.env.UUID || UUID;
  const cfip = process.env.CFIP || CFIP;
  const cfport = process.env.CFPORT || CFPORT;
  const vlessPathVal = process.env.VLESS_PATH || VLESS_PATH;
  const echConfig = process.env.ECH_CONFIG || '';
  const vlessEchFlag = process.env.VLESS_ECH || '';
  const fragPackets = process.env.FRAGMENT_PACKETS || FRAGMENT_PACKETS;
  const fragLength = process.env.FRAGMENT_LENGTH || FRAGMENT_LENGTH;
  const fragInterval = process.env.FRAGMENT_INTERVAL || FRAGMENT_INTERVAL;
  const vlessFragFlag = process.env.VLESS_FRAGMENT || '';

  const ISP = await getMetaInfo();
  // 路径只把 ? 和 = 转义, 保留 /  (与小火箭样本一致)
  const vlessPathEnc = `${vlessPathVal}?ed=2560`.replace(/\?/g, '%3F').replace(/=/g, '%3D');
  const echParam = (vlessEchFlag && echConfig) ? `&ech=${echConfig.replace(/\+/g, '%2B')}` : '';
  const fragParam = vlessFragFlag ? `&fragment=1,${fragLength},${fragInterval},${fragPackets}` : '';

  function buildSRNode(ip, port, nodename) {
    const b64 = Buffer.from(`:${uuid}@${ip}:${port}`).toString('base64');
    return `vless://${b64}?path=${vlessPathEnc}&remarks=${encodeURIComponent(nodename)}&obfsParam=${argoDomain}&obfs=websocket&tls=1&peer=${argoDomain}&tfo=1${fragParam}${echParam}`;
  }

  let nodes = buildSRNode(cfip, cfport, ISP);
  const cfipList = await fetchCfipList();
  for (const item of cfipList) {
    const ipName = item.remark ? item.remark : `${ISP}-${item.ip}`;
    nodes += '\n' + buildSRNode(item.ip, item.port, ipName);
  }
  res.send(nodes);
});

app.get(`/${SUB_PATH}`, async (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  const content = await buildSubContent();
  if (content) {
    res.send(content);
  } else {
    res.status(503).send('Subscription not ready');
  }
});

// 根路由
app.get("/", async function (req, res) {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const data = await fs.promises.readFile(filePath, 'utf8');
    res.send(data);
  } catch (err) {
    res.send("Hello world!<br><br>You can access /{SUB_PATH}(Default: /sub) to get your nodes!");
  }
});

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));
