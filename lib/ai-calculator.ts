/**
 * AI Training Compute Calculator - Core Engine
 * 
 * Based on formulas from:
 * - IIIS Turing LLM Training Calculator
 * - DeepSeek-V3 Technical Report (arXiv:2412.19437)
 * - Kaplan et al. Scaling Laws (2020)
 * - Megatron-LM parallelism theory
 * 
 * Key corrections for MoE/MLA:
 * - MoE FLOPs use activated params, not total params
 * - MLA has separate compression/decompression projections
 * - Hybrid Dense+MoE layer structure supported
 * - Multi-Token Prediction overhead included
 */

// ============================================================
// Types
// ============================================================

export interface ModelConfig {
  name: string;
  type: 'dense' | 'moe';
  attentionType: 'mha' | 'gqa' | 'mla';
  hiddenSize: number;
  numLayers: number;
  numAttentionHeads: number;
  numKvHeads?: number;    // GQA: KV head count (e.g. 8)
  headDim: number;
  vocabSize: number;
  seqLen: number;
  // Dense FFN
  intermediateSize?: number;
  // MoE specific
  numRoutedExperts?: number;
  numSharedExperts?: number;
  expertsPerToken?: number;
  moeIntermediateSize?: number;
  // MLA specific
  kvLoraRank?: number;
  qLoraRank?: number;
  qkNopeHeadDim?: number;
  qkRopeHeadDim?: number;
  vHeadDim?: number;
  // MTP
  numMtpModules?: number;
  // Dense first N layers
  firstKDenseLayers?: number;
  // Training tokens (from paper)
  paperTokens?: number;
  // Precision used in paper
  paperPrecision?: 'bf16' | 'fp8' | 'mixed';
  // Derived
  totalParams?: number;
  activatedParamsPerToken?: number;
}

export interface HardwareConfig {
  name: string;
  fp16Tflops: number;      // BF16/FP16算力
  fp32Tflops: number;      // FP32算力
  memoryGb: number;         // HBM容量
  memoryBandwidthTbs: number; // 显存带宽 TB/s
  busBandwidthGbs: number;  // 片间总线带宽 GB/s
  networkBandwidthGbs: number; // 网络带宽 GB/s
  supportsFp8: boolean;
  fp8Tflops?: number;
  costPerGpuHourUsd?: number; // 参考成本 (USD/GPU/h), 来源于论文实测或用户填写
}

export interface ParallelConfig {
  tp: number;  // Tensor Parallelism
  pp: number;  // Pipeline Parallelism
  dp: number;  // Data Parallelism
  ep: number;  // Expert Parallelism
  microBatchSize: number;
  optimizationStrategy: 'full_recompute' | 'selective_recompute' | 'no_recompute';
}

export interface TrainingConfig {
  phase: 'pretrain' | 'sft' | 'rlhf' | 'dpo';
  batchSize: number;
  numTokens: number;
  epochs: number;
  mfu: number;
  precision: 'fp8' | 'bf16' | 'fp16';
  fp8Ratio: number;
  clusterUptime: number;
  gradAccumSteps: number;
  seqLen?: number;      // 训练序列长度（独立于模型最大上下文，长上下文模型训练通常用较短序列）
  paperMode: boolean;   // 论文简化模式: 忽略embedding/MTP/attention-score FLOPs (匹配6ND/7ND)
}

export interface CalculationResult {
  // Parameters
  modelParams: {
    total: number;
    activatedPerToken: number;
    embedding: number;
    attentionPerLayer: number;
    ffnPerLayer: number;
    positionEmbedding: number;
  };
  // FLOPs
  flops: {
    forwardPerToken: number;
    backwardPerToken: number;
    totalPerToken: number;          // 3x forward for training
    forwardPerSample: number;       // per (batch × seq)
    totalPerSample: number;         // forward+backward+recompute per sample
    totalTraining: number;          // total for all tokens
    mfuEffective: number;           // actual achieved FLOPs
  };
  // Memory (per GPU, bytes)
  memory: {
    optimizer: number;
    weights: number;
    gradients: number;
    activation: number;
    total: number;
    totalGb: number;
    withinBudget: number;           // how much headroom (negative = OOM)
  };
  // Time
  time: {
    forwardStep: number;
    backwardStep: number;
    perIteration: number;
    totalIterations: number;
    computeHours: number; // 纯计算时间 (无任何开销)
    computeDays: number;
    totalTrainingHours: number;
    totalTrainingDays: number;
    effectiveHours: number; // 含 downtime 的实际耗时
    effectiveDays: number;
    downtimeHours: number;
    clusterUptime: number;
    bubbleFraction: number; // Pipeline Bubble 占比 (0-1)
    bubbleHours: number; // 总 bubble 损失时间
    bubbleDays: number;
    coreMFU: number; // GPU 核心在做 matmuls 时的效率 (slider 输入)
    effectiveMFU: number; // 端到端有效利用率 (coreMFU × (1-bubble) × uptime)
  };
  // Cluster
  cluster: {
    totalGpus: number;
    numNodes: number;               // assuming 8 GPUs per node
    dpSize: number;
  };
  // Communication
  communication: {
    allGatherTime: number;
    allReduceTime: number;
    p2pTime: number;
    allToAllTime: number;           // MoE specific
    totalCommFraction: number;      // fraction of time spent in comm
  };
  // Phase-specific adjustments
  phaseInfo: {
    name: string;
    relativeCost: number;           // relative to pretrain
    description: string;
  };
}

// ============================================================
// Model Presets
// ============================================================

