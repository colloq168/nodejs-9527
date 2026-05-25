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
const CFIP = process.env.CFIP || 'saas.sin.fan';           // 节点优选域名或优选ip
const CFPORT = process.env.CFPORT || 443;                   // 节点优选域名或优选ip对应的端口
const NAME = process.env.NAME || 'Northflank';              // 节点名称
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

// 生成 list 和 sub 信息
async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
  const echSuffix = ECH_CONFIG ? `&ech=1&ech-config=${encodeURIComponent(ECH_CONFIG)}` : '';
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

  const VMESS = { v: '2', ps: nodeName, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: `${VMESS_PATH}?ed=2560`, tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox' };
  const vmessObj = Object.assign({}, VMESS,
    vmessEch ? { ech: '1', 'ech-config': ECH_CONFIG } : {},
    vmessFragment ? { fragment: `${FRAGMENT_PACKETS},${FRAGMENT_LENGTH},${FRAGMENT_INTERVAL}` } : {},
    vmessXudp ? { mux: '8', muxType: 'xudp' } : {}
  );

  const vlessPath = encodeURIComponent(`${VLESS_PATH}?ed=2560`);
  const trojanPath = encodeURIComponent(`${TROJAN_PATH}?ed=2560`);
  const subTxt = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${vlessPath}${vlessEch}${vlessFragment}${vlessXudp}#${nodeName}
vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}
trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${trojanPath}${trojanEch}${trojanFragment}${trojanXudp}#${nodeName}`;

  const encoded = Buffer.from(subTxt).toString('base64');
  console.log(encoded);
  fs.writeFileSync(subPath, encoded);
  console.log(`${FILE_PATH}/sub.txt saved successfully`);

  await uploadNodes();

  // 注册订阅路由
  app.get(`/${SUB_PATH}`, (req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(Buffer.from(subTxt).toString('base64'));
  });
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
