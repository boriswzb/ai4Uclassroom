/**
 * 数据源管理器
 * 支持 TuShare、Akshare、CSV 和模拟数据
 * 参考 VeighNa 的数据层设计
 */

import { KBar, TickData, DataSource, DataSourceType, RealtimeQuote, NewsItem, Announcement, AlertItem, ResearchReport, SentimentIndex } from '../types';

// ==================== TuShare 数据源 ====================

class TuShareDataSource implements DataSource {
  name = 'TuShare';
  private token: string = '';

  async connect(): Promise<void> {
    // TuShare 需要 token，这里使用免费接口
    // 生产环境应使用 pro_api(token)
    console.log('[TuShare] 连接数据源...');
  }

  async disconnect(): Promise<void> {
    console.log('[TuShare] 断开连接');
  }

  async getKBar(code: string, start: number, end: number): Promise<KBar[]> {
    // 使用 TuShare 免费接口获取日K线
    const url = `http://api.waditu.com/v1`;
    const body = {
      api_name: 'daily',
      token: this.token,
      params: { ts_code: code, start_date: this.formatDate(start), end_date: this.formatDate(end) },
      fields: 'ts_code,trade_date,open,high,low,close,vol,amount'
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      return this.parseKBar(code, data);
    } catch (error) {
      console.error('[TuShare] 获取K线失败:', error);
      return this.generateMockKBar(code, start, end);
    }
  }

  async getTick(code: string, date: number): Promise<TickData[]> {
    return this.generateMockTicks(code, date);
  }

  async getStockList(): Promise<string[]> {
    return [
      '000001.SZ', '000002.SZ', '000004.SZ', '000005.SZ', '000006.SZ',
      '000007.SZ', '000008.SZ', '000009.SZ', '000010.SZ', '000011.SZ',
      '600000.SH', '600001.SH', '600004.SH', '600005.SH', '600006.SH',
      '600007.SH', '600008.SH', '600009.SH', '600010.SH', '600011.SH',
    ];
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10).replace(/-/g, '');
  }

  private parseKBar(code: string, data: any): KBar[] {
    if (!data.data || !data.data.items) return [];
    return data.data.items.map((item: any) => ({
      code,
      timestamp: new Date(item.trade_date).getTime(),
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.vol),
      amount: parseFloat(item.amount) || 0
    })).reverse();
  }

  private generateMockKBar(code: string, start: number, end: number): KBar[] {
    const kbars: KBar[] = [];
    let price = 10 + Math.random() * 40;
    let current = start;

    while (current <= end) {
      const dayMs = 24 * 60 * 60 * 1000;
      const change = (Math.random() - 0.48) * 0.03;
      const open = price;
      const close = price * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.02);
      const low = Math.min(open, close) * (1 - Math.random() * 0.02);

      const dayOfWeek = new Date(current).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        kbars.push({
          code,
          timestamp: current,
          open,
          high,
          low,
          close,
          volume: Math.floor(Math.random() * 100000000) + 10000000,
          amount: close * Math.floor(Math.random() * 100000000)
        });
      }

      price = close;
      current += dayMs;
    }
    return kbars;
  }

  private generateMockTicks(code: string, date: number): TickData[] {
    const ticks: TickData[] = [];
    const basePrice = 10 + Math.random() * 50;
    let currentPrice = basePrice;
    const startTime = new Date(date).setHours(9, 30, 0, 0);

    for (let i = 0; i < 240; i++) {
      currentPrice *= (1 + (Math.random() - 0.5) * 0.002);
      ticks.push({
        code,
        timestamp: startTime + i * 60000,
        lastPrice: currentPrice,
        volume: Math.floor(Math.random() * 10000),
        amount: currentPrice * Math.floor(Math.random() * 10000),
        bidPrice1: currentPrice - 0.01,
        askPrice1: currentPrice + 0.01,
        bidVol1: Math.floor(Math.random() * 1000),
        askVol1: Math.floor(Math.random() * 1000)
      });
    }
    return ticks;
  }
}

// ==================== Akshare 数据源 ====================

class AkshareDataSource implements DataSource {
  name = 'Akshare';
  private baseUrl = 'https://push2.eastmoney.com';