export const MODEL_PRESETS: ModelConfig[] = [
  // ============================================================
  // Qwen 系列（按参数从大到小）
  // ============================================================
  {
    name: 'Qwen3-235B-A22B (MoE)',
    type: 'moe',
    attentionType: 'gqa',
    hiddenSize: 4096,
    numLayers: 94,
    numAttentionHeads: 64,
    numKvHeads: 4,
    headDim: 128,
    vocabSize: 151936,
    seqLen: 40960,
    firstKDenseLayers: 0,
    numRoutedExperts: 128,
    numSharedExperts: 0,
    expertsPerToken: 8,
    moeIntermediateSize: 1536,
    intermediateSize: 12288,
    numMtpModules: 0,
    paperTokens: 36000,
    paperPrecision: 'bf16',
  },
  {
    name: 'Qwen2.5-72B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 8192,
    numLayers: 80,
    numAttentionHeads: 64,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 151936,
    seqLen: 131072,
    intermediateSize: 29568,
    paperTokens: 18000,
    paperPrecision: 'bf16',
  },
  {
    name: 'Qwen2.5-32B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 5120,
    numLayers: 64,
    numAttentionHeads: 40,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 151936,
    seqLen: 131072,
    intermediateSize: 27648,
    paperTokens: 18000,
    paperPrecision: 'bf16',
  },
  {
    name: 'Qwen2.5-14B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 5120,
    numLayers: 48,
    numAttentionHeads: 40,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 151936,
    seqLen: 131072,
    intermediateSize: 13824,
    paperTokens: 18000,
    paperPrecision: 'bf16',
  },
  {
    name: 'Qwen2.5-7B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 3584,
    numLayers: 28,
    numAttentionHeads: 28,
    numKvHeads: 4,
    headDim: 128,
    vocabSize: 151936,
    seqLen: 131072,
    intermediateSize: 18944,
    paperTokens: 18000,
    paperPrecision: 'bf16',
  },
  {
    name: 'Qwen2.5-1.5B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 1536,
    numLayers: 28,
    numAttentionHeads: 12,
    numKvHeads: 2,
    headDim: 128,
    vocabSize: 151936,
    seqLen: 32768,
    intermediateSize: 8960,
    paperTokens: 18000,
    paperPrecision: 'bf16',
  },
  // ============================================================
  // DeepSeek 系列（按参数从大到小）
  // DeepSeek V4 系列：无正式技术报告，参考 DeepSeek-V3 (14.8T) 估算 — 待官方更新
  {
    name: 'DeepSeek-V4-Pro (1.6T/49B)',
    type: 'moe',
    attentionType: 'gqa',
    hiddenSize: 9216,
    numLayers: 112,
    numAttentionHeads: 64,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 129280,
    seqLen: 1048576,
    firstKDenseLayers: 0,
    numRoutedExperts: 512,
    numSharedExperts: 4,
    expertsPerToken: 8,
    moeIntermediateSize: 3072,
    intermediateSize: 27648,
    numMtpModules: 0,
    paperTokens: 14800,
    paperPrecision: 'mixed',
  },
  {
    name: 'DeepSeek-V3 (671B/37B)',
    type: 'moe',
    attentionType: 'mla',
    hiddenSize: 7168,
    numLayers: 61,
    numAttentionHeads: 128,
    headDim: 128,
    vocabSize: 129280,
    seqLen: 4096,
    firstKDenseLayers: 3,
    numRoutedExperts: 256,
    numSharedExperts: 1,
    expertsPerToken: 8,
    moeIntermediateSize: 2048,
    intermediateSize: 18432,
    kvLoraRank: 512,
    qLoraRank: 1536,
    qkNopeHeadDim: 128,
    qkRopeHeadDim: 64,
    vHeadDim: 128,
    numMtpModules: 1,
    paperTokens: 14800,
    paperPrecision: 'fp8',
  },
  {
    name: 'DeepSeek-V4-Flash (284B/13B)',
    type: 'moe',
    attentionType: 'gqa',
    hiddenSize: 6144,
    numLayers: 48,
    numAttentionHeads: 48,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 129280,
    seqLen: 1048576,
    firstKDenseLayers: 0,
    numRoutedExperts: 256,
    numSharedExperts: 3,
    expertsPerToken: 6,
    moeIntermediateSize: 2048,
    intermediateSize: 18432,
    numMtpModules: 0,
    paperTokens: 14800,
    paperPrecision: 'bf16',
  },
  {
    name: 'DeepSeek-V2 (236B/21B)',
    type: 'moe',
    attentionType: 'mla',
    hiddenSize: 5120,
    numLayers: 60,
    numAttentionHeads: 128,
    headDim: 128,
    vocabSize: 102400,
    seqLen: 4096,
    firstKDenseLayers: 1,
    numRoutedExperts: 160,
    numSharedExperts: 2,
    expertsPerToken: 6,
    moeIntermediateSize: 1408,
    intermediateSize: 10920,
    kvLoraRank: 512,
    qLoraRank: 1536,
    qkNopeHeadDim: 128,
    qkRopeHeadDim: 64,
    vHeadDim: 128,
    numMtpModules: 0,
    paperTokens: 8100,
    paperPrecision: 'bf16',
  },
  // ============================================================
  // 其他（LLaMA / Mistral / Mixtral / InternLM / GLM，按参数从大到小）
  // ============================================================
  {
    name: 'LLaMA-3.1-405B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 16384,
    numLayers: 126,
    numAttentionHeads: 128,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 128256,
    seqLen: 131072,
    intermediateSize: 53248,
    paperTokens: 15000,
    paperPrecision: 'bf16',
  },
  {
    name: 'Mixtral-8x22B (MoE, 141B/39B)',
    type: 'moe',
    attentionType: 'gqa',
    hiddenSize: 6144,
    numLayers: 56,
    numAttentionHeads: 48,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 32000,
    seqLen: 65536,
    firstKDenseLayers: 0,
    numRoutedExperts: 8,
    numSharedExperts: 0,
    expertsPerToken: 2,
    moeIntermediateSize: 16384,
    numMtpModules: 0,
    paperPrecision: 'bf16',
  },
  {
    name: 'Mistral-Large-2-123B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 12288,
    numLayers: 88,
    numAttentionHeads: 96,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 32768,
    seqLen: 131072,
    intermediateSize: 28672,
    paperPrecision: 'bf16',
  },
  {
    name: 'LLaMA-3.1-70B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 8192,
    numLayers: 80,
    numAttentionHeads: 64,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 128256,
    seqLen: 131072,
    intermediateSize: 28672,
    paperTokens: 15000,
    paperPrecision: 'bf16',
  },
  {
    name: 'InternLM2.5-20B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 6144,
    numLayers: 48,
    numAttentionHeads: 48,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 103168,
    seqLen: 1048576,
    intermediateSize: 16384,
    paperTokens: 2000,
    paperPrecision: 'bf16',
  },
  {
    name: 'GLM4-9B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 4096,
    numLayers: 40,
    numAttentionHeads: 32,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 151322,
    seqLen: 131072,
    intermediateSize: 13696,
    paperPrecision: 'bf16',
  },
  {
    name: 'LLaMA-3.1-8B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 4096,
    numLayers: 32,
    numAttentionHeads: 32,
    numKvHeads: 8,
    headDim: 128,
    vocabSize: 128256,
    seqLen: 131072,
    intermediateSize: 14336,
    paperTokens: 15000,
    paperPrecision: 'bf16',
  },
  {
    name: 'InternLM2.5-7B',
    type: 'dense',
    attentionType: 'gqa',
    hiddenSize: 4096,
    numLayers: 32,
    numAttentionHeads: 32,
    numKvHeads: 4,
    headDim: 128,
    vocabSize: 103168,
    seqLen: 1048576,
    intermediateSize: 14336,
    paperTokens: 2000,
    paperPrecision: 'bf16',
  },
  // ============================================================
  // 自定义
  // ============================================================
  {
    name: 'Custom Dense',
    type: 'dense',
    attentionType: 'mha',
    hiddenSize: 4096,
    numLayers: 32,
    numAttentionHeads: 32,
    headDim: 128,
    vocabSize: 32000,
    seqLen: 4096,
    intermediateSize: 11008,
  },
  {
    name: 'Custom MoE',
    type: 'moe',
    attentionType: 'mla',
    hiddenSize: 4096,
    numLayers: 32,
    numAttentionHeads: 32,
    headDim: 128,
    vocabSize: 32000,
    seqLen: 4096,
    firstKDenseLayers: 2,
    numRoutedExperts: 64,
    numSharedExperts: 2,
    expertsPerToken: 4,
    moeIntermediateSize: 1408,
    intermediateSize: 11008,
    kvLoraRank: 256,
    qLoraRank: 768,
    qkNopeHeadDim: 64,
    qkRopeHeadDim: 32,
    vHeadDim: 64,
    numMtpModules: 0,
  },
];


