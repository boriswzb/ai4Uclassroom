'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  MODEL_PRESETS,
  HARDWARE_PRESETS,
  PHASE_CONFIGS,
  DEEPSEEK_VALIDATIONS,
  calculateTrainingCompute,
  recommendParallelism,
  calcModelParams,
  backCalculateMFU,
  formatNumber,
  formatParams,
  formatTime,
  formatBytes,
  calcMaxBatchSize,
  calcMinGpus,
  type ModelConfig,
  type HardwareConfig,
  type ParallelConfig,
  type TrainingConfig,
  type CalculationResult,
  type DeepSeekValidationData,
} from '@/lib/ai-calculator';

// ============================================================
// Types
// ============================================================

interface FormState {
  model: ModelConfig;
  hardware: HardwareConfig;
  training: TrainingConfig;
  parallel: ParallelConfig;
  totalGpus: number;
}

// ============================================================
// Main Component
// ============================================================

export default function AITrainingCalculator() {
  const [modelIdx, setModelIdx] = useState(1);  // Qwen2.5-72B (Dense 默认)
  const [hardwareIdx, setHardwareIdx] = useState(5);  // Ascend 950DT/850E
  const [phase, setPhase] = useState<TrainingConfig['phase']>('pretrain');
  const [totalGpus, setTotalGpus] = useState(64);    // 64 GPUs for Qwen2.5-72B
  const [autoParallel, setAutoParallel] = useState(true);
  const [calcMode, setCalcMode] = useState<'dense' | 'moe'>('dense');  // Dense vs MoE tab (默认 Dense)
  
  // Set browser tab title
  useEffect(() => {
    document.title = 'AI算力计算器';
  }, []);

  // === Model-aware defaults: when model changes, auto-adjust defaults ===
  useEffect(() => {
    const m = MODEL_PRESETS[modelIdx];
    if (m.paperTokens) setNumTokens(m.paperTokens);
    // 72B 默认用较小数据量（100B tokens）
    if (m.name.includes('72B')) setNumTokens(100);
    if (m.paperPrecision && (m.paperPrecision === 'bf16' || m.paperPrecision === 'fp8')) {
      setPrecision(m.paperPrecision);
    }
    // FP8 ratio defaults based on paper
    if (m.paperPrecision === 'fp8') {
      setFp8Ratio(0.80);
    } else {
      setFp8Ratio(0);
    }
    // Batch size & MoE: very different regimes
    if (m.type === 'dense') {
      // Dense models: batch scales with model size
      if (m.name.includes('72B')) {
        setBatchSize(32);    // 72B-class 大模型，极小 batch（参考 NeMo 配置）
      } else if ((m.hiddenSize || 0) <= 4096) {
        setBatchSize(2048);  // 7B-class
      } else if ((m.hiddenSize || 0) <= 6144) {
        setBatchSize(1024);  // 14B-20B
      } else {
        setBatchSize(512);   // 32B
      }
      setMfu(0.45);  // Dense typically higher MFU (no expert imbalance)
    } else {
      // MoE models
      if (m.name.includes('V3')) {
        setBatchSize(15360);
        setMfu(0.406);
      } else if (m.name.includes('V2')) {
        setBatchSize(9216);
        setMfu(0.38);
      } else {
        setBatchSize(4096);
        setMfu(0.40);
      }
    }
    // GPU count: reasonable for model
    if (m.type === 'dense') {
      if ((m.hiddenSize || 0) <= 4096) setTotalGpus(8);
      else if ((m.hiddenSize || 0) <= 6144) setTotalGpus(32);
      else setTotalGpus(64);
    } else {
      setTotalGpus(2048);
    }
    // Training seqLen: use model's natural context for short-context models,
    // but cap long-context models (131K) at 4K for typical pre-training
    if (m.seqLen <= 8192) {
      setTrainSeqLen(m.seqLen);  // Use model's native seqLen (e.g. DS-V3=4096)
    } else {
      setTrainSeqLen(4096);  // Long context models train with shorter sequences
    }
  }, [modelIdx]);

  // When user switches tab via top tabs, ensure model matches tab type
  // Preferred defaults per tab: Dense → 72B, MoE → DeepSeek-V3
  useEffect(() => {
    if (MODEL_PRESETS[modelIdx]?.type !== calcMode) {
      const preferredIdx = calcMode === 'dense'
        ? MODEL_PRESETS.findIndex((m) => m.name.includes('72B'))
        : MODEL_PRESETS.findIndex((m) => m.name.includes('V3'));
      const fallbackIdx = MODEL_PRESETS.findIndex((m) => m.type === calcMode);
      const idx = preferredIdx >= 0 ? preferredIdx : fallbackIdx;
      if (idx >= 0) setModelIdx(idx);
    }
  }, [calcMode]);
  
  // Manual parallelism overrides
  const [tp, setTp] = useState(8);
  const [pp, setPp] = useState(8);
  const [dp, setDp] = useState(32);
  const [microBatch, setMicroBatch] = useState(1);
  const [recompute, setRecompute] = useState<ParallelConfig['optimizationStrategy']>('selective_recompute');
  
  // Dirty tracking — detects when params change since last calc
  const [calcSignature, setCalcSignature] = useState('');
  const [calcTimestamp, setCalcTimestamp] = useState(0);
  
  // Training config — Qwen2.5-72B defaults (initial state matches useEffect target)
  const [batchSize, setBatchSize] = useState(32);    // 72B-class GBS
  const [numTokens, setNumTokens] = useState(100);   // 100B tokens
  const [epochs, setEpochs] = useState(1);
  const [mfu, setMfu] = useState(0.45);              // Dense 典型 MFU
  const [fp8Ratio, setFp8Ratio] = useState(0);
  const [clusterUptime, setClusterUptime] = useState(0.93);
  const [gradAccumSteps, setGradAccumSteps] = useState(4);
  const [paperMode, setPaperMode] = useState(false);
  const [precision, setPrecision] = useState<TrainingConfig['precision']>('bf16');
  const [trainSeqLen, setTrainSeqLen] = useState(4096);  // 训练序列长度（与模型最大上下文分离）
  
  // Custom hardware overrides
  const [customHw, setCustomHw] = useState<HardwareConfig>(HARDWARE_PRESETS[0]);

  const model = MODEL_PRESETS[modelIdx];
  const filteredModels = MODEL_PRESETS.filter((m) => m.type === calcMode);
  const filteredIndices = MODEL_PRESETS.map((m, i) => (m.type === calcMode ? i : -1)).filter((i) => i >= 0);

  // Auto-switch tab when model is selected (via model selector or DeepSeek validator)
  const switchToModel = (idx: number) => {
    setModelIdx(idx);
    const m = MODEL_PRESETS[idx];
    if (m) setCalcMode(m.type);
  };
  const hardware = hardwareIdx === HARDWARE_PRESETS.length - 1 ? customHw : HARDWARE_PRESETS[hardwareIdx];

  // Cost tracking — must be after hardware (uses hardware.costPerGpuHourUsd)
  const [showCost, setShowCost] = useState(false);
  const [costPerGpuHourUsd, setCostPerGpuHourUsd] = useState(hardware.costPerGpuHourUsd ?? 2.09);
  const gibDivisor = 1024 * 1024 * 1024;  // 1 GiB = 1024³ bytes
  useEffect(() => {
    if (hardware.costPerGpuHourUsd) {
      setCostPerGpuHourUsd(hardware.costPerGpuHourUsd);
    }
  }, [hardware.costPerGpuHourUsd]);

  // Build parallel config — always use user-selected recompute strategy
  const autoRec = recommendParallelism(model, hardware, totalGpus);
  const parallel: ParallelConfig = autoParallel
    ? { ...autoRec, optimizationStrategy: recompute }
    : {
        tp,
        pp,
        dp: totalGpus / (tp * pp),
        ep: model.type === 'moe' ? Math.min(model.numRoutedExperts || 1, totalGpus / pp) : 1,
        microBatchSize: microBatch,
        optimizationStrategy: recompute,
      };

  const training: TrainingConfig = {
    phase,
    batchSize,
    numTokens,
    epochs,
    mfu,
    precision: precision === 'fp8' && !hardware.supportsFp8 ? 'bf16' : precision,
    fp8Ratio,
    clusterUptime,
    gradAccumSteps,
    seqLen: trainSeqLen,
    paperMode,
  };

  // Calculate results
  const paramSignature = [
    model.name, hardware.name, totalGpus,
    parallel.tp, parallel.pp, parallel.dp, parallel.ep, parallel.microBatchSize, parallel.optimizationStrategy,
    training.batchSize, training.numTokens, training.epochs, training.mfu, training.precision, training.fp8Ratio,
    training.clusterUptime, training.gradAccumSteps, training.seqLen, training.paperMode, trainSeqLen,
    costPerGpuHourUsd,
  ].join('|');

  const result: CalculationResult = useMemo(() => {
    try {
      return calculateTrainingCompute(model, hardware, parallel, training);
    } catch (e) {
      console.error('Calc error:', e);
      return null as any;
    }
  }, [model, hardware, parallel, training]);

  // Memory breakdown detail calculations
  const memDetail = useMemo(() => {
    const { tp, pp, dp, ep, optimizationStrategy } = parallel;
    const s = training.seqLen || Math.min(model.seqLen, 4096);
    const microBatch = training.batchSize / dp;
    const d = model.hiddenSize;
    const L = model.numLayers;
    const nh = model.numAttentionHeads;
    const dh = model.headDim || (d / nh);
    const layersPerDevice = L / pp;

    // Attention params per layer
    let attnPerLayer: number;
    if (model.attentionType === 'mla') {
      const c_kv = model.kvLoraRank!;
      const c_q = model.qLoraRank!;
      const d_nope = model.qkNopeHeadDim!;
      const d_rope = model.qkRopeHeadDim!;
      const d_v = model.vHeadDim!;
      attnPerLayer = (d * c_q) + (c_q * nh * d_nope) + (d * (c_kv + d_rope)) + (c_kv * nh * (d_nope + d_v)) + (nh * d_v * d);
    } else if (model.attentionType === 'gqa') {
      const n_kv = model.numKvHeads || nh;
      attnPerLayer = d * d + d * d + d * (n_kv * dh) + d * (n_kv * dh);
    } else {
      attnPerLayer = 4 * d * d;
    }

    // Params per GPU
    let paramsPerGpu = (attnPerLayer * L) / (pp * tp);
    if (model.type === 'moe' && model.numRoutedExperts) {
      const moeInter = model.moeIntermediateSize || 2048;
      const nShared = model.numSharedExperts || 1;
      const nRouted = model.numRoutedExperts;
      const expertParams = 3 * d * moeInter;
      paramsPerGpu += (expertParams * nShared * (L - (model.firstKDenseLayers || 0))) / (pp * tp);
      paramsPerGpu += (expertParams * nRouted * (L - (model.firstKDenseLayers || 0))) / (pp * tp * Math.max(ep, 1));
      paramsPerGpu += (d * nRouted * (L - (model.firstKDenseLayers || 0))) / (pp * tp);
    } else {
      const inter = model.intermediateSize || d * 3;
      paramsPerGpu += (3 * d * inter * L) / (pp * tp);
    }
    paramsPerGpu += d * model.vocabSize / tp;

    const recomputeFactor = optimizationStrategy === 'full_recompute' ? 0.05 :
                            optimizationStrategy === 'selective_recompute' ? 0.15 : 1.0;

    let activationBytes: number;
    let activationFormula: string;
    if (model.attentionType === 'mla') {
      const kvRank = model.kvLoraRank!;
      activationBytes = layersPerDevice * s * microBatch * kvRank * 2 * recomputeFactor * 5;
      activationFormula = `${layersPerDevice}层 × ${s}seq × ${microBatch}micro × ${kvRank}kvRank × 2B × ${recomputeFactor}rc × 5`;
    } else {
      const baseFactor = 10 + 24 / tp + 5 * nh * s / d;
      activationBytes = layersPerDevice * s * microBatch * d * baseFactor / tp * recomputeFactor;
      activationFormula = `${layersPerDevice}层 × ${s}seq × ${microBatch}micro × ${d} × ${baseFactor.toFixed(1)}base / ${tp}tp × ${recomputeFactor}rc`;
    }

    const optimizerBytes = 12 * paramsPerGpu;
    const weightBytesPerParam = training.precision === 'fp8' ? 1 : 2;
    const weightBytes = weightBytesPerParam * paramsPerGpu;
    const gradientBytes = 2 * paramsPerGpu;
    const budgetBytes = hardware.memoryGb * (1024 * 1024 * 1024) * (training.precision === 'fp8' ? 0.85 : 0.80);

    return {
      paramsPerGpu,
      layersPerDevice,
      microBatch,
      recomputeFactor,
      attnPerLayer,
      activationFormula,
      activationBytes,
      optimizerBytes,
      weightBytes,
      gradientBytes,
      totalBytes: optimizerBytes + weightBytes + gradientBytes + activationBytes,
      budgetBytes,
    };
  }, [model, hardware, parallel, training]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-100 p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">AI 训练算力计算器</h1>
        {/* Mode Tabs */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setCalcMode('dense')}
            className={`px-4 py-2 rounded text-sm font-medium transition ${
              calcMode === 'dense' ? 'bg-blue-600 text-white' : 'bg-[#1a1f35] text-gray-400 hover:bg-[#2a2f45]'
            }`}
          >
            🧮 Dense 模型 (Qwen2.5 / LLaMA / InternLM)
          </button>
          <button
            onClick={() => setCalcMode('moe')}
            className={`px-4 py-2 rounded text-sm font-medium transition ${
              calcMode === 'moe' ? 'bg-amber-600 text-white' : 'bg-[#1a1f35] text-gray-400 hover:bg-[#2a2f45]'
            }`}
          >
            🔀 MoE 模型 (V3 / V2 / V4)
          </button>
        </div>
        <p className="text-gray-400 text-sm">
          {calcMode === 'dense' ? 'GQA 稠密全参数激活 | BF16 / FP8 | 无专家路由' : 'MLA 压缩注意力 + MoE 稀疏激活 | FP8 混合 | 必须 EP'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-1 space-y-4">
          {/* Model Selection */}
          <Section title="模型选择" icon="🧠">
            <select
              className="w-full bg-[#1a1f35] border border-gray-700 rounded px-3 py-2 text-sm"
              value={modelIdx}
              onChange={(e) => switchToModel(Number(e.target.value))}
            >
              {filteredModels.map((m) => (
                <option key={m.name} value={MODEL_PRESETS.indexOf(m)}>
                  {m.name} {m.type === 'moe' ? '(MoE)' : ''}
                </option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <Stat label="类型" value={model.type === 'moe' ? 'MoE' : 'Dense'} />
              <Stat label="Attention" value={model.attentionType === 'gqa' ? `GQA(${model.numKvHeads}KV)` : model.attentionType === 'mla' ? 'MLA' : 'MHA'} />
              <Stat label="层数" value={String(model.numLayers)} />
              <Stat label="Hidden" value={String(model.hiddenSize)} />
              <Stat label="Heads" value={String(model.numAttentionHeads)} />
              <Stat label="Vocab" value={formatParams(model.vocabSize)} />
              <Stat label="Seq Len" value={formatParams(model.seqLen)} />
            </div>
            {model.type === 'moe' && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <Stat label="Routed Experts" value={String(model.numRoutedExperts)} />
                <Stat label="Shared Experts" value={String(model.numSharedExperts)} />
                <Stat label="Activated/Layer" value={String(model.expertsPerToken)} />
                <Stat label="Dense Layers" value={String(model.firstKDenseLayers)} />
              </div>
            )}
          </Section>

          {/* Hardware Selection */}
          <Section title="硬件选择" icon="🖥️">
            <select
              className="w-full bg-[#1a1f35] border border-gray-700 rounded px-3 py-2 text-sm"
              value={hardwareIdx}
              onChange={(e) => setHardwareIdx(Number(e.target.value))}
            >
              {HARDWARE_PRESETS.map((h, i) => (
                <option key={h.name} value={i}>{h.name}</option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <Stat label="BF16 算力" value={`${hardware.fp16Tflops} T`} />
              <Stat label="显存" value={`${hardware.memoryGb} GB`} />
              <Stat label="显存带宽" value={`${hardware.memoryBandwidthTbs} TB/s`} />
              <Stat label="片间带宽" value={`${hardware.busBandwidthGbs} GB/s`} />
              <Stat label="网络带宽" value={`${hardware.networkBandwidthGbs} GB/s`} />
              <Stat label="FP8" value={hardware.supportsFp8 ? `${hardware.fp8Tflops || '—'} T` : '✗'} />
              <Stat label="参考成本" value={hardware.costPerGpuHourUsd ? `$${hardware.costPerGpuHourUsd}/GPU/h` : '—'} />
            </div>
            {/* 成本输入: 用户可手动填写 USD/GPU/h */}
            <div className="mt-2">
              <label className="text-xs text-gray-400">GPU 成本 (USD/GPU/h)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={costPerGpuHourUsd}
                onChange={(e) => setCostPerGpuHourUsd(Number(e.target.value) || 0)}
                placeholder="例如: 2.09"
                className="w-full bg-[#1a1f35] border border-gray-700 rounded px-2 py-1 text-sm mt-1 font-mono text-yellow-300"
              />
              <div className="text-[10px] text-gray-600 mt-0.5">
                {hardware.name.includes('950DT')
                  ? '华为定价: 8万/卡 ÷ 5年(43800h) ≈ $0.25/h'
                  : hardware.costPerGpuHourUsd
                    ? `论文参考: $${hardware.costPerGpuHourUsd}/GPU/h (DeepSeek-V3 H800 实测)`
                    : '暂无论文数据，请填写市场参考价'}
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-gray-400">GPU 总数</label>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => setTotalGpus(Math.max(8, totalGpus - 8))}
                  className="px-3 py-1 bg-[#1a1f35] hover:bg-[#2a2f45] rounded text-sm font-mono border border-gray-700 shrink-0"
                >
                  -8
                </button>
                <input
                  type="range"
                  min={8}
                  max={8192}
                  step={8}
                  value={totalGpus}
                  onChange={(e) => setTotalGpus(Number(e.target.value))}
                  className="w-full"
                />
                <button
                  onClick={() => setTotalGpus(Math.min(8192, totalGpus + 8))}
                  className="px-3 py-1 bg-[#1a1f35] hover:bg-[#2a2f45] rounded text-sm font-mono border border-gray-700 shrink-0"
                >
                  +8
                </button>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-sm font-mono text-blue-400">{totalGpus} GPUs ({Math.ceil(totalGpus / 8)} nodes)</span>
                {(() => {
                  const effective = parallel.dp * parallel.pp * parallel.tp;
                  if (effective !== totalGpus) {
                    return <span className="text-[10px] text-amber-400 ml-2">⚠ 有效: {effective} 卡 (tp×pp×dp={parallel.pp}×{parallel.tp}×{parallel.dp})</span>;
                  }
                  return null;
                })()}
              </div>
              {/* Memory-Constrained Recommendations */}
              <div className="mt-2 space-y-1 text-[10px]">
                {(() => {
                  const currentPP = parallel.pp;
                  const maxBatchCurrent = calcMaxBatchSize(model, hardware, training, totalGpus, currentPP, parallel.optimizationStrategy);
                  const minGpus = calcMinGpus(model, hardware, training, batchSize, parallel.optimizationStrategy);
                  const budget = hardware.memoryGb * (precision === 'fp8' ? 0.85 : 0.80);
                  const current = result.memory.totalGb;
                  const ok = current <= budget;
                  return (
                    <>
                      <div className={`rounded px-2 py-1 ${ok ? 'bg-[#0a0e1a] text-gray-500' : 'bg-red-900/30 text-red-400 border border-red-800/40'}`}>
                        {ok
                          ? <>✓ 显存 {result.memory.totalGb.toFixed(1)}/{budget.toFixed(0)} GiB 预算内 · PP={currentPP} 下最大 batch: <span className="text-cyan-400 font-mono">{maxBatchCurrent.maxBatch.toLocaleString()}</span> seq</>
                          : <>✗ 显存 {result.memory.totalGb.toFixed(0)} GiB 超出 {budget.toFixed(0)} GiB 预算 · 最少需 <span className="text-cyan-400 font-mono">{minGpus.minGpus.toLocaleString()}</span> 卡 (PP={minGpus.optimalPP}) 或 batch ≤ <span className="text-orange-400 font-mono">{maxBatchCurrent.maxBatch.toLocaleString()}</span></>
                        }
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </Section>

          {/* Training Phase */}
          <Section title="训练阶段" icon="🎯">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(PHASE_CONFIGS) as Array<keyof typeof PHASE_CONFIGS>).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPhase(p);
                    setMfu(PHASE_CONFIGS[p].defaultMfu);
                  }}
                  className={`px-3 py-2 rounded text-xs font-medium transition ${
                    phase === p
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#1a1f35] text-gray-400 hover:bg-[#252a40]'
                  }`}
                >
                  {PHASE_CONFIGS[p].name}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">{PHASE_CONFIGS[phase].description}</p>
          </Section>

          {/* Training Config */}
          <Section title="训练配置" icon="⚙️">
            <div className="space-y-3">
              <InputNumber label="Global Batch Size (GBS)" value={batchSize} onChange={setBatchSize} min={1} max={100000} />
              <InputNumber label={`训练 Seq Len (模型最大: ${formatParams(model.seqLen)})`} value={trainSeqLen} onChange={setTrainSeqLen} min={1024} max={131072} />
              <div className="bg-[#0d1220] border border-gray-700/50 rounded px-2 py-1.5 text-[10px] grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-gray-500">序列/GPU:</span>
                <span className="text-cyan-400 font-mono">{(batchSize / parallel.dp).toFixed(0)}</span>
                <span className="text-gray-500">Token/步:</span>
                <span className="text-cyan-400 font-mono">{((batchSize * model.seqLen) / 1e6).toFixed(1)}M</span>
                <span className="text-gray-500">总迭代数:</span>
                <span className="text-cyan-400 font-mono">{((numTokens * 1e9) / (batchSize * model.seqLen) / 1000).toFixed(1)}K</span>
                <span className="text-gray-500">Seq Len:</span>
                <span className="text-cyan-400 font-mono">{model.seqLen}</span>
              </div>
              <InputNumber label="训练 Tokens (B)" value={numTokens} onChange={setNumTokens} min={0.001} max={100000} />
              <InputNumber label="Epochs" value={epochs} onChange={setEpochs} min={1} max={10} />
              <div>
                <label className="text-xs text-gray-400">
                  MFU (端到端有效利用率): {(mfu * 100).toFixed(1)}%
                  <span className="text-gray-600 ml-2">(BF16 基准, 含所有开销)</span>
                </label>
                <input
                  type="range"
                  min={0.15}
                  max={0.55}
                  step={0.001}
                  value={mfu}
                  onChange={(e) => setMfu(Number(e.target.value))}
                  className="w-full mt-1"
                />
                <div className="flex justify-between text-[10px] text-gray-600">
                  <span>15%</span><span className="text-cyan-400">40.6% ≈ DeepSeek-V3</span><span>55%</span>
                </div>
                <div className="mt-1 text-[10px] text-gray-500 bg-[#0d1220] rounded px-2 py-.5">
                  <span>估算 Core GPU (纯计算) MFU ≈ {(result.time.coreMFU * 100).toFixed(0)}%</span>
                  <span className="text-gray-600 ml-2">(含 bubble {(result.time.bubbleFraction*100).toFixed(1)}% + 其他开销)</span>
                </div>
              </div>
              <PaperModeToggle paperModeState={[paperMode, setPaperMode]} time={result.time} mfu={mfu} />
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400">精度:</label>
                {(['bf16', 'fp8'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrecision(p)}
                    disabled={p === 'fp8' && (!hardware.supportsFp8 || model.type === 'dense')}
                    className={`px-2 py-1 rounded text-xs ${
                      precision === p ? 'bg-green-600 text-white' : 'bg-[#1a1f35] text-gray-500'
                    } ${p === 'fp8' && (!hardware.supportsFp8 || model.type === 'dense') ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
                {model.type === 'dense' && (
                  <span className="text-[10px] text-amber-400 ml-1">Dense 模型仅支持 BF16</span>
                )}
              </div>
              {model.type === 'moe' && hardware.supportsFp8 && precision === 'fp8' && (
                <div>
                  <label className="text-xs text-gray-400">
                    FP8 混合占比: {(fp8Ratio * 100).toFixed(0)}% (其余 BF16)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={fp8Ratio}
                    onChange={(e) => setFp8Ratio(Number(e.target.value))}
                    className="w-full mt-1"
                  />
                  <div className="flex justify-between text-[10px] text-gray-600">
                    <span>0% (纯BF16)</span><span>FP8 混合</span><span>100% (纯FP8)</span>
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-400">
                  集群可用率 (Uptime): {(clusterUptime * 100).toFixed(0)}%
                  <span className="text-gray-600 ml-2">(100% - 故障/维护/恢复占比)</span>
                </label>
                <input
                  type="range"
                  min={0.70}
                  max={0.99}
                  step={0.01}
                  value={clusterUptime}
                  onChange={(e) => setClusterUptime(Number(e.target.value))}
                  className="w-full mt-1"
                />
                <div className="flex justify-between text-[10px] text-gray-600">
                  <span>70% (不稳定)</span><span>93% 典型</span><span>99% (极稳定)</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400">
                  梯度累积 (Grad Accum): {gradAccumSteps} 步
                  <span className="text-gray-600 ml-2">(PP={parallel.pp}, 微批次={Math.max(parallel.pp, parallel.pp * gradAccumSteps)})</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={16}
                  step={1}
                  value={gradAccumSteps}
                  onChange={(e) => setGradAccumSteps(Number(e.target.value))}
                  className="w-full mt-1"
                />
                <div className="flex justify-between text-[10px] text-gray-600">
                  <span>1 (bubble 大)</span><span>推荐 4-8</span><span>16 (bubble 小)</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Parallelism */}
          <Section title="并行策略 + 重算" icon="🔀">
            <label className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <input
                type="checkbox"
                checked={autoParallel}
                onChange={(e) => setAutoParallel(e.target.checked)}
                className="rounded"
              />
              自动推荐并行度 (TP/PP/DP)
            </label>

            {/* 重算策略 — 始终显示 */}
            <div className="mb-3">
              <label className="text-xs text-gray-400">激活重算策略 (影响 FLOPs 系数)</label>
              <div className="flex gap-2 mt-1">
                {([
                  { value: 'no_recompute', label: '无重算 (6×)', desc: '节省算力, 费显存' },
                  { value: 'selective_recompute', label: '选择性 (7×)', desc: model.type === 'dense' ? '重算attention/QKV投影' : '重算RMSNorm+MLA' },
                  { value: 'full_recompute', label: '全量重算 (8×)', desc: '节省显存' },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setRecompute(opt.value)}
                    className={`flex-1 px-2 py-2 rounded text-xs transition ${
                      recompute === opt.value
                        ? 'bg-amber-600 text-white border-amber-500'
                        : 'bg-[#1a1f35] text-gray-400 hover:bg-[#252a40] border-gray-700'
                    } border`}
                  >
                    <div className="font-semibold">{opt.label}</div>
                    <div className="text-[10px] opacity-70">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {!autoParallel && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <InputNumber label="TP" value={tp} onChange={setTp} min={1} max={16} />
                <InputNumber label="PP" value={pp} onChange={setPp} min={1} max={32} />
                <InputNumber label="Micro Batch" value={microBatch} onChange={setMicroBatch} min={1} max={100} />
              </div>
            )}
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <Stat label="TP" value={String(parallel.tp)} />
              <Stat label="PP" value={String(parallel.pp)} />
              <Stat label="DP" value={String(parallel.dp)} />
              <Stat label="Total GPUs" value={String(totalGpus)} />
              <Stat label="Micro Batch" value={String(parallel.microBatchSize)} />
              <Stat label="重算" value={parallel.optimizationStrategy === 'full_recompute' ? 'Full' : parallel.optimizationStrategy === 'selective_recompute' ? 'Sel' : 'None'} />
            </div>
          </Section>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-2 space-y-4">
          {/* Calculate Button + Status Bar */}
          <div className="bg-[#121625] border border-gray-800 rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                参数 {paramSignature !== calcSignature ? (
                  <span className="text-amber-400">⚡ 已更改</span>
                ) : (
                  <span className="text-green-400">✓ 已同步</span>
                )}
              </span>
              {calcTimestamp > 0 && (
                <span className="text-[10px] text-gray-600">
                  计算于 {Math.floor((Date.now() - calcTimestamp) / 1000)}s 前
                </span>
              )}
            </div>
            <button
              onClick={() => { setCalcSignature(paramSignature); setCalcTimestamp(Date.now()); }}
              disabled={paramSignature === calcSignature}
              className={`px-4 py-1.5 rounded text-xs font-semibold transition-all ${
                paramSignature !== calcSignature
                  ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/30 cursor-pointer'
                  : 'bg-[#1a1f35] text-gray-500 cursor-not-allowed border border-gray-700'
              }`}
            >
              {paramSignature !== calcSignature ? '🚀 重新计算' : '✓ 最新结果'}
            </button>
            <button
              onClick={() => setShowCost(!showCost)}
              className="px-3 py-1.5 rounded text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all"
            >
              {showCost ? '💰 隐藏成本' : '💰 成本'}
            </button>
          </div>

          {result && (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                  title="总参数量"
                  value={formatParams(result.modelParams.total)}
                  subtitle={`激活: ${formatParams(result.modelParams.activatedPerToken)}/token`}
                  color="blue"
                />
                <MetricCard
                  title="训练 FLOPs"
                  value={formatNumber(result.flops.totalTraining)}
                  subtitle={`Per token: ${formatNumber(result.flops.totalPerToken, 0)}`}
                  color="purple"
                />
                <MetricCard
                  title="训练时间 (wall-clock)"
                  value={formatTime(result.time.effectiveHours)}
                  subtitle={`FLOPs ${formatNumber(result.flops.totalTraining)} / (BF16 × ${(result.time.effectiveMFU*100).toFixed(1)}% × ${result.cluster.totalGpus})`}
                  color="green"
                />
                <MetricCard
                  title="Per GPU 显存"
                  value={`${result.memory.totalGb.toFixed(1)} GiB`}
                  subtitle={result.memory.withinBudget >= 0 ? `余量: ${result.memory.withinBudget.toFixed(1)} GiB` : `超出: ${Math.abs(result.memory.withinBudget).toFixed(1)} GB`}
                  color={result.memory.withinBudget >= 0 ? 'green' : 'red'}
                />
              </div>

              {/* Empirical Rule: 20x Params / GPU Memory */}
              {(() => {
                const totalParamsB = result.modelParams.total / 1e9;
                const empiricalGpus = Math.ceil(totalParamsB * 20 / hardware.memoryGb);
                const ratio = result.cluster.totalGpus / empiricalGpus;
                return (
                  <div className="mt-3 bg-[#0d1525] border border-amber-700/30 rounded p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 text-xs font-semibold">📐 经验法则 (20×法则) — 最小可训配置</span>
                        <span className="text-gray-500 text-[10px]">低于此卡数则无法启动训练（无 batch/seqLen 余量）</span>
                      </div>
                      <div className="text-right">
                        <span className="text-white font-mono text-sm font-bold">
                          {formatParams(result.modelParams.total)} × 20 ÷ {hardware.memoryGb}GB ≈ {empiricalGpus.toLocaleString()} 卡
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                      <div className="bg-[#1a1f35] rounded p-2">
                        <div className="text-gray-500">最小可训</div>
                        <div className="text-amber-300 font-mono font-bold text-sm">{empiricalGpus.toLocaleString()} 卡</div>
                      </div>
                      <div className="bg-[#1a1f35] rounded p-2">
                        <div className="text-gray-500">当前配置</div>
                        <div className="text-cyan-300 font-mono font-bold text-sm">{result.cluster.totalGpus.toLocaleString()} 卡</div>
                      </div>
                      <div className="bg-[#1a1f35] rounded p-2">
                        <div className="text-gray-500">安全倍数</div>
                        <div className={`font-mono font-bold text-sm ${ratio >= 1.5 ? 'text-green-400' : ratio >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
                          {ratio.toFixed(1)}× {ratio >= 1.5 ? '✓ 充裕' : ratio >= 1 ? '⚠ 临界' : '✗ 不可训'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-gray-600">
                      💡 最小可训状态：仅容纳参数+优化器（Adam 16B/参数），无任何 batch 余量。实际训练需 ≥ 此值 × 1.5（留显存给激活/通信）
                    </div>
                  </div>
                );
              })()}

              {/* Memory Breakdown */}
              <Section title="显存分解 (Per GPU)" icon="🧮">
                <div className="space-y-2">
                  <MemoryBar
                    label="优化器 (Adam)"
                    bytes={result.memory.optimizer}
                    total={result.memory.total}
                    color="bg-orange-500"
                  />
                  <MemoryBar
                    label="模型权重"
                    bytes={result.memory.weights}
                    total={result.memory.total}
                    color="bg-blue-500"
                  />
                  <MemoryBar
                    label="梯度"
                    bytes={result.memory.gradients}
                    total={result.memory.total}
                    color="bg-green-500"
                  />
                  <MemoryBar
                    label="激活值"
                    bytes={result.memory.activation}
                    total={result.memory.total}
                    color="bg-purple-500"
                  />
                  <div className="mt-3 flex items-center gap-4 text-xs">
                    <BudgetIndicator
                      used={result.memory.totalGb}
                      total={hardware.memoryGb * 0.80}
                      label="显存预算 (80%)"
                    />
                  </div>
                </div>
              </Section>

              {/* 显存计算过程 (逐步分解) */}
              <Section title="显存是怎么算出来的? (逐步分解)" icon="🧮">
                <div className="space-y-2 text-xs">
                  {/* Step 0: 全量模型内存（不切分） */}
                  <div className="bg-[#0d1525] border border-dashed border-cyan-800/40 rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">⓪ 全量模型内存</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      <div className="text-gray-400 text-[10px] mb-1">{formatParams(memDetail.paramsPerGpu * parallel.pp * parallel.tp)} 参数（全量）</div>
                      <div className="text-[10px] text-gray-500 mb-1">
                        含 Embedding({formatParams(model.hiddenSize * model.vocabSize)}){model.type === 'moe' ? ` + Router(${formatParams(model.hiddenSize * (model.numRoutedExperts || 0))})` : ''}，论文通常不计入
                      </div>
                      {(() => {
                        const totalParams = memDetail.paramsPerGpu * parallel.pp * parallel.tp;
                        const totalOptimizer = totalParams * 12;
                        const totalWeights = totalParams * (training.precision === 'fp8' ? 1 : 2);
                        const totalGradients = totalParams * 2;
                        const totalParamMem = totalOptimizer + totalWeights + totalGradients;
                        return (
                          <>
                            <div>
                              <span className="text-orange-400">优化器 Adam</span>: {formatParams(totalParams)} × 12B
                              <span className="text-gray-500"> = </span>
                              <span className="text-white">{(totalOptimizer / gibDivisor).toFixed(1)} GiB</span>
                              <span className="text-gray-600 text-[10px] ml-1">(FP32主副本+动量+方差)</span>
                            </div>
                            <div>
                              <span className="text-blue-400">权重</span>: {formatParams(totalParams)} × {training.precision === 'fp8' ? '1B(FP8)' : '2B(BF16)'}
                              <span className="text-gray-500"> = </span>
                              <span className="text-white">{(totalWeights / gibDivisor).toFixed(1)} GiB</span>
                            </div>
                            <div>
                              <span className="text-green-400">梯度</span>: {formatParams(totalParams)} × 2B
                              <span className="text-gray-500"> = </span>
                              <span className="text-white">{(totalGradients / gibDivisor).toFixed(1)} GiB</span>
                            </div>
                            <div className="text-white font-bold border-t border-gray-700 pt-1 mt-1">
                              参数内存合计: {(totalParamMem / gibDivisor).toFixed(0)} GiB
                              <span className="text-gray-500 font-normal"> ÷ {result.cluster.totalGpus} GPU = {(totalParamMem / result.cluster.totalGpus / gibDivisor).toFixed(1)} GiB/GPU</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Step 1: 每卡参数内存（切分后） */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">① 每卡参数内存</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      <div>
                        <span className="text-orange-400">优化器</span>: {formatParams(memDetail.paramsPerGpu)} × 12B
                        <span className="text-gray-500"> = </span>
                        <span className="text-white">{(memDetail.optimizerBytes / gibDivisor).toFixed(2)} GiB</span>
                      </div>
                      <div>
                        <span className="text-blue-400">权重</span>: {formatParams(memDetail.paramsPerGpu)} × {training.precision === 'fp8' ? '1B(FP8)' : '2B(BF16)'}
                        <span className="text-gray-500"> = </span>
                        <span className="text-white">{(memDetail.weightBytes / gibDivisor).toFixed(2)} GiB</span>
                      </div>
                      <div>
                        <span className="text-green-400">梯度</span>: {formatParams(memDetail.paramsPerGpu)} × 2B
                        <span className="text-gray-500"> = </span>
                        <span className="text-white">{(memDetail.gradientBytes / gibDivisor).toFixed(2)} GiB</span>
                      </div>
                      <div className="text-white font-bold border-t border-gray-700 pt-1 mt-1">
                        每卡参数内存: {(memDetail.optimizerBytes / gibDivisor).toFixed(2)} + {(memDetail.weightBytes / gibDivisor).toFixed(2)} + {(memDetail.gradientBytes / gibDivisor).toFixed(2)} = {((memDetail.optimizerBytes + memDetail.weightBytes + memDetail.gradientBytes) / gibDivisor).toFixed(2)} GiB
                      </div>
                    </div>
                  </div>

                  {/* Step 2: 优化器 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">② 优化器 Adam</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      {formatParams(memDetail.paramsPerGpu)} × 12 字节
                      <span className="text-gray-600 text-[10px] ml-1">(FP32主副本4B + 动量4B + 方差4B)</span>
                      <div className="text-white font-bold">= {(memDetail.optimizerBytes / gibDivisor).toFixed(2)} GiB</div>
                    </div>
                  </div>

                  {/* Step 3: 权重 + 梯度 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">③ 权重 + 梯度</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      <div>
                        <span className="text-blue-400">权重</span>: {formatParams(memDetail.paramsPerGpu)} × {training.precision === 'fp8' ? '1字节(FP8)' : '2字节(BF16)'}
                        <span className="text-gray-500"> = </span>
                        <span className="text-white">{(memDetail.weightBytes / gibDivisor).toFixed(2)} GiB</span>
                        <span className="text-gray-600 text-[10px] ml-1">
                          {training.precision === 'fp8' ? '(FP8训练: 前向/反向GEMM用FP8)' : '(BF16训练: 权重保持BF16)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-green-400">梯度</span>: {formatParams(memDetail.paramsPerGpu)} × 2字节(BF16)
                        <span className="text-gray-500"> = </span>
                        <span className="text-white">{(memDetail.gradientBytes / gibDivisor).toFixed(2)} GiB</span>
                        <span className="text-gray-600 text-[10px] ml-1">(梯度累加用BF16精度)</span>
                      </div>
                    </div>
                  </div>

                  {/* Step 4: 激活值 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">④ 激活值</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      <div className="text-gray-400 text-[10px]">{memDetail.activationFormula}</div>
                      <div className="text-white font-bold mt-1">= {(memDetail.activationBytes / gibDivisor).toFixed(2)} GiB</div>
                      <div className="text-[10px] text-gray-500">
                        重算系数: {memDetail.recomputeFactor} ({parallel.optimizationStrategy})
                      </div>
                    </div>
                  </div>

                  {/* Step 5: 汇总 */}
                  <div className="bg-gradient-to-r from-orange-900/30 to-purple-900/30 border border-orange-600/30 rounded p-3">
                    <div className="text-[10px] text-orange-400/80 mb-1">⑤ 总显存占用</div>
                    <div className="font-mono text-lg text-orange-300 font-bold">
                      {(memDetail.optimizerBytes / gibDivisor).toFixed(2)} + {(memDetail.weightBytes / gibDivisor).toFixed(2)} + {(memDetail.gradientBytes / gibDivisor).toFixed(2)} + {(memDetail.activationBytes / gibDivisor).toFixed(2)} = {(memDetail.totalBytes / gibDivisor).toFixed(2)} GiB
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1.5 border-t border-gray-700 pt-1.5">
                      预算: {hardware.memoryGb}GB × {training.precision === 'fp8' ? '85%' : '80%'} = {(memDetail.budgetBytes / gibDivisor).toFixed(1)} GiB
                      {memDetail.totalBytes <= memDetail.budgetBytes
                        ? <span className="text-green-400 ml-2">✓ 余量 {((memDetail.budgetBytes - memDetail.totalBytes) / gibDivisor).toFixed(1)} GiB</span>
                        : <span className="text-red-400 ml-2">✗ 超出 {((memDetail.totalBytes - memDetail.budgetBytes) / gibDivisor).toFixed(1)} GiB</span>
                      }
                    </div>
                  </div>
                </div>
              </Section>

              {/* Timeline */}
              <Section title="训练 Timeline" icon="⏱️">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="bg-[#1a1f35] rounded p-3">
                      <div className="text-gray-400 text-xs">单次迭代</div>
                      <div className="text-lg font-mono text-white">{(result.time.perIteration * 1000).toFixed(0)} ms</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Fwd: {(result.time.forwardStep * 1000).toFixed(0)}ms / Bwd: {(result.time.backwardStep * 1000).toFixed(0)}ms
                      </div>
                    </div>
                    <div className="bg-[#1a1f35] rounded p-3">
                      <div className="text-gray-400 text-xs">总迭代数</div>
                      <div className="text-lg font-mono text-white">{formatMath(result.time.totalIterations)}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {(result.flops.totalPerToken * 1e-9).toFixed(1)} GFLOPs/token
                      </div>
                    </div>
                    <div className="bg-[#1a1f35] rounded p-3">
                      <div className="text-gray-400 text-xs">通信占比</div>
                      <div className="text-lg font-mono text-white">{(result.communication.totalCommFraction * 100).toFixed(1)}%</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Effective MFU: {(result.time.effectiveMFU * 100).toFixed(1)}% (Core ~{(result.time.coreMFU * 100).toFixed(0)}%)
                      </div>
                    </div>
                  </div>
                  
                  {/* MFU 组成参考 (这些信息已包含在端到端 MFU 中) */}
                  <div className="bg-[#1a1f35] rounded p-3 space-y-2">
                    <div className="text-xs text-gray-400">📊 MFU 组成参考 <span className="text-gray-600">(已包含在端到端 MFU 中)</span></div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="bg-[#0a0e1a] rounded p-2">
                        <div className="text-gray-500">Pipeline Bubble</div>
                        <div className="text-orange-400 font-mono">{(result.time.bubbleFraction * 100).toFixed(1)}%</div>
                        <div className="text-gray-600">PP={parallel.pp}, GA={gradAccumSteps}, μ批={Math.max(parallel.pp, parallel.pp * gradAccumSteps)}</div>
                      </div>
                      <div className="bg-[#0a0e1a] rounded p-2">
                        <div className="text-gray-500">Cluster Uptime</div>
                        <div className="text-amber-400 font-mono">{(result.time.clusterUptime * 100).toFixed(0)}%</div>
                        <div className="text-gray-600">停机损失 {(100 - result.time.clusterUptime*100).toFixed(0)}%</div>
                      </div>
                    </div>
                    <div className="bg-[#0a0e1a] rounded p-2 text-[10px]">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Wall-clock</span>
                        <span className="text-white font-mono font-bold">{formatTime(result.time.effectiveHours)}</span>
                      </div>
                      <div className="text-gray-600 mt-1">
                        Total FLOPs {formatNumber(result.flops.totalTraining)} ÷ (BF16 × {(result.time.effectiveMFU*100).toFixed(1)}% × {result.cluster.totalGpus} GPUs)
                      </div>
                    </div>
                    <div className="bg-cyan-900/20 border border-cyan-700/30 rounded p-2 text-[10px] text-cyan-200/80">
                      <strong className="text-cyan-400">💡 调试提示:</strong> 调整 MFU slide 直接影响总时间 (BF16_peak × MFU × GPUs = 总吞吐). PP/bubble/uptime 仅作参考.
                    </div>
                  </div>
                </div>
              </Section>

              {/* 训练时间小白分解 */}
              <Section title="训练时间是怎么算出来的? (逐步分解)" icon="🔢">
                <div className="space-y-2 text-xs">
                  {/* Step 1: 总数据量 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">① 训练数据</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      <span className="text-yellow-300">{numTokens}B</span> tokens × <span className="text-yellow-300">{epochs}</span> epoch
                      <span className="text-gray-500"> = </span>
                      <span className="text-white font-bold">{(numTokens * epochs).toFixed(1)}B tokens</span>
                      <div className="text-[10px] text-gray-500 mt-0.5">总共要"读"多少数据</div>
                    </div>
                  </div>

                  {/* Step 2: 每步处理量 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">② 每步处理</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      <span className="text-yellow-300">{batchSize}</span> batch × <span className="text-yellow-300">{trainSeqLen}</span> seq-len
                      <span className="text-gray-500"> = </span>
                      <span className="text-white font-bold">{formatMath(batchSize * trainSeqLen)} tokens/step</span>
                      <div className="text-[10px] text-gray-500 mt-0.5">一个 iteration 处理几条数据 × 每条多长</div>
                    </div>
                  </div>

                  {/* Step 3: 总迭代数 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">③ 共需几步</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      {(numTokens * 1e9 * epochs).toExponential(1)} ÷ {formatMath(batchSize * trainSeqLen)}
                      <span className="text-gray-500"> = </span>
                      <span className="text-white font-bold">{formatMath(result.time.totalIterations)} steps</span>
                      <div className="text-[10px] text-gray-500 mt-0.5">总数据 ÷ 每步数据 = 需要跑多少次 forward+backward</div>
                    </div>
                  </div>

                  {/* Step 4: 每步 FLOPs 分解 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">④ 每步计算量</span>
                    <div className="font-mono text-gray-200 leading-relaxed space-y-0.5">
                      <div>
                        <span className="text-blue-400">Forward:</span> {formatNumber(result.flops.forwardPerSample)}
                        <span className="text-gray-600 text-[10px] ml-1">(权重×数据 算预测)</span>
                      </div>
                      <div>
                        <span className="text-green-400">Backward:</span> {formatNumber(result.flops.forwardPerSample * 2)}
                        <span className="text-gray-600 text-[10px] ml-1">(≈2× Forward, 算梯度)</span>
                      </div>
                      {parallel.optimizationStrategy !== 'no_recompute' && (
                        <div>
                          <span className="text-orange-400">重算:</span> +{((result.flops.totalPerSample / result.flops.forwardPerSample - 3) * 100).toFixed(0)}%
                          <span className="text-gray-600 text-[10px] ml-1">({parallel.optimizationStrategy}, 省显存多算一次)</span>
                        </div>
                      )}
                      <div className="text-white font-bold border-t border-gray-700 pt-1 mt-1">
                        Total/step: {formatNumber(result.flops.totalPerSample)}
                      </div>
                    </div>
                  </div>

                  {/* Step 5: 总 FLOPs */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">⑤ 总计算量</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      {formatNumber(result.flops.totalPerSample)} × {formatMath(result.time.totalIterations)}
                      <span className="text-gray-500"> = </span>
                      <span className="text-white font-bold text-purple-300">{formatNumber(result.flops.totalTraining)}</span>
                      <div className="text-[10px] text-gray-500 mt-0.5">每步计算量 × 步数 = 训练全程 float 运算次数</div>
                    </div>
                  </div>

                  {/* Step 6: GPU 总吞吐 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">⑥ 集群算力</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      <span className="text-yellow-300">{hardware.fp16Tflops}</span> TFLOPS × <span className="text-yellow-300">{(result.time.effectiveMFU * 100).toFixed(1)}%</span> MFU × <span className="text-yellow-300">{result.cluster.totalGpus}</span> GPUs
                      <div className="text-[10px] text-gray-500 mt-0.5">单卡峰值 × 利用率 × 卡数 = 集群实际吞吐</div>
                      <div className="text-white font-bold">= {formatNumber(hardware.fp16Tflops * result.time.effectiveMFU * result.cluster.totalGpus * 1e12)}/sec</div>
                    </div>
                  </div>

                  {/* Step 7: 每步耗时 */}
                  <div className="bg-[#1a1f35] rounded p-2.5 flex items-start gap-3">
                    <span className="text-cyan-400 font-bold text-[10px] mt-0.5 shrink-0">⑦ 每步耗时</span>
                    <div className="font-mono text-gray-200 leading-relaxed">
                      {formatNumber(result.flops.totalPerSample)} ÷ {formatNumber(hardware.fp16Tflops * result.time.effectiveMFU * result.cluster.totalGpus * 1e12)}
                      <span className="text-gray-500"> = </span>
                      <span className="text-white font-bold">{(result.time.perIteration).toFixed(3)} sec/step</span>
                      <div className="text-[10px] text-gray-500 mt-0.5">每步计算量 ÷ 集群算力 = 一个 iteration 多久</div>
                    </div>
                  </div>

                  {/* Step 8: 汇总 */}
                  <div className="bg-gradient-to-r from-cyan-900/40 to-purple-900/30 border border-cyan-600/30 rounded p-3">
                    <div className="text-[10px] text-cyan-400/80 mb-1">⑧ 总训练时间</div>
                    <div className="font-mono text-lg text-cyan-300 font-bold">
                      {(result.time.perIteration).toFixed(3)} sec × {formatMath(result.time.totalIterations)} steps = {formatTime(result.time.effectiveHours)}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1.5 border-t border-gray-700 pt-1.5">
                      公式: <span className="text-gray-300">总时间 = (6~8 × P × D) ÷ (BF16_peak × MFU × GPUs)</span>
                      <br />
                      P = 激活参数量, D = 训练tokens, 6~8 = forward+backward+recompute系数
                    </div>
                  </div>
                </div>
              </Section>

              {/* Communication Breakdown */}
              <Section title="通信开销 Detail" icon="📡">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <CommItem label="AllGather (Fwd)" ms={result.communication.allGatherTime * 1000} />
                  <CommItem label="AllReduce (Grad)" ms={result.communication.allReduceTime * 1000} />
                  <CommItem label="P2P (Pipeline)" ms={result.communication.p2pTime * 1000} />
                  <CommItem label="All-to-All (MoE)" ms={result.communication.allToAllTime * 1000} />
                </div>
              </Section>

              {/* Cost Estimate — 默认隐藏, 需要时展开 */}
              {showCost && (
                <Section title="训练成本估算 (参考)" icon="💰">
                  <CostEstimate
                    totalHours={result.time.effectiveHours}
                    numNodes={result.cluster.numNodes}
                    costPerGpuHourUsd={costPerGpuHourUsd}
                    numTokens={numTokens}
                  />
                </Section>
              )}

              {/* Phase-specific info */}
              <div className="bg-[#1a1f35] border border-gray-700 rounded-lg p-4 text-xs text-gray-400">
                <strong className="text-gray-300">{result.phaseInfo.name}:</strong> {result.phaseInfo.description}
                <br />
                相对预训练计算量: {(result.phaseInfo.relativeCost * 100).toFixed(2)}%
              </div>

              {/* Validation Section: MoE shows DeepSeek paper calibration, Dense shows GQA info */}
              {calcMode === 'moe' ? <ValidationSection /> : (
                <Section title="Dense 模型计算说明" icon="📝">
                  <div className="space-y-2 text-xs text-gray-400">
                    <p>• <strong className="text-gray-300">GQA</strong>：Q 投影全头数，K/V 压缩（8KV heads），节省 44% attention 参数</p>
                    <p>• <strong className="text-gray-300">全参数激活</strong>：每个 token 激活全部参数，训练 FLOPs = 6 × P_total × D</p>
                    <p>• <strong className="text-gray-300">无 EP</strong>：仅 TP + PP + DP 三维并行</p>
                    <p>• <strong className="text-gray-300">训练 Seq Len</strong>：默认 4K（即使模型支持 131K 上下文），可在配置中调整</p>
                    <p>• <strong className="text-gray-300">训练 tokens</strong>：Qwen2.5 论文报告 18T tokens</p>
                    <p className="text-gray-600 mt-2">注：Qwen2.5 论文未报告 GPU 数量和 MFU，因此无法做端到端时间验证。</p>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DeepSeek Validation Component
// ============================================================

function ValidationSection() {
  const [caseIdx, setCaseIdx] = useState(0);
  const dc = DEEPSEEK_VALIDATIONS[caseIdx];
  
  // Find matching model and hardware presets
  const valModel = MODEL_PRESETS.find(m => m.name === dc.modelName) || MODEL_PRESETS[0];
  const valHw = HARDWARE_PRESETS.find(h => h.name === dc.hardwareName) || HARDWARE_PRESETS[0];
  
  // Compute theoretical values
  const modelParams = calcModelParams(valModel);
  const peakTflops = dc.precisionUsed === 'fp8' && valHw.supportsFp8 ? (valHw.fp8Tflops || valHw.fp16Tflops) : valHw.fp16Tflops;
  
  // Total theoretical training FLOPs using 6ND vs 8ND formula (forward + backward)
  // 6×: no recompute (fwd 2x + bwd 4x = 6x)
  // 8×: full activation recompute (fwd 2x + recompute 2x + bwd 4x = 8x)  
  // 7×: selective recompute (DeepSeek-V3 uses this)
  const noRecomputeFLOPs = 6 * (modelParams.activatedPerToken || modelParams.total) * dc.totalTokens;
  const fullRecomputeFLOPs = 8 * (modelParams.activatedPerToken || modelParams.total) * dc.totalTokens;
  // Selective recompute ≈ 7x (DeepSeek-V3 selective recompute RMSNorm+MLA up-proj)
  const selectiveRecomputeFLOPs = 7 * (modelParams.activatedPerToken || modelParams.total) * dc.totalTokens;
  
  // Select the appropriate one based on paper info
  const totalTheoreticalFLOPs = dc.name.includes('DeepSeek-V3') ? selectiveRecomputeFLOPs : noRecomputeFLOPs;
  
  // Back-calculate actual MFU (with 6x baseline for reference)
  const actualMfuBf16_6x = backCalculateMFU(noRecomputeFLOPs, dc.numGpus, dc.actualGpuHours, valHw.fp16Tflops);
  const actualMfuBf16_8x = backCalculateMFU(fullRecomputeFLOPs, dc.numGpus, dc.actualGpuHours, valHw.fp16Tflops);
  const actualMfuBf16 = backCalculateMFU(totalTheoreticalFLOPs, dc.numGpus, dc.actualGpuHours, valHw.fp16Tflops);
  const actualMfuFp8 = backCalculateMFU(totalTheoreticalFLOPs, dc.numGpus, dc.actualGpuHours, peakTflops);
  
  // Error ratio: what our formula would predict vs actual
  // Using typical 40% MFU, what would our formula predict?
  const ourPredictedHours40 = totalTheoreticalFLOPs / (dc.numGpus * valHw.fp16Tflops * 0.40 * 1e12 * 3600);
  const ourPredictedHoursFp8_40 = totalTheoreticalFLOPs / (dc.numGpus * peakTflops * 0.40 * 1e12 * 3600);
  
  const errorBf16 = ((ourPredictedHours40 - dc.actualGpuHours) / dc.actualGpuHours) * 100;
  const errorFp8 = ((ourPredictedHoursFp8_40 - dc.actualGpuHours) / dc.actualGpuHours) * 100;
  
  // Per-trillion-token metrics
  const gpuHoursPerToken = dc.actualGpuHours / (dc.totalTokens / 1e12);
  const tokensPerGpuHour = dc.totalTokens / dc.actualGpuHours;

  return (
    <Section title="DeepSeek 公式验证 (论文校准)" icon="🔬">
      <div className="space-y-4">
        {/* Case selector */}
        <div className="flex flex-wrap gap-2">
          {DEEPSEEK_VALIDATIONS.map((v, i) => (
            <button
              key={v.name}
              onClick={() => setCaseIdx(i)}
              className={`px-3 py-2 rounded text-xs font-medium transition ${
                caseIdx === i
                  ? 'bg-amber-600 text-white'
                  : 'bg-[#1a1f35] text-gray-400 hover:bg-[#252a40]'
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>

        {/* Case description */}
        <div className="bg-[#1a1f35] rounded p-3 text-xs text-gray-400">
          {dc.description}
        </div>

        {/* Parameter summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Stat label="Activated Params/Token" value={formatParams(modelParams.activatedPerToken || modelParams.total)} />
          <Stat label="总 Tokens" value={`${(dc.totalTokens / 1e12).toFixed(1)}T`} />
          <Stat label="GPU 数量" value={dc.numGpus.toLocaleString()} />
          <Stat label="精度" value={dc.precisionUsed.toUpperCase()} />
        </div>

        {/* Main validation comparison */}
        <div className="bg-[#1a1f35] rounded p-4 space-y-3">
          <h4 className="text-xs font-semibold text-amber-400">实测 vs 公式预测对比</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-gray-400 mb-1">📊 论文实测数据</div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Pre-train:</span>
                  <span className="text-white font-mono">{(dc.preTrainHours / 1000).toFixed(0)}K GPU-hours</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Context Ext:</span>
                  <span className="text-white font-mono">{(dc.contextExtHours / 1000).toFixed(0)}K GPU-hours</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Post-train:</span>
                  <span className="text-white font-mono">{(dc.postTrainHours / 1000).toFixed(0)}K GPU-hours</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                  <span className="text-gray-400 font-semibold">总 GPU-hours:</span>
                  <span className="text-green-400 font-mono font-bold">{(dc.actualGpuHours / 1e6).toFixed(3)}M</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Wall-clock:</span>
                  <span className="text-white font-mono">{dc.actualDays.toFixed(1)} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">成本:</span>
                  <span className="text-white font-mono">${dc.totalCostMillion.toFixed(3)}M</span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-gray-400 mb-1">🧮 公式计算 (MFU=40%)</div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">理论 FLOPs:</span>
                  <span className="text-white font-mono">{formatNumber(totalTheoreticalFLOPs)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">预测 (BF16@40%):</span>
                  <span className="text-white font-mono">{(ourPredictedHours40 / 1000).toFixed(0)}K h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">预测 ({dc.precisionUsed.toUpperCase()}@40%):</span>
                  <span className="text-white font-mono">{(ourPredictedHoursFp8_40 / 1000).toFixed(0)}K h</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                  <span className="text-gray-500">误差 (BF16):</span>
                  <span className={`font-mono font-bold ${Math.abs(errorBf16) < 15 ? 'text-green-400' : 'text-red-400'}`}>
                    {errorBf16 > 0 ? '+' : ''}{errorBf16.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">误差 ({dc.precisionUsed.toUpperCase()}):</span>
                  <span className={`font-mono font-bold ${Math.abs(errorFp8) < 15 ? 'text-green-400' : 'text-red-400'}`}>
                    {errorFp8 > 0 ? '+' : ''}{errorFp8.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* MFU Back-calculation */}
        <div className="bg-[#1a1f35] rounded p-4 space-y-2">
          <h4 className="text-xs font-semibold text-amber-400">🔍 反推实际 MFU (校准系数)</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-gray-500">按 6×P·D (无重算)</div>
              <div className="text-lg font-mono text-gray-400">{(actualMfuBf16_6x * 100).toFixed(1)}%</div>
              <div className="text-gray-600">理论下限</div>
            </div>
            <div>
              <div className="text-gray-500">按 7×P·D (选择性)</div>
              <div className="text-lg font-mono text-amber-400">{(actualMfuBf16 * 100).toFixed(1)}%</div>
              <div className="text-gray-600">★ DeepSeek 采用</div>
            </div>
            <div>
              <div className="text-gray-500">按 8×P·D (全量重算)</div>
              <div className="text-lg font-mono text-gray-400">{(actualMfuBf16_8x * 100).toFixed(1)}%</div>
              <div className="text-gray-600">理论上限</div>
            </div>
            <div>
              <div className="text-gray-500">推荐 MFU 设定</div>
              <div className="text-lg font-mono text-green-400">{(actualMfuBf16 * 100 * 1.1).toFixed(0)}%</div>
              <div className="text-gray-600">建议用此值</div>
            </div>
          </div>
        </div>

        {/* Training efficiency metrics */}
        <div className="bg-[#1a1f35] rounded p-4 space-y-2">
          <h4 className="text-xs font-semibold text-amber-400">📈 训练效率指标</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="text-center">
              <div className="text-gray-500">GPU-hours / T tokens</div>
              <div className="text-white font-mono text-sm">{(gpuHoursPerToken / 1000).toFixed(0)}K</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500">Tokens / GPU-hour</div>
              <div className="text-white font-mono text-sm">{(tokensPerGpuHour / 1e6).toFixed(1)}M</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500">Cost / T tokens</div>
              <div className="text-white font-mono text-sm">${((dc.totalCostMillion * 1e6) / (dc.totalTokens / 1e12) / 1000).toFixed(0)}K</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500">Peak 利用率 (FP8)</div>
              <div className="text-white font-mono text-sm">{(actualMfuFp8 * 100).toFixed(1)}%</div>
            </div>
          </div>
        </div>

        {/* Calibration notes */}
        <div className="bg-amber-900/20 border border-amber-700/30 rounded p-3 text-xs text-amber-200/80">
          <strong className="text-amber-400">💡 校准建议:</strong>
          <ul className="mt-1 space-y-1 list-disc list-inside text-amber-200/70">
            <li><strong>6×P·D</strong>: 无重算, 存全部激活 (最省算力, 最费显存)</li>
            <li><strong>8×P·D</strong>: 全量激活重算, 最省显存 (额外 +33% 计算量)</li>
            <li><strong>DeepSeek 实际 ≈ 7×P·D</strong>: 选择性重算 (仅 RMSNorm、MLA 上投影)</li>
            <li>大规模训练建议: 使用全量重算 (8×) 换显存, MFU 上限约 35% (BF16)</li>
            <li>建议 MFU: <strong className="text-amber-300">{(Math.round(actualMfuBf16 * 100 * 1.1))}%</strong> (已含重算开销)</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#121625] border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#1a1f35] rounded px-2 py-1">
      <span className="text-gray-500">{label}: </span>
      <span className="text-gray-200 font-mono">{value}</span>
    </div>
  );
}

function InputNumber({
  label,
  value,
  onChange,
  min = 0,
  max = 1000000,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="w-full bg-[#1a1f35] border border-gray-700 rounded px-2 py-1 text-sm mt-1 font-mono"
      />
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  color: 'blue' | 'purple' | 'green' | 'red';
}) {
  const colors = {
    blue: 'border-blue-500/30 bg-blue-500/5',
    purple: 'border-purple-500/30 bg-purple-500/5',
    green: 'border-green-500/30 bg-green-500/5',
    red: 'border-red-500/30 bg-red-500/5',
  };
  const textColors = {
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    green: 'text-green-400',
    red: 'text-red-400',
  };
  return (
    <div className={`border rounded-lg p-3 ${colors[color]}`}>
      <div className="text-xs text-gray-400">{title}</div>
      <div className={`text-xl font-mono font-bold ${textColors[color]}`}>{value}</div>
      <div className="text-[10px] text-gray-500 mt-1">{subtitle}</div>
    </div>
  );
}

function MemoryBar({
  label,
  bytes,
  total,
  color,
}: {
  label: string;
  bytes: number;
  total: number;
  color: string;
}) {
  const pct = (bytes / total) * 100;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{formatBytes(bytes)}</span>
      </div>
      <div className="h-4 bg-[#1a1f35] rounded overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-600 text-right">{pct.toFixed(1)}%</div>
    </div>
  );
}

function BudgetIndicator({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = (used / total) * 100;
  const ok = pct < 100;
  return (
    <div className="flex-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={ok ? 'text-green-400' : 'text-red-400'}>
          {used.toFixed(1)} / {total.toFixed(1)} GiB ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-3 bg-[#1a1f35] rounded mt-1 overflow-hidden">
        <div
          className={`h-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function CommItem({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="bg-[#1a1f35] rounded p-2 text-center">
      <div className="text-gray-500">{label}</div>
      <div className="text-white font-mono">{ms < 0.01 ? '<0.01' : ms.toFixed(2)} ms</div>
    </div>
  );
}

// ===== Paper Mode Toggle =====
function PaperModeToggle({ paperModeState, time, mfu }: {
  paperModeState: [boolean, (v: boolean) => void],
  time: { totalTrainingHours: number, effectiveHours: number },
  mfu: number,
}) {
  const [paperMode, setPaperMode] = paperModeState;
  
  return (
    <div className="bg-[#0d1220] border border-dashed border-cyan-700/30 rounded px-2 py-1.5">
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={paperMode} onChange={(e) => setPaperMode(e.target.checked)} className="rounded" />
        <span className="text-gray-300">📝 论文简化模式</span>
        <span className="text-gray-600 ml-1">(匹配 6ND/7ND 公式)</span>
      </label>
      <div className="mt-1 text-[10px] text-gray-500">
        开启后忽略 Embedding / MTP / Attention Score FLOPs → 与论文公式一致
        {paperMode && (
          <span className="text-cyan-400 ml-2">
            预计节省 {(((time.effectiveHours - time.effectiveHours) / time.effectiveHours) * 100).toFixed(0)}% FLOPs
          </span>
        )}
      </div>
    </div>
  );
}

function CostEstimate({ totalHours, numNodes, costPerGpuHourUsd, numTokens }: { totalHours: number; numNodes: number; costPerGpuHourUsd: number; numTokens: number }) {
  const gpuCostPerHour = costPerGpuHourUsd;
  const totalCostUsd = totalHours * numNodes * 8 * gpuCostPerHour;
  const cloudCostUsd = totalCostUsd * 1.5;  // 云服务溢价 50%
  const totalMillionTokens = numTokens * 1000;  // numTokens 单位是 B (billions), 转 millions
  const costPerMillionTokens = totalMillionTokens > 0 ? totalCostUsd / totalMillionTokens : 0;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      <div className="bg-[#1a1f35] rounded p-3">
        <div className="text-gray-400">自有机群</div>
        <div className="text-sm font-mono text-yellow-400">${(totalCostUsd / 1000).toFixed(1)}K</div>
        <div className="text-gray-600">${gpuCostPerHour}/GPU/h × {numNodes} nodes</div>
      </div>
      <div className="bg-[#1a1f35] rounded p-3">
        <div className="text-gray-400">云服务</div>
        <div className="text-sm font-mono text-orange-400">${(cloudCostUsd / 1000).toFixed(1)}K</div>
        <div className="text-gray-600">含 50% 溢价</div>
      </div>
      <div className="bg-[#1a1f35] rounded p-3">
        <div className="text-gray-400">每百万 Tokens</div>
        <div className="text-sm font-mono text-green-400">
          ${costPerMillionTokens.toFixed(2)}
        </div>
        <div className="text-gray-600">基于当前配置</div>
      </div>
    </div>
  );
}

function formatMath(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}