  async connect(): Promise<void> {
    console.log('[Akshare] 连接数据源...');
  }

  async disconnect(): Promise<void> {
    console.log('[Akshare] 断开连接');
  }

  async getKBar(code: string, start: number, end: number): Promise<KBar[]> {
    const startStr = new Date(start).toISOString().slice(0, 10).replace(/-/g, '');
    const endStr = new Date(end).toISOString().slice(0, 10).replace(/-/g, '');

    // 尝试本地 API 代理
    try {
      const response = await fetch(`/api/stock/kline?code=${code}&start=${startStr}&end=${endStr}`);
      const json = await response.json();
      if (json.success && json.data && json.data.length > 0) {
        return json.data;
      }
    } catch (_) {}

    // 回退：浏览器直接调用腾讯行情 K 线
    return this.fetchKLineDirect(code);
  }

  private async fetchKLineDirect(code: string): Promise<KBar[]> {
    const qqPrefix = this.convertToQQPrefix(code);
    const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_day&param=${qqPrefix},day,,,100`;

    try {
      const response = await fetch(url, { headers: { Referer: 'https://finance.qq.com' } });
      const text = await response.text();
      // 返回格式: kline_day={json}
      const jsonStr = text.split('=', 1)[1] || '{}';
      const json = JSON.parse(jsonStr);
      return this.parseTencentKBar(code, json);
    } catch (error) {
      console.error('[Akshare] 直接获取K线失败:', error);
      return this.generateMockKBar(code, Date.now() - 365 * 24 * 60 * 60 * 1000, Date.now());
    }
  }

  private parseTencentKBar(code: string, json: any): KBar[] {
    try {
      const prefix = code.replace('.', '').toLowerCase();
      const data = json.data && json.data[prefix];
      if (!data || !data.day || !Array.isArray(data.day)) return [];
      return data.day.map((bar: string[]) => ({
        code,
        timestamp: new Date(bar[0]).getTime(),
        open: parseFloat(bar[1]),
        high: parseFloat(bar[3]),
        low: parseFloat(bar[4]),
        close: parseFloat(bar[2]),
        volume: parseFloat(bar[5]),
        amount: 0
      }));
    } catch (e) {
      console.error('[Akshare] 解析腾讯K线失败:', e);
      return [];
    }
  }

  async getTick(code: string, date: number): Promise<TickData[]> {
    return this.generateMockTicks(code, date);
  }

  async getStockList(): Promise<string[]> {
    return [
      '000001.SZ', '000002.SZ', '000004.SZ', '000005.SZ', '000006.SZ',
      '600000.SH', '600001.SH', '600004.SH', '600005.SH', '600006.SH',
    ];
  }

  async getRealtimeQuote(codes: string[]): Promise<RealtimeQuote[]> {
    // 尝试本地 API 代理 (同域，无 CORS 问题)
    try {
      const response = await fetch(`/api/stock/realtime?codes=${codes.join(',')}`);
      const json = await response.json();
      if (json.success && json.data && json.data.length > 0) {
        return json.data;
      }
    } catch (_) {}

    // 回退：浏览器直接调用腾讯行情 (CORS: access-control-allow-origin: *)
    return this.fetchRealtimeDirect(codes);
  }

  private async fetchRealtimeDirect(codes: string[]): Promise<RealtimeQuote[]> {
    const qqCodes = codes.map(c => {
      if (c.endsWith('.SH')) return `sh${c.replace('.SH', '')}`;
      if (c.endsWith('.SZ')) return `sz${c.replace('.SZ', '')}`;
      return `sz${c}`;
    }).join(',');
    const url = `https://qt.gtimg.cn/q=${qqCodes}`;

    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buffer);
      return this.parseTencentQuote(text, codes);
    } catch (error) {
      console.error('[Akshare] 直接获取实时行情失败:', error);
      return this.generateMockQuotes(codes);
    }
  }

  // 腾讯实时行情字段 (v_sh600000="1~名称~代码~现价~昨收~今开~成交量~...~最高~最低~...~涨跌额~涨跌幅~时间")
  private parseTencentQuote(text: string, codes: string[]): RealtimeQuote[] {
    const quotes: RealtimeQuote[] = [];
    const blocks = text.split(';').filter(b => b.includes('="'));
    for (const block of blocks) {
      const fields = block.split('~');
      if (fields.length < 35) continue;
      const rawCode = fields[2].trim(); // e.g. "600000"
      const name = fields[1].trim();    // e.g. "浦发银行"
      const price = parseFloat(fields[3]) || 0;
      const yesterday = parseFloat(fields[4]) || 0; // 昨收
      const open = parseFloat(fields[5]) || 0;
      const volume = parseFloat(fields[6]) || 0;     // 成交量（手）
      const high = parseFloat(fields[33]) || 0;      // 最高
      const low = parseFloat(fields[34]) || 0;       // 最低
      const change = parseFloat(fields[31]) || 0;    // 涨跌
      const changePercent = parseFloat(fields[32]) || 0; // 涨跌幅%
      const amount = parseFloat(fields[37]) || 0;     // 成交额

      // 反查原始 code 格式
      const code = codes.find(c => {
        const num = c.replace('.SZ', '').replace('.SH', '');
        return rawCode === num || rawCode === num.padStart(6, '0');
      }) || rawCode;

      quotes.push({
        code,
        name,
        price,
        change,
        changePercent,
        open,
        high,
        low,
        volume,
        amount,
        timestamp: Date.now()
      });
    }
    return quotes;
  }

  private generateMockQuotes(codes: string[]): RealtimeQuote[] {
    return codes.map(code => ({
      code,
      name: code,
      price: 10 + Math.random() * 20,
      change: (Math.random() - 0.5) * 2,
      changePercent: (Math.random() - 0.5) * 6,
      open: 10 + Math.random() * 20,
      high: 10 + Math.random() * 20,
      low: 10 + Math.random() * 20,
      volume: Math.floor(Math.random() * 100000000),
      amount: Math.floor(Math.random() * 1000000000),
      timestamp: Date.now()
    }));
  }

  private convertToQQPrefix(code: string): string {
    // 腾讯行情前缀: sh600000 / sz000001
    if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
    if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
    return `sz${code}`;
  }

  private convertToEastmoneyId(code: string): string {
    // 东方财富 secid 格式: 市场代码.股票代码
    if (code.endsWith('.SH')) return `1.${code.replace('.SH', '')}`;
    if (code.endsWith('.SZ')) return `0.${code.replace('.SZ', '')}`;
    return `0.${code}`;
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10).replace(/-/g, '');
  }

  private parseKBar(code: string, data: any): KBar[] {
    if (!data.data || !data.data.klines) return [];
    return data.data.klines.map((line: string) => {
      const parts = line.split(',');
      return {
        code,
        timestamp: new Date(parts[0]).getTime(),
        open: parseFloat(parts[1]),
        high: parseFloat(parts[2]),
        low: parseFloat(parts[3]),
        close: parseFloat(parts[4]),
        volume: parseFloat(parts[5]),
        amount: parseFloat(parts[6]) || 0
      };
    });
  }

  private generateMockTicks(code: string, date: number): TickData[] {
    const ticks: TickData[] = [];
    const basePrice = 10 + Math.random() * 50;
    let currentPrice = basePrice;
    const startTime = new Date(date).setHours(9, 30, 0, 0);

    for (let i = 0; i < 240; i++) {
      currentPrice *= (1 + (Math.random() - 0.5) * 0.002);
      ticks.push({
        code,
        timestamp: startTime + i * 60000,
        lastPrice: currentPrice,
        volume: Math.floor(Math.random() * 10000),
        amount: currentPrice * Math.floor(Math.random() * 10000),
        bidPrice1: currentPrice - 0.01,
        askPrice1: currentPrice + 0.01,
        bidVol1: Math.floor(Math.random() * 1000),
        askVol1: Math.floor(Math.random() * 1000)
      });
    }
    return ticks;
  }

  private generateMockKBar(code: string, start: number, end: number): KBar[] {
    const kbars: KBar[] = [];
    let price = 10 + Math.random() * 40;
    let current = start;

    while (current <= end) {
      const dayMs = 24 * 60 * 60 * 1000;
      const change = (Math.random() - 0.48) * 0.03;
      const open = price;
      const close = price * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.02);
      const low = Math.min(open, close) * (1 - Math.random() * 0.02);

      const dayOfWeek = new Date(current).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        kbars.push({
          code,
          timestamp: current,
          open,
          high,
          low,
          close,
          volume: Math.floor(Math.random() * 100000000) + 10000000,
          amount: close * Math.floor(Math.random() * 100000000)
        });
      }

      price = close;
      current += dayMs;
    }
    return kbars;
  }
}