// ============================================================
// Hardware Presets (Huawei Ascend)
// ============================================================

export const HARDWARE_PRESETS: HardwareConfig[] = [
  {
    name: 'NVIDIA H800 × 8 (Node)',
    fp16Tflops: 989,
    fp32Tflops: 495,
    memoryGb: 80,
    memoryBandwidthTbs: 3.35,
    busBandwidthGbs: 900,
    networkBandwidthGbs: 400,
    supportsFp8: true,
    fp8Tflops: 1979,
    costPerGpuHourUsd: 2.09,  // DeepSeek-V3 论文: $5.576M / (2048 GPU × 1301h)
  },
  {
    name: 'NVIDIA H100 × 8 (Node)',
    fp16Tflops: 989,
    fp32Tflops: 495,
    memoryGb: 80,
    memoryBandwidthTbs: 3.35,
    busBandwidthGbs: 900,
    networkBandwidthGbs: 400,
    supportsFp8: true,
    fp8Tflops: 1979,
    costPerGpuHourUsd: 2.09,  // 同 H800 参考
  },
  {
    name: 'NVIDIA A100 × 8 (Node)',
    fp16Tflops: 312,
    fp32Tflops: 156,
    memoryGb: 80,
    memoryBandwidthTbs: 2.0,
    busBandwidthGbs: 600,
    networkBandwidthGbs: 200,
    supportsFp8: false,
  },
  {
    name: 'Ascend 910B × 8 (Node)',
    fp16Tflops: 320,
    fp32Tflops: 160,
    memoryGb: 64,
    memoryBandwidthTbs: 1.28,
    busBandwidthGbs: 900,
    networkBandwidthGbs: 200,
    supportsFp8: true,
    fp8Tflops: 640,
  },
  {
    name: 'Ascend 910C × 8 (Node)',
    fp16Tflops: 450,
    fp32Tflops: 225,
    memoryGb: 96,
    memoryBandwidthTbs: 1.6,
    busBandwidthGbs: 1200,
    networkBandwidthGbs: 400,
    supportsFp8: true,
    fp8Tflops: 900,
  },
  {
    name: 'Ascend 950DT/850E × 8 (单Node)',
    fp16Tflops: 486,
    fp32Tflops: 243,
    memoryGb: 96,
    memoryBandwidthTbs: 4.0,
    busBandwidthGbs: 784,
    networkBandwidthGbs: 784,
    supportsFp8: true,
    fp8Tflops: 972,
    costPerGpuHourUsd: 0.25,  // 8万/卡 ÷ 5年(43800h) ≈ 1.83元/h ≈ $0.25/h
  },
  {
    name: 'Custom Hardware',
    fp16Tflops: 320,
    fp32Tflops: 160,
    memoryGb: 64,
    memoryBandwidthTbs: 1.2,
    busBandwidthGbs: 900,
    networkBandwidthGbs: 200,
    supportsFp8: false,
  },
];

// ============================================================
// DeepSeek-V3 实际训练参数（用于验证公式）
// ============================================================

export interface DeepSeekValidationData {
  name: string;
  description: string;
  modelName: string;
  hardwareName: string;
  numGpus: number;
  totalTokens: number;         // total training tokens
  contextLen: number;           // max sequence length
  batchSize: number;            // peak batch size
  // Actual results from paper
  actualGpuHours: number;       // total GPU hours
  actualDays: number;           // wall-clock days
  actualMfu?: number;           // if paper reports
  // Phase breakdown
  preTrainHours: number;
  contextExtHours: number;
  postTrainHours: number;
  // Cost
  totalCostMillion: number;
  // Precision used
  precisionUsed: 'fp8' | 'bf16' | 'mixed';
}

export const DEEPSEEK_VALIDATIONS: DeepSeekValidationData[] = [
  {
    name: 'DeepSeek-V3',
    description: '671B MoE (37B act), 14.8T tokens, 2048×H800, FP8混合精度',
    modelName: 'DeepSeek-V3 (671B/37B)',
    hardwareName: 'NVIDIA H800 × 8 (Node)',
    numGpus: 2048,
    totalTokens: 14.8e12,
    contextLen: 4096,
    batchSize: 15360,
    actualGpuHours: 2.664e6,
    actualDays: 54.2,
    preTrainHours: 2.664e6,
    contextExtHours: 119e3,
    postTrainHours: 5e3,
    totalCostMillion: 5.576,
    precisionUsed: 'fp8',
  },
  {
    name: 'DeepSeek-V3 (1T 里程碑)',
    description: '仅万亿token热身阶段, 3.7天验证',
    modelName: 'DeepSeek-V3 (671B/37B)',
    hardwareName: 'NVIDIA H800 × 8 (Node)',
    numGpus: 2048,
    totalTokens: 1.0e12,
    contextLen: 4096,
    batchSize: 15360,
    actualGpuHours: 179.7e3,
    actualDays: 3.7,
    preTrainHours: 179.7e3,
    contextExtHours: 0,
    postTrainHours: 0,
    totalCostMillion: 0.36,
    precisionUsed: 'fp8',
  },
  {
    name: 'DeepSeek-V2',
    description: '236B MoE (21B act), 8.1T tokens, 16K GPUs',
    modelName: 'DeepSeek-V2 (236B/21B)',
    hardwareName: 'NVIDIA H800 × 8 (Node)',
    numGpus: 16384,
    totalTokens: 8.1e12,
    contextLen: 4096,
    batchSize: 9216,
    actualGpuHours: 1.2e6,
    actualDays: 30.7,
    preTrainHours: 1.2e6,
    contextExtHours: 0,
    postTrainHours: 10e3,
    totalCostMillion: 5.3,
    precisionUsed: 'bf16',
  },
];

/**
 * 基于实际 GPU-hours 反推实际 MFU
 */
export function backCalculateMFU(
  totalFLOPs: number,
  numGpus: number,
  totalGpuHours: number,
  peakTflopsPerGpu: number
): number {
  // MFU = Total FLOPs / (num_gpus × peak_flops_per_gpu × total_seconds)
  const totalSecs = totalGpuHours * 3600;
  const peakFlopsPerGpuPerSec = peakTflopsPerGpu * 1e12;
  const totalPeakFlops = numGpus * peakFlopsPerGpuPerSec * totalSecs;
  return totalFLOPs / totalPeakFlops;
}

// ============================================================
// Training Phase Configs
// ============================================================

export const PHASE_CONFIGS = {
  pretrain: {
    name: '预训练 (Pre-training)',
    description: '从头训练，FLOPs = 6 × activated_params × tokens',
    relativeCompute: 1.0,
    defaultMfu: 0.40,
    defaultPrecision: 'bf16' as const,
  },
  sft: {
    name: '有监督微调 (SFT)',
    description: '通常 0.1-1% of pretrain cost',
    relativeCompute: 0.004,
    defaultMfu: 0.38,
    defaultPrecision: 'bf16' as const,
  },
  rlhf: {
    name: '强化学习 (RLHF/DPO)',
    description: '类似 SFT，需要额外 critic/reward 模型资源',
    relativeCompute: 0.005,
    defaultMfu: 0.35,
    defaultPrecision: 'bf16' as const,
  },
  dpo: {
    name: 'DPO 对齐',
    description: '比 RLHF 更高效，不需要 critic 模型',
    relativeCompute: 0.002,
    defaultMfu: 0.38,
    defaultPrecision: 'bf16' as const,
  },
};

