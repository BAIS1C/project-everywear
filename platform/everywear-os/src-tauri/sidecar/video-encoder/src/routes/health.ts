import { Router } from 'express';
import type { EncoderInfo } from '../detect-gpu.js';
import type { SystemProfile } from '../detect-gpu.js';
import { getAllEncoders } from '../detect-gpu.js';

export function createHealthRouter(encoderInfo: EncoderInfo, system: SystemProfile): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      encoder: encoderInfo.encoder,
      label: encoderInfo.label,
      gpu: encoderInfo.gpu,
      hardware: encoderInfo.hardware,
      threads: encoderInfo.hardware
        ? system.gpuEncodeThreads
        : system.cpuEncodeThreads,
      uptime: process.uptime(),
    });
  });

  router.get('/capabilities', (_req, res) => {
    const encoders = getAllEncoders();
    res.json({
      active: encoderInfo,
      system: {
        logicalCores: system.logicalCores,
        physicalCores: system.physicalCores,
        totalMemoryGB: system.totalMemoryGB,
        vramGB: system.vramGB,
        platform: system.platform,
        threadBudgets: {
          gpuEncode: system.gpuEncodeThreads,
          cpuEncode: system.cpuEncodeThreads,
          museMax: system.museMaxThreads,
        },
      },
      encoders,
    });
  });

  return router;
}