// ==================== CSV 数据源 (回测用) ====================

class CSVDataSource implements DataSource {
  name = 'CSV';
  private dataDir: string;

  constructor(dataDir: string = '/data/csv') {
    this.dataDir = dataDir;
  }

  async connect(): Promise<void> {
    console.log('[CSV] 连接数据源...');
  }

  async disconnect(): Promise<void> {
    console.log('[CSV] 断开连接');
  }

  async getKBar(code: string, start: number, end: number): Promise<KBar[]> {
    // 实际实现应从CSV文件读取
    // 这里生成模拟数据
    return this.generateMockKBar(code, start, end);
  }

  async getTick(code: string, date: number): Promise<TickData[]> {
    return this.generateMockTicks(code, date);
  }

  async getStockList(): Promise<string[]> {
    return [];
  }

  private generateMockTicks(code: string, date: number): TickData[] {
    const ticks: TickData[] = [];
    const basePrice = 15;
    let currentPrice = basePrice;
    const startTime = new Date(date).setHours(9, 30, 0, 0);

    for (let i = 0; i < 240; i++) {
      currentPrice *= (1 + (Math.random() - 0.5) * 0.002);
      ticks.push({
        code,
        timestamp: startTime + i * 60000,
        lastPrice: currentPrice,
        volume: Math.floor(Math.random() * 10000),
        amount: currentPrice * Math.floor(Math.random() * 10000),
        bidPrice1: currentPrice - 0.01,
        askPrice1: currentPrice + 0.01,
        bidVol1: Math.floor(Math.random() * 1000),
        askVol1: Math.floor(Math.random() * 1000)
      });
    }
    return ticks;
  }