// ============================================================
// Core Calculation Functions
// ============================================================

/**
 * Calculate model parameters
 */
export function calcModelParams(model: ModelConfig) {
  const { hiddenSize: d, numLayers: L, numAttentionHeads: nh, headDim: dh, vocabSize: v } = model;
  
  const embedding = d * v;
  const positionEmbedding = 0;  // Modern models use RoPE (no learnable position embeddings)
  let attentionPerLayer: number;
  if (model.attentionType === 'mla') {
    // MLA attention (DeepSeek-style)
    const c_kv = model.kvLoraRank!;       // 512
    const c_q = model.qLoraRank!;         // 1536
    const d_nope = model.qkNopeHeadDim!;  // 128
    const d_rope = model.qkRopeHeadDim!;  // 64
    const d_v = model.vHeadDim!;          // 128
    
    // Q projections: down + up
    const qDown = d * c_q;                    // W_DQ
    const qUp = c_q * nh * d_nope;            // W_QN
    // KV projections: down + up  
    const kvDown = d * (c_kv + d_rope);       // W_DKV + W_KR
    const kvUp = c_kv * nh * (d_nope + d_v);  // W_KN + W_VN
    // Output
    const outProj = nh * d_v * d;
    
    attentionPerLayer = qDown + qUp + kvDown + kvUp + outProj;
  } else if (model.attentionType === 'gqa') {
    // GQA attention (Qwen2.5, LLaMA-3, etc.)
    // Q: d × (nh×dh), O: (nh×dh) × d (supports nh*dh != d, e.g. Qwen3-235B)
    // K: d × (n_kv×dh), V: d × (n_kv×dh)  — compressed by KV head ratio
    const n_kv = model.numKvHeads || nh;  // fallback to MHA if not specified
    const d_head = dh || (d / nh);
    const qDim = nh * d_head;              // total Q head dimension
    const qProj = d * qDim;                 // W_Q: hiddenSize → Q heads
    const oProj = qDim * d;                 // W_O: Q heads → hiddenSize
    const kProj = d * n_kv * d_head;        // W_K (compressed)
    const vProj = d * n_kv * d_head;        // W_V (compressed)
    attentionPerLayer = qProj + oProj + kProj + vProj;
  } else {
    // Standard MHA
    attentionPerLayer = 4 * d * d;  // Q, K, V projections + output
  }
  
  // Per-layer FFN
  let ffnPerLayer: number;
  if (model.type === 'moe' && model.numRoutedExperts) {
    // MoE: shared experts + routed experts
    const shared = model.numSharedExperts || 1;
    const routed = model.numRoutedExperts;
    const moeInter = model.moeIntermediateSize || 2048;
    // Shared expert
    const sharedFFN = shared * (3 * d * moeInter);  // gate + up + down
    // Routed expert (only activated ones used for FLOPs)
    const routedFFN = routed * (3 * d * moeInter);
    // Router
    const router = d * routed;
    ffnPerLayer = sharedFFN + routedFFN + router;
  } else {
    // Dense FFN (SwiGLU: gate_proj + up_proj + down_proj)
    ffnPerLayer = 3 * d * (model.intermediateSize || d * 3);
  }
  
  const layerParams = attentionPerLayer + ffnPerLayer;
  const totalParams = embedding + positionEmbedding + layerParams * L;
  
  // Activated params per token (for MoE)
  let activatedParamsPerToken: number;
  if (model.type === 'moe' && model.numRoutedExperts) {
    const moeInter = model.moeIntermediateSize || 2048;
    const nShared = model.numSharedExperts || 1;
    const nActivated = model.expertsPerToken || 8;
    const denseOnly = (model.firstKDenseLayers || 0);
    const moeLayers = L - denseOnly;
    
    // Dense layers contribute fully
    const denseParams = denseOnly * (attentionPerLayer + 3 * d * (model.intermediateSize || d * 3));
    // MoE layers: shared (always) + activated experts
    const moeParams = moeLayers * (
      attentionPerLayer + 
      nShared * 3 * d * moeInter + 
      nActivated * 3 * d * moeInter +
      d * model.numRoutedExperts
    );
    // Average per layer (since first K layers are dense)
    activatedParamsPerToken = embedding + positionEmbedding + denseParams + moeParams;
  } else {
    activatedParamsPerToken = totalParams;
  }
  
  return {
    total: totalParams,
    activatedPerToken: activatedParamsPerToken,
    embedding,
    attentionPerLayer,
    ffnPerLayer,
    positionEmbedding,
    layerParams,
  };
}

/**
 * Calculate FLOPs for attention mechanism
 */
function calcAttentionFlops(model: ModelConfig, batchSize: number, seqLen: number, paperMode: boolean): number {
  const d = model.hiddenSize;
  const nh = model.numAttentionHeads;
  const dh = model.headDim || (d / nh);
  const L = model.numLayers;
  
  if (model.attentionType === 'mla') {
    // MLA FLOPs per token per layer (DeepSeek)
    const c_kv = model.kvLoraRank!;
    const c_q = model.qLoraRank!;
    const d_nope = model.qkNopeHeadDim!;
    const d_rope = model.qkRopeHeadDim!;
    const d_v = model.vHeadDim!;
    
    // Projections (per sequence; multiply by batchSize for full batch)
    const qDownFlops = 2 * seqLen * d * c_q;
    const qUpFlops = 2 * seqLen * c_q * nh * d_nope;
    const kvDownFlops = 2 * seqLen * d * (c_kv + d_rope);
    const kvUpFlops = 2 * seqLen * c_kv * nh * (d_nope + d_v);
    const outFlops = 2 * seqLen * nh * d_v * d;
    
    // Attention scores (causal = /2) — 包含在论文 2×P·D 公式中
    const attnScoreFlops = seqLen * seqLen * nh * d_nope;  // already ÷2 with causal
    const qkvFlops = seqLen * seqLen * nh * d_v;
    
    return (qDownFlops + qUpFlops + kvDownFlops + kvUpFlops + outFlops + 
            attnScoreFlops + qkvFlops) * L * batchSize;
  } else if (model.attentionType === 'gqa') {
    // GQA FLOPs (Qwen2.5, LLaMA-3, etc.)
    // Q, O: full head count; K, V: compressed (n_kv heads)
    const n_kv = model.numKvHeads || nh;
    const totalQDim = nh * dh;  // total Q head dimension (supports != d, e.g. Qwen3-235B)
    // Projections: Q (d×qDim), O (qDim×d), K (d × n_kv×dh), V (d × n_kv×dh)
    const qFlops = 2 * batchSize * seqLen * d * totalQDim;
    const oFlops = 2 * batchSize * seqLen * totalQDim * d;
    const kFlops = 2 * batchSize * seqLen * d * (n_kv * dh);
    const vFlops = 2 * batchSize * seqLen * d * (n_kv * dh);
    // Attention: QK^T uses nh heads (K broadcast), softmax×V uses nh heads
    const attnFlops = batchSize * seqLen * seqLen * nh * dh * 2;
    return (qFlops + oFlops + kFlops + vFlops + attnFlops) * L;
  } else {
    // Standard MHA: 4 projections + attention (multiply by batchSize)
    const projFlops = 4 * batchSize * (2 * seqLen * d * d);  // Q,K,V,O each: 2*seq*d*d*batch
    const attnFlops = batchSize * seqLen * seqLen * nh * dh * 2;  // QK^T + softmax*V, causal not counted
    return (projFlops + attnFlops) * L;
  }
}

