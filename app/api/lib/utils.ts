/**
 * 股票 API 共享工具
 */
import https from 'https';

/**
 * GET 请求，返回 Buffer（用于 GBK 编码响应）
 */
export function httpGetBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.qq.com/',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      secureProtocol: 'TLSv1_2_method',
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * GET 请求，返回字符串
 */
export function httpGetText(url: string): Promise<string> {
  return httpGetBuffer(url).then(b => b.toString('utf8'));
}

/**
 * 转换代码格式
 * 000001.SZ -> sz000001
 * 600000.SH -> sh600000
 * 830946.BJ -> bj830946
 */
export function toQqCode(code: string): string {
  if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `bj${code.replace('.BJ', '')}`;
  return `sz${code}`;
}

/**
 * 转换代码格式
 * sz000001 -> 000001.SZ
 * sh600000 -> 600000.SH
 */
export function fromQqCode(qqCode: string): string {
  if (qqCode.startsWith('sh')) return `${qqCode.slice(2)}.SH`;
  if (qqCode.startsWith('sz')) return `${qqCode.slice(2)}.SZ`;
  if (qqCode.startsWith('bj')) return `${qqCode.slice(2)}.BJ`;
  return qqCode;
}
