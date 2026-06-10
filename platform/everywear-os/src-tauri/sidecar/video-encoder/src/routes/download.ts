import { Router } from 'express';
import { getOutputPath, getSession, scheduleCleanup } from '../encoder.js';

export function createDownloadRouter(): Router {
  const router = Router();

  router.get('/download/:id', (req, res) => {
    const { id } = req.params;
    const session = getSession(id);

    if (!session) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    if (session.stage !== 'complete') {
      res.status(409).json({ error: 'Encoding not yet complete', stage: session.stage });
      return;
    }

    const outputPath = getOutputPath(id);
    if (!outputPath) {
      res.status(404).json({ error: 'Output file not found' });
      return;
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="s3-video-${id.slice(0, 8)}.mp4"`);

    res.sendFile(outputPath, (err) => {
      if (err) {
        console.error(`[S³ Download] Error for ${id.slice(0, 8)}:`, err);
      }
      scheduleCleanup(id);
    });
  });

  return router;
}