/**
 * Calculate FFN FLOPs
 */
function calcFFNFlops(model: ModelConfig, batchSize: number, seqLen: number): number {
  const d = model.hiddenSize;
  const L = model.numLayers;
  const s = seqLen;
  const b = batchSize;
  
  if (model.type === 'moe' && model.numRoutedExperts) {
    const moeInter = model.moeIntermediateSize || 2048;
    const nShared = model.numSharedExperts || 1;
    const nActivated = model.expertsPerToken || 8;
    const nRouted = model.numRoutedExperts;
    const denseOnly = model.firstKDenseLayers || 0;
    const moeLayers = L - denseOnly;
    
    // Dense layers FFN
    const denseInter = model.intermediateSize || d * 3;
    const denseFFN = denseOnly * (2 * 3 * s * b * d * denseInter);
    
    // MoE layers FFN (only activated experts)
    const sharedFFN = moeLayers * (2 * 3 * s * b * d * moeInter * nShared);
    const activatedFFN = moeLayers * (2 * 3 * s * b * d * moeInter * nActivated);
    const routingFFN = moeLayers * (2 * s * b * d * nRouted);
    
    return denseFFN + sharedFFN + activatedFFN + routingFFN;
  } else {
    const inter = model.intermediateSize || d * 3;
    return L * (2 * 3 * s * b * d * inter);  // SwiGLU: gate + up + down
  }
}

/**
 * Calculate MTP (Multi-Token Prediction) FLOPs
 */
function calcMtpFlops(model: ModelConfig, batchSize: number, seqLen: number): number {
  const nMtp = model.numMtpModules || 0;
  if (nMtp === 0) return 0;
  
  // MTP adds roughly 10% of base model FLOPs per module
  // Each MTP has: embedding + mla + moe/dense + linear_proj
  const baseFFN = calcFFNFlops(model, batchSize, seqLen) * 0.05;  // ~5% per module
  const baseAttn = calcAttentionFlops(model, batchSize, seqLen, false) * 0.03;
  return nMtp * (baseFFN + baseAttn);
}

/**
 * Main calculation entry point
 * 
 * Training FLOPs with activation recomputation consideration:
 * 
 * Standard (no recompute, store activations): FLOPs = 6 × P × D
 *   - Forward:  2 × P × D
 *   - Backward: 4 × P × D (compute dX, dW)
 *   - Total:    6 × P × D
 * 
 * Full recomputation (full checkpointing, save only input per stage): FLOPs = 8 × P × D
 *   - Forward:  2 × P × D (no activations saved)
 *   - Recompute: 2 × P × D (recompute all activations during backward)
 *   - Backward: 4 × P × D (standard backward with rebuilt activations)
 *   - Total:    8 × P × D  (额外 +33% over standard)
 * 
 * Selective recomputation (recompute only heavy parts like attention): FLOPs ≈ 6.5-7 × P × D
 *   - Forward:  2 × P × D
 *   - Partial recompute: ~0.5-1 × P × D
 *   - Backward: 4 × P × D
 *   - Total:    6.5-7 × P × D
 * 
 * Reference: 
 * - DeepSeek-V3 paper: explicitly mentions recomputation of RMSNorm and MLA up-projections
 * - Megatron-LM / DeepSpeedZeRO tradeoff: memory vs compute
 */
