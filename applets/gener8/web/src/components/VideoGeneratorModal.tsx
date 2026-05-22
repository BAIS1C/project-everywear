import type React from 'react';
import { VideoGeneratorModal as SharedVideoGeneratorModal, type VideoModalSong, type VideoModalTier } from '@everywear/video-modal';
import { vaultRegisterVideo } from '@everywear/transport';
import { useAuth } from '../context/AuthContext';
import type { Song } from '../types';

interface VideoGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
  embedded?: boolean;
}

export const VideoGeneratorModal: React.FC<VideoGeneratorModalProps> = (props) => {
  const { tier } = useAuth();

  return (
    <SharedVideoGeneratorModal
      {...props}
      song={props.song as VideoModalSong | null}
      tier={tier as VideoModalTier}
      vaultTag="gener8"
      registerVideo={vaultRegisterVideo}
    />
  );
};