  private generateMockKBar(code: string, start: number, end: number): KBar[] {
    const kbars: KBar[] = [];
    let price = 10 + Math.random() * 40;
    let current = start;

    while (current <= end) {
      const dayMs = 24 * 60 * 60 * 1000;
      const change = (Math.random() - 0.48) * 0.03;
      const open = price;
      const close = price * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.02);
      const low = Math.min(open, close) * (1 - Math.random() * 0.02);

      const dayOfWeek = new Date(current).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        kbars.push({
          code,
          timestamp: current,
          open,
          high,
          low,
          close,
          volume: Math.floor(Math.random() * 100000000) + 10000000,
          amount: close * Math.floor(Math.random() * 100000000)
        });
      }

      price = close;
      current += dayMs;
    }
    return kbars;
  }
}

// ==================== 模拟数据源 (测试用) ====================

class MockDataSource implements DataSource {
  name = 'Mock';
  private codes: string[];

  constructor(codes: string[] = ['000001.SZ', '600000.SH']) {
    this.codes = codes;
  }

  async connect(): Promise<void> {
    console.log('[Mock] 连接模拟数据源...');
  }

  async disconnect(): Promise<void> {
    console.log('[Mock] 断开模拟数据源');
  }

  async getKBar(code: string, start: number, end: number): Promise<KBar[]> {
    return this.generateMockKBar(code, start, end);
  }

  async getTick(code: string, date: number): Promise<TickData[]> {
    return this.generateMockTicks(code, date);
  }

  async getStockList(): Promise<string[]> {
    return this.codes;
  }

  async getRealtimeQuote(codes: string[]): Promise<RealtimeQuote[]> {
    return this.generateMockQuotes(codes);
  }

  private generateMockQuotes(codes: string[]): RealtimeQuote[] {
    return codes.map(code => {
      const price = 10 + Math.random() * 20;
      const change = (Math.random() - 0.5) * 2;
      const prevClose = price - change;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      return {
        code,
        name: code,
        price,
        change,
        changePercent,
        open: price - Math.random(),
        high: price + Math.random(),
        low: price - Math.random(),
        volume: Math.floor(Math.random() * 100000000),
        amount: Math.floor(Math.random() * 1000000000),
        timestamp: Date.now()
      };
    });
  }