export function calculateTrainingCompute(
  model: ModelConfig,
  hardware: HardwareConfig,
  parallel: ParallelConfig,
  training: TrainingConfig
): CalculationResult {
  // Mixed precision: effective peak is weighted average of FP8 and BF16
  // DeepSeek-V3 uses FP8 for GEMMs (~80%) and BF16 for reductions/normalizations (~20%)
  const bf16Peak = hardware.fp16Tflops;
  const fp8Peak = hardware.fp8Tflops || (bf16Peak * 2);
  const peakTflops = bf16Peak * (1 - training.fp8Ratio) + fp8Peak * training.fp8Ratio;
  
  // Recompute factor: how much extra compute is needed
  // no_recompute (store all activations):       multiplier = 6 (baseline)
  // selective_recompute (recompute attention):  multiplier = 6.5~7
  // full_recompute (recompute everything):      multiplier = 8
  const recomputeMultiplierNoRecompute = 6;
  const recomputeMultiplierSelective = 6.5;
  const recomputeMultiplierFull = 8;
  
  // Get model params
  const modelParams = calcModelParams(model);

  const b = training.batchSize;
  // Training seq length: use explicit override, else cap at 4096 (most models train at 4K-8K even if they support longer)
  const s = training.seqLen || Math.min(model.seqLen, 4096);
  // Per-sample FLOPs (paperMode ≈ 论文简化公式, 忽略 embedding/MTP/attention-score)
  const paperMode = training.paperMode;
  const embeddingFLOPs = paperMode ? 0 : b * s * model.hiddenSize;
  const attnFLOPs = calcAttentionFlops(model, b, s, paperMode);
  const ffnFLOPs = calcFFNFlops(model, b, s);
  const mtpFLOPs = paperMode ? 0 : calcMtpFlops(model, b, s);
  
    // paperMode 校准因子: 论文公式 ≈ 7×P·D 是简化估算, 与精确计算有约 4% 偏差
  const paperCalibrationFactor = training.paperMode ? 0.96 : 1.0;
  
  let forwardPerSample = (embeddingFLOPs + attnFLOPs + ffnFLOPs + mtpFLOPs) * paperCalibrationFactor;
  
  // Training FLOPs per sample: depends on recompute strategy
  const fwdMultiplier = 1;  // forward always runs once
  const bwdMultiplier = 2;  // backward ≈ 2x forward
  const recomputeMultiplier = parallel.optimizationStrategy === 'full_recompute' ? 1.0 :
                              parallel.optimizationStrategy === 'selective_recompute' ? 0.5 :
                              0.0;  // no extra recompute
  
  const totalPerSample = forwardPerSample * (fwdMultiplier + bwdMultiplier + recomputeMultiplier);
  
  // Total training FLOPs
  const totalTokens = training.numTokens * 1e9;  // convert from B (billions)
  const totalIterations = (totalTokens * training.epochs) / (s * b);
  const totalTrainingFLOPs = totalPerSample * totalIterations;
  
  // Group sizes
  const { tp, pp, dp, ep } = parallel;
  const totalGpus = dp * pp * tp;
  const effectiveGpus = totalGpus;  // EP is factored within TP for MoE
  
  // Time per step (single GPU computes 1/tp of params)
  const fwdStepTime = (attnFLOPs + ffnFLOPs + mtpFLOPs + embeddingFLOPs) / (pp * hardware.fp32Tflops * 1e12 * b);
  const bwdStepTime = fwdStepTime * 2;  // backward ≈ 2x forward
  const mf = training.mfu;
  
  // ===== MFU model =====
  // MFU (slider): 端到端有效利用率 (与论文一致)
  // 论文中的 MFU 是 holistic 测量值, 已包含 bubble/uptime/comm 所有开销
  const effectiveMFU = training.mfu;
  // Bubble/uptime 参数仅用于分解展示, 不参与时间计算 (它们已包含在 MFU 中)
  const ppStages = parallel.pp;
  const gradAccum = training.gradAccumSteps;
  const microbatches = Math.max(ppStages, ppStages * gradAccum);
  const bubbleFraction = ppStages > 1 ? (ppStages - 1) / (microbatches + ppStages - 1) : 0;
  const clusterUptime = training.clusterUptime;
  // 估算对应的 "Core GPU MFU" 用于参考展示
  const coreMFU = effectiveMFU / ((1 - bubbleFraction) * clusterUptime);
  
  // Time calc uses BF16 peak × effectiveMFU (holistic, matches paper convention)
  // All GPUs (TP × PP × DP) contribute to parallel compute
  const effectiveComputePerGpu = hardware.fp16Tflops * effectiveMFU * 1e12;
  const perIterSec = totalPerSample / (totalGpus * effectiveComputePerGpu);
  
  // Communication time estimate
  const allGatherSec = calcAllGatherTime(model, hardware, parallel, s);
  const allReduceSec = calcAllReduceTime(model, hardware, parallel);
  const p2pSec = calcP2pTime(model, hardware, parallel, s);
  const allToAllSec = model.type === 'moe' ? calcAllToAllTime(model, hardware, parallel, s) : 0;
  
  const totalCommSec = allGatherSec + allReduceSec + p2pSec + allToAllSec;
  const commFraction = totalCommSec / (perIterSec + totalCommSec);
  
  // ===== Time Decomposition =====
  // perIterSec = actual wall-clock per iteration (uses holistic effectiveMFU)
  // Total time includes both compute and communication
  const perIterTotalSec = perIterSec + totalCommSec;
  const wallClockSec = totalIterations * perIterTotalSec;
  const wallClockHours = wallClockSec / 3600;
  // Theoretical decomposition (for illustration only):
  // - computeHours: time if GPU ran at 100% (baseline, theoretical)
  // - What % of MFU is lost to bubble vs other factors
  const computeHours = wallClockHours * effectiveMFU;  // theoretical compute time at 100% utilization
  const computeDays = computeHours / 24;
  const postBubbleHours = computeHours / (bubbleFraction > 0 ? (1 - bubbleFraction) : 1);
  const bubbleHours = postBubbleHours - computeHours;
  const downtimeHours = wallClockHours - postBubbleHours;
  const totalTrainingHours = wallClockHours;
  const totalTrainingDays = totalTrainingHours / 24;
  

  
  // Memory per GPU
  const memResult = calcMemory(model, parallel, training, hardware.memoryGb);
  
  return {
    modelParams,
    flops: {
      forwardPerToken: forwardPerSample / (b * s),
      backwardPerToken: forwardPerSample * 2 / (b * s),
      totalPerToken: totalPerSample / (b * s),
      forwardPerSample: forwardPerSample,
      totalPerSample,
      totalTraining: totalTrainingFLOPs,
      mfuEffective: mf * peakTflops * totalGpus * 1e12,
    },
    memory: memResult,
    time: {
      forwardStep: fwdStepTime / mf,
      backwardStep: bwdStepTime / mf,
      perIteration: perIterSec + totalCommSec,
      totalIterations,
      computeHours,
      computeDays,
      totalTrainingHours,
      totalTrainingDays,
      effectiveHours: wallClockHours,
      effectiveDays: wallClockHours / 24,
      downtimeHours,
      clusterUptime,
      bubbleFraction,
      bubbleHours,
      bubbleDays: bubbleHours / 24,
      coreMFU,
      effectiveMFU,
    },
    cluster: {
      totalGpus,
      numNodes: Math.ceil(totalGpus / 8),
      dpSize: dp,
    },
    communication: {
      allGatherTime: allGatherSec,
      allReduceTime: allReduceSec,
      p2pTime: p2pSec,
      allToAllTime: allToAllSec,
      totalCommFraction: Math.min(commFraction, 0.5),
    },
    phaseInfo: {
      name: PHASE_CONFIGS[training.phase].name,
      relativeCost: PHASE_CONFIGS[training.phase].relativeCompute,
      description: PHASE_CONFIGS[training.phase].description,
    },
  };
}

// ============================================================
// Communication Time Calculations
// ============================================================

function calcAllGatherTime(model: ModelConfig, hw: HardwareConfig, par: ParallelConfig, trainSeqLen: number): number {
  const d = model.hiddenSize;
  const s = trainSeqLen;
  const L = model.numLayers;
  const { pp, tp } = par;
  
  // TP AllGather: 4 matrices (Q,K,V,O) per layer, each [s, d] in BF16
  const layersPerStage = L / pp;
  const msgSize = 4 * s * d * 2 * layersPerStage;  // bytes (BF16 = 2 bytes)
  // AllGather across TP: (tp-1)/tp * msgSize / bandwidth
  return (tp - 1) / tp * msgSize / (hw.busBandwidthGbs * 1e9);
}

function calcAllReduceTime(model: ModelConfig, hw: HardwareConfig, par: ParallelConfig): number {
  const params = calcModelParams(model);
  const gradSizeBytes = params.total * 2 / par.tp / par.pp / par.dp;  // BF16
  // Ring all-reduce: 2*(N-1)/N × data / bandwidth
  const ringTime = 2 * (par.dp - 1) / par.dp * gradSizeBytes / (hw.networkBandwidthGbs * 1e9);
  return ringTime;
}

function calcP2pTime(model: ModelConfig, hw: HardwareConfig, par: ParallelConfig, trainSeqLen: number): number {
  if (par.pp <= 1) return 0;
  const d = model.hiddenSize;
  const s = trainSeqLen;
  // Pipeline P2P: send activation tensor [s, d] in BF16 per micro-batch
  const msgSize = s * d * 2;  // bytes
  return msgSize / (hw.networkBandwidthGbs * 1e9);
}

function calcAllToAllTime(model: ModelConfig, hw: HardwareConfig, par: ParallelConfig, trainSeqLen: number): number {
  if (model.type !== 'moe' || !model.numRoutedExperts) return 0;
  const d = model.hiddenSize;
  const s = trainSeqLen;
  const numMoeLayers = (model.numLayers - (model.firstKDenseLayers || 0));
  // All-to-all: send tokens to expert nodes, per MoE layer
  const msgSize = 2 * d * s * 2 * numMoeLayers;  // BF16 activations
  const nNodes = Math.max(par.ep, 1);
  return 2 * (nNodes - 1) / nNodes * msgSize / (hw.networkBandwidthGbs * 1e9);
}

// ============================================================
// Memory Calculations
// ============================================================

