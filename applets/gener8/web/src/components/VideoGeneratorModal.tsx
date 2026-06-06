import type React from 'react';
import {
  VideoGeneratorModal as SharedVideoGeneratorModal,
  type VideoModalSong,
  type VideoModalTier,
  type VaultVideoRegistration,
} from '@everywear/video-modal';
import { vaultRegisterVideo } from '@everywear/transport';
import { useResponsive } from '../context/ResponsiveContext';
import { useAuth } from '../context/AuthContext';
import type { Song } from '../types';
import { getApiBase } from '../services/api';
import { showToast } from './ToastHost';

interface VideoGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
  /** When true, renders inline (no fixed overlay/backdrop). Used by VidApp. */
  embedded?: boolean;
}

export const VideoGeneratorModal: React.FC<VideoGeneratorModalProps> = (props) => {
  const { isMobile } = useResponsive();
  const { tier, hasTier, isTrialActive, canRemoveWatermark } = useAuth();

  const handleToast = (
    msg: string | { kind: string; message: string; durationMs?: number },
  ) => {
    if (typeof msg === 'string') {
      showToast({ message: msg });
      return;
    }

    showToast({
      kind: msg.kind as Parameters<typeof showToast>[0]['kind'],
      message: msg.message,
      durationMs: msg.durationMs,
    });
  };

  const registerVideo = async (payload: VaultVideoRegistration) => {
    await vaultRegisterVideo({
      title: payload.title,
      filePath: payload.filePath,
      durationSeconds: payload.durationSeconds,
      generationMode: 'gener8_visualizer',
      prompt: props.song?.title || payload.title,
      hasAudio: true,
      tags: ['gener8', 'video'],
      sourceAppId: 'gener8',
      appletScope: 'gener8',
      libraryScope: 'videos',
    });
  };

  return (
    <SharedVideoGeneratorModal
      {...props}
      song={props.song as VideoModalSong | null}
      tier={tier as VideoModalTier}
      vaultTag="gener8"
      registerVideo={registerVideo}
      isMobile={isMobile}
      proEnabled={hasTier('vid_pro')}
      isTrialActive={isTrialActive}
      canRemoveWatermark={canRemoveWatermark}
      apiBase={getApiBase()}
      gpuSaveMode="save-from-encoder"
      registerCpuExport={false}
      onToast={handleToast}
    />
  );
};