  private generateMockKBar(code: string, start: number, end: number): KBar[] {
    const kbars: KBar[] = [];
    let price = 10 + Math.random() * 40;
    let current = start;

    while (current <= end) {
      const dayMs = 24 * 60 * 60 * 1000;
      const change = (Math.random() - 0.48) * 0.03; // 轻微上涨偏向
      const open = price;
      const close = price * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.02);
      const low = Math.min(open, close) * (1 - Math.random() * 0.02);

      // 跳过周末
      const dayOfWeek = new Date(current).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        kbars.push({
          code,
          timestamp: current,
          open,
          high,
          low,
          close,
          volume: Math.floor(Math.random() * 100000000) + 10000000,
          amount: close * Math.floor(Math.random() * 100000000)
        });
      }

      price = close;
      current += dayMs;
    }
    return kbars;
  }

  private generateMockTicks(code: string, date: number): TickData[] {
    const ticks: TickData[] = [];
    const basePrice = 15 + Math.random() * 30;
    let currentPrice = basePrice;
    const startTime = new Date(date).setHours(9, 30, 0, 0);

    for (let i = 0; i < 240; i++) {
      currentPrice *= (1 + (Math.random() - 0.5) * 0.003);
      ticks.push({
        code,
        timestamp: startTime + i * 60000,
        lastPrice: currentPrice,
        volume: Math.floor(Math.random() * 50000),
        amount: currentPrice * Math.floor(Math.random() * 50000),
        bidPrice1: parseFloat((currentPrice - 0.01).toFixed(2)),
        askPrice1: parseFloat((currentPrice + 0.01).toFixed(2)),
        bidVol1: Math.floor(Math.random() * 5000) + 100,
        askVol1: Math.floor(Math.random() * 5000) + 100
      });
    }
    return ticks;
  }
}

// ==================== 数据源管理器 ====================

export class DataSourceManager {
  private sources: Map<DataSourceType, DataSource> = new Map();
  private activeSource: DataSource | null = null;

  constructor() {
    this.registerSource('mock', new MockDataSource());
    this.registerSource('csv', new CSVDataSource());
  }

  registerSource(type: DataSourceType, source: DataSource): void {
    this.sources.set(type, source);
  }

  async setActiveSource(type: DataSourceType): Promise<void> {
    let source = this.sources.get(type);
    if (!source) {
      switch (type) {
        case 'tushare':
          source = new TuShareDataSource();
          break;
        case 'akshare':
          source = new AkshareDataSource();
          break;
        case 'csv':
          source = new CSVDataSource();
          break;
        case 'mock':
        default:
          source = new MockDataSource();
      }
      this.sources.set(type, source);
    }
    this.activeSource = source;
    await source.connect();
  }

  getActiveSource(): DataSource | null {
    return this.activeSource;
  }

  async getKBar(code: string, start: number, end: number): Promise<KBar[]> {
    if (!this.activeSource) {
      await this.setActiveSource('mock');
    }
    return this.activeSource!.getKBar(code, start, end);
  }

  async getTick(code: string, date: number): Promise<TickData[]> {
    if (!this.activeSource) {
      await this.setActiveSource('mock');
    }
    return this.activeSource!.getTick(code, date);
  }

  async getStockList(): Promise<string[]> {
    if (!this.activeSource) {
      await this.setActiveSource('mock');
    }
    return this.activeSource!.getStockList();
  }

  async getRealtimeQuote(codes: string[]): Promise<RealtimeQuote[]> {
    if (!this.activeSource) {
      await this.setActiveSource('mock');
    }
    const source = this.activeSource!;
    if (source.getRealtimeQuote) {
      return source.getRealtimeQuote(codes);
    }
    // fallback to mock
    return new MockDataSource().getRealtimeQuote?.(codes) || [];
  }

  async disconnect(): Promise<void> {
    if (this.activeSource) {
      await this.activeSource.disconnect();
    }
  }
}

// 导出单例
export const dataSourceManager = new DataSourceManager();