function calcMemory(
  model: ModelConfig, 
  par: ParallelConfig, 
  training: TrainingConfig,
  hwMemoryGb: number
) {
  const { tp, pp, dp, ep } = par;
  const s = training.seqLen || Math.min(model.seqLen, 4096);  // effective training seq length
  const microBatch = training.batchSize / dp;
  const d = model.hiddenSize;
  const L = model.numLayers;
  const nh = model.numAttentionHeads;
  const dh = model.headDim || (d / nh);
  
  const layersPerDevice = L / pp;
  
  // === Per-layer attention params (TP-split) ===
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
  
  // === Per-FP param calculation ===
  let paramsPerGpu = (attnPerLayer * L) / (pp * tp);
  
  const moeLayers = L - (model.firstKDenseLayers || 0);
  if (model.type === 'moe' && model.numRoutedExperts) {
    // MoE: shared + routed experts (routed split by EP)
    const moeInter = model.moeIntermediateSize || 2048;
    const nShared = model.numSharedExperts || 1;
    const nRouted = model.numRoutedExperts;
    const expertParams = 3 * d * moeInter;
    paramsPerGpu += (expertParams * nShared * moeLayers) / (pp * tp);
    paramsPerGpu += (expertParams * nRouted * moeLayers) / (pp * tp * Math.max(ep, 1));
    paramsPerGpu += (d * nRouted * moeLayers) / (pp * tp);
  } else {
    // Dense FFN (SwiGLU: gate_proj + up_proj + down_proj)
    const inter = model.intermediateSize || d * 3;
    paramsPerGpu += (3 * d * inter * L) / (pp * tp);
  }
  
  // Embedding: split across TP (Megatron parallel embedding)
  paramsPerGpu += model.hiddenSize * model.vocabSize / tp;
  
  // === Memory breakdown ===
  const optimizerBytes = 12 * paramsPerGpu;  // Adam: FP32 master + momentum + variance
  // 权重: FP8训练=1字节/参数, BF16训练/推理=2字节/参数
  const weightBytesPerParam = training.precision === 'fp8' ? 1 : 2;
  const weightBytes = weightBytesPerParam * paramsPerGpu;
  const gradientBytes = 2 * paramsPerGpu;     // BF16 gradients
  
  // === Activation memory ===
  let activationBytes: number;
  const recomputeFactor = par.optimizationStrategy === 'full_recompute' ? 0.05 :
                          par.optimizationStrategy === 'selective_recompute' ? 0.15 : 1.0;
  
  if (model.attentionType === 'mla') {
    // MLA: compressed latent activation (very small!)
    // Stores c_kv + c_q per token per layer
    const kvRank = model.kvLoraRank!;
    activationBytes = layersPerDevice * s * microBatch * kvRank * 2 * recomputeFactor * 5;
  } else {
    // Dense attention (GQA/MHA): stores full activation per token
    // Includes: residual, layernorm, attention QKV output, FFN intermediate
    // Factor accounts for: 10 base ops, 24/tp for head split, 5*nh*s/d for attention matrix
    const baseFactor = 10 + 24 / tp + 5 * nh * s / d;
    activationBytes = layersPerDevice * s * microBatch * d * baseFactor / tp * recomputeFactor;
  }
  
  const total = optimizerBytes + weightBytes + gradientBytes + activationBytes;
  const totalGiB = total / (1024 * 1024 * 1024);  // 内存用 GiB (1024³)
  const budgetGiB = hwMemoryGb * (training.precision === 'fp8' ? 0.85 : 0.80);
  
  return {
    optimizer: optimizerBytes,
    weights: weightBytes,
    gradients: gradientBytes,
    activation: activationBytes,
    total,
    totalGb: totalGiB,
    withinBudget: budgetGiB - totalGiB,
  };
}

// ============================================================
// Parallelism Recommendation
// ============================================================

export function recommendParallelism(
  model: ModelConfig,
  hardware: HardwareConfig,
  totalGpus: number
): ParallelConfig {
  const params = calcModelParams(model);
  const activated = params.activatedPerToken;
  
  // Pipeline Parallelism 策略:
  // - PP 决定模型在多少层上被切分 (受 numLayers 限制)
  // - TP 决定张量并行度 (受单节点 GPU 数限制, 通常 8)
  // - 合理的 PP 范围: 1(小模型) → 8-16(大模型)
  
  let tp = 1, pp = 1, ep = 1;
  
  if (activated < 10e9) {
    // 小模型: 无需 PP, TP 覆盖所有 GPU
    tp = Math.min(totalGpus, 8);
    pp = 1;
  } else if (activated < 50e9) {
    // 中等模型 (10-50B): PP=4, TP=8
    tp = 8;
    pp = 4;
  } else {
    // 超大模型: PP=8, TP=8
    tp = 8;
    pp = 8;
  }

  // 关键修正: 如果 tp * pp > totalGpus，降低 PP 以适配可用 GPU
  // 例如: 72B 模型默认 pp=8, tp=8 (需64卡), 若只有32卡则 pp→4
  while (tp * pp > totalGpus && pp > 1) {
    pp--;
  }

  // PP 不能超过模型层数
  pp = Math.min(pp, model.numLayers);

  // MoE 模型必须设置 EP (Expert Parallelism) 否则所有 expert 都存储在单 GPU 上
  if (model.type === 'moe' && model.numRoutedExperts) {
    const maxEp = Math.min(model.numRoutedExperts, totalGpus / pp / tp);
    ep = Math.max(1, maxEp);
    // EP 也不能超过 expert 总数或 GPU 数量限制
    ep = Math.min(ep, model.numRoutedExperts || 1, totalGpus / (pp * tp));
  }

  const dp = totalGpus / (tp * pp);
  
  // Check memory per GPU to determine recompute strategy
  const memPerGpu = params.activatedPerToken * 16 / tp / pp / 1e9;  // bytes to GB
  const strategy: ParallelConfig['optimizationStrategy'] = 
    memPerGpu > hardware.memoryGb * 0.7 ? 'full_recompute' :
    memPerGpu > hardware.memoryGb * 0.5 ? 'selective_recompute' : 'no_recompute';
  
  return {
    tp,
    pp,
    dp: Math.max(1, Math.floor(dp)),
    ep,
    microBatchSize: model.type === 'dense'
      ? Math.max(1, Math.min(4, Math.floor(256 / dp)))  // Dense: small micro-batch (1-4)
      : Math.max(1, Math.floor(15360 / dp)),             // MoE: DeepSeek-style large batch
    optimizationStrategy: strategy,
    };
}

// ============================================================
// Memory-Constrained Recommendations
// ============================================================

/**
 * 计算指定 GPU 数量下能容纳的最大 batch size (选择性重算)
 * 返回 {maxBatch, memoryGB}
 */
export function calcMaxBatchSize(
  model: ModelConfig,
  hardware: HardwareConfig,
  training: TrainingConfig,
  totalGpus: number,
  pp?: number,
  recomputeStrategy: ParallelConfig['optimizationStrategy'] = 'selective_recompute'
): { maxBatch: number; memoryGB: number; dp: number } {
  const rcFactor = recomputeStrategy === 'full_recompute' ? 0.05 :
                   recomputeStrategy === 'selective_recompute' ? 0.15 : 1.0;
  const budgetBytes = hardware.memoryGb * 1e9 * (training.precision === 'fp8' ? 0.85 : 0.80);
  
  let bestResult = { maxBatch: 0, memoryGB: Infinity, dp: 1 };
  const s = training.seqLen || Math.min(model.seqLen, 4096);  // effective training seq length
  
  const ppList = pp ? [pp] : [1, 2, 4, 8, 16];
  
  for (const ppVal of ppList) {
    if (ppVal > model.numLayers) continue;
    const layersPerDevice = model.numLayers / ppVal;
    const tp = 8;
    if (totalGpus < ppVal * tp) continue;
    if (totalGpus % (ppVal * tp) !== 0) continue;
    const dp = totalGpus / (ppVal * tp);
    
    const params = calcModelParams(model);
    const ep = Math.min(model.numRoutedExperts || 1, Math.max(1, dp));
    const expertParams = 3 * model.hiddenSize * (model.moeIntermediateSize || 2048);
    const moeLayers = model.numLayers - (model.firstKDenseLayers || 0);
    
    let paramsPerGpu = ((params.embedding + params.positionEmbedding) / tp + params.attentionPerLayer * model.numLayers / (ppVal * tp));
    if (model.type === 'moe') {
      paramsPerGpu += (expertParams * (model.numSharedExperts || 1) * moeLayers) / (ppVal * tp);
      paramsPerGpu += (expertParams * (model.numRoutedExperts || 1) * moeLayers) / (ppVal * tp * ep);
      paramsPerGpu += (model.hiddenSize * (model.numRoutedExperts || 1) * moeLayers) / (ppVal * tp);
    } else {
      paramsPerGpu += (3 * model.hiddenSize * (model.intermediateSize || model.hiddenSize * 3) * model.numLayers) / (ppVal * tp);
    }
    
    const nonActBytes = 16 * paramsPerGpu; // 12 (optim) + 2 (weight) + 2 (grad)
    const actBudgetBytes = budgetBytes - nonActBytes;
    
    if (actBudgetBytes <= 0) continue;
    
    // Activation per-token: MLA uses tiny compressed latent (kvRank), Dense uses full hidden size
    const perTokenBytes = model.attentionType === 'mla'
      ? model.kvLoraRank! * 2 * rcFactor * 5
      : (model.hiddenSize * (10 + 24/tp + 5 * model.numAttentionHeads * s / model.hiddenSize) / tp) * 2 * rcFactor;
    
    const maxMicroBatch = Math.floor(actBudgetBytes / (layersPerDevice * s * perTokenBytes));
    const maxBatchSeqs = maxMicroBatch * dp;  // 全局 batch = 每 DP 序列数 × DP 并行度
    
    if (maxBatchSeqs <= 0) continue;
    
    const actualActBytes = layersPerDevice * s * (maxBatchSeqs / dp) * perTokenBytes;
    const totalMemBytes = nonActBytes + actualActBytes;
    
    if (maxBatchSeqs > bestResult.maxBatch) {
      bestResult = { maxBatch: maxBatchSeqs, memoryGB: totalMemBytes / 1e9, dp };
    }
  }
  
  return bestResult;
}

/**
 * 计算给定 batch size 下需要的最少 GPU 数量 (选择性重算)
 * 返回 {minGpus, optimalPP, optimalDp}
 */
export function calcMinGpus(
  model: ModelConfig,
  hardware: HardwareConfig,
  training: TrainingConfig,
  batchSize: number,
  recomputeStrategy: ParallelConfig['optimizationStrategy'] = 'selective_recompute'
): { minGpus: number; optimalPP: number; optimalDp: number; memoryGB: number } {
  const rcFactor = recomputeStrategy === 'full_recompute' ? 0.05 :
                   recomputeStrategy === 'selective_recompute' ? 0.15 : 1.0;
  const budgetBytes = hardware.memoryGb * 1e9 * (training.precision === 'fp8' ? 0.85 : 0.80);
  const tp = 8;
  
  let best = { minGpus: 0, optimalPP: 0, optimalDp: 0, memoryGB: Infinity };
  const s = training.seqLen || Math.min(model.seqLen, 4096);  // effective training seq length
  
  for (let totalGpus = 8; totalGpus <= 8192; totalGpus *= 2) {
    for (const pp of [1, 2, 4, 8, 16]) {
      if (pp > model.numLayers) continue;
      if (totalGpus < pp * tp) continue;
      if (totalGpus % (pp * tp) !== 0) continue;
      const dp = totalGpus / (pp * tp);
      if (!Number.isInteger(dp)) continue;
      if (dp < 1) continue;
      
      const layersPerDevice = model.numLayers / pp;
      const ep = Math.min(model.numRoutedExperts || 1, Math.max(1, dp));
      const expertParams = 3 * model.hiddenSize * (model.moeIntermediateSize || 2048);
      const moeLayers = model.numLayers - (model.firstKDenseLayers || 0);
      
      const params = calcModelParams(model);
      let paramsPerGpu = ((params.embedding + params.positionEmbedding) / tp + params.attentionPerLayer * model.numLayers / (pp * tp));
      if (model.type === 'moe') {
        paramsPerGpu += (expertParams * (model.numSharedExperts || 1) * moeLayers) / (pp * tp);
        paramsPerGpu += (expertParams * (model.numRoutedExperts || 1) * moeLayers) / (pp * tp * ep);
        paramsPerGpu += (model.hiddenSize * (model.numRoutedExperts || 1) * moeLayers) / (pp * tp);
      } else {
        paramsPerGpu += (3 * model.hiddenSize * (model.intermediateSize || model.hiddenSize * 3) * model.numLayers) / (pp * tp);
      }
      
      const nonActBytes = 16 * paramsPerGpu;
      const microBatch = batchSize / dp;
      
      // Activation per-token: MLA uses tiny compressed latent (kvRank), Dense uses full hidden size
      const perTokenBytes = model.attentionType === 'mla'
        ? model.kvLoraRank! * 2 * rcFactor * 5
        : (model.hiddenSize * (10 + 24/tp + 5 * model.numAttentionHeads * s / model.hiddenSize) / tp) * 2 * rcFactor;
      
      const actBytes = layersPerDevice * s * microBatch * perTokenBytes;
      const totalMemBytes = nonActBytes + actBytes;
      
      if (totalMemBytes <= budgetBytes && best.minGpus === 0) {
        best = { minGpus: totalGpus, optimalPP: pp, optimalDp: dp, memoryGB: totalMemBytes / 1e9 };
        return best;
      }
    }
  }
  
  return best;
}
// ============================================================

export function formatNumber(n: number, decimals = 2): string {
  if (n >= 1e15) return (n / 1e15).toFixed(decimals) + ' PFLOPs';
  if (n >= 1e12) return (n / 1e12).toFixed(decimals) + ' TFLOPs';
  if (n >= 1e9) return (n / 1e9).toFixed(decimals) + ' BF';
  if (n >= 1e6) return (n / 1e6).toFixed(decimals) + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(decimals) + ' K';
  return n.toFixed(decimals);
}

export function formatParams(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return n.toString();
}

export function formatTime(hours: number): string {
  if (hours >= 8760) return (hours / 8760).toFixed(1) + ' 年';
  if (hours >= 24) return (hours / 24).toFixed(1) + ' 天';
  return hours.toFixed(1) + ' 小时';
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes.toFixed(0) + ' B';
}
