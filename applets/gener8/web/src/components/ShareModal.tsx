// @ts-nocheck
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Link, Check } from 'lucide-react';
import { Song } from '../types';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song;
}

const XIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const TikTokIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.88 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.28 0 .56.04.82.1v-3.5a6.37 6.37 0 00-.82-.05A6.34 6.34 0 003.15 15.65a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.41a8.16 8.16 0 004.76 1.52v-3.4a4.85 4.85 0 01-1-.84z" />
  </svg>
);

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
);

const PinterestIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
  </svg>
);

const SnapchatIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12.922-.214.12-.042.218-.075.268-.08.134-.01.268.012.395.06.193.065.335.19.436.375.073.137.11.302.11.497-.002.432-.316.717-.653.933a2.44 2.44 0 01-.409.21 5.06 5.06 0 01-.536.173c-.054.015-.106.031-.139.043-.09.03-.27.099-.357.211-.069.089-.081.2-.036.34.297.877.663 1.65 1.248 2.295.27.297.555.551.867.786.263.198.551.37.854.519.12.061.281.113.446.167.41.136.886.294.986.665.075.276-.034.558-.245.8-.395.44-1.076.613-1.645.766a6.41 6.41 0 01-.295.08c-.11.033-.21.062-.273.098-.113.064-.155.14-.163.216-.012.118.06.244.097.306l.017.03c.232.398.42.78.354 1.12-.064.33-.372.549-.93.665-1.08.225-1.834.345-2.37.77-.473.375-.862.963-1.364 1.712l-.006.01c-.43.643-1.076 1.053-1.796 1.053h-.06c-.71 0-1.36-.407-1.795-1.053l-.006-.01c-.502-.749-.89-1.337-1.364-1.712-.535-.425-1.29-.545-2.37-.77-.557-.116-.865-.335-.929-.665-.066-.34.122-.722.354-1.12l.017-.03c.037-.062.11-.188.097-.306-.008-.076-.05-.152-.163-.216a1.73 1.73 0 00-.273-.098 6.41 6.41 0 01-.295-.08c-.57-.153-1.25-.326-1.645-.766-.211-.242-.32-.524-.245-.8.1-.371.575-.529.986-.665.165-.054.326-.106.446-.167.303-.149.591-.321.854-.519.312-.235.597-.489.867-.786.585-.644.951-1.418 1.248-2.295.045-.14.033-.251-.036-.34-.087-.112-.268-.18-.357-.211a3.74 3.74 0 01-.139-.043 5.06 5.06 0 01-.536-.173 2.44 2.44 0 01-.409-.21c-.337-.216-.651-.501-.653-.933 0-.195.037-.36.11-.497.1-.185.243-.31.436-.375a1.15 1.15 0 01.395-.06c.05.005.148.038.268.08.263.094.623.23.922.214.198 0 .326-.045.401-.09a9.97 9.97 0 01-.03-.51l-.003-.06c-.104-1.628-.23-3.654.3-4.847C7.86 1.069 11.216.793 12.206.793z" />
  </svg>
);

const EmailIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, song }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // In Tauri desktop, window.location.origin is tauri://localhost or similar,
  // not a public URL. Always use the public site for share links.
  const shareUrl = `https://s3studio.xyz/song/${song.id}`;

  const twitterText = `Just created "${song.title}" with S\u00b3 Sound Studio ${song.style ? `#${song.style.replace(/[^a-zA-Z0-9]/g, '')}` : ''} #AIMusic #StrandsNation`;
  const facebookText = `"${song.title}" ${song.style ? `(${song.style})` : ''} - Made with S\u00b3 Sound Studio`;
  const telegramText = `"${song.title}" by ${song.creator || 'Unknown Artist'}\n${song.style ? `${song.style}` : ''}\n\nMade with S\u00b3 Sound Studio`;
  const youtubeDesc = `${song.title} - ${song.style || 'AI Generated Music'}\n\nCreated with S\u00b3 Strands Sound Studio\n#AIMusic #StrandsNation`;

  const handleShareX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'width=550,height=420');
  };

  const handleShareFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(facebookText)}`;
    window.open(url, '_blank', 'width=550,height=420');
  };

  const handleShareTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(telegramText)}`;
    window.open(url, '_blank');
  };

  const handleShareYouTube = () => {
    // YouTube doesn't have a direct share-with-text URL, so we open upload page
    // and copy the description to clipboard for them
    navigator.clipboard.writeText(youtubeDesc).catch(() => {});
    window.open('https://www.youtube.com/upload', '_blank');
  };

  const handleShareInstagram = () => {
    // Instagram doesn't support URL sharing via web; copy caption to clipboard and open
    const caption = `"${song.title}" ${song.style ? `#${song.style.replace(/[^a-zA-Z0-9]/g, '')}` : ''} #AIMusic #StrandsNation #S3Studio`;
    navigator.clipboard.writeText(caption).catch(() => {});
    window.open('https://www.instagram.com/', '_blank');
  };

  const handleShareTikTok = () => {
    // TikTok doesn't support direct web sharing; copy caption and open
    const caption = `"${song.title}" ${song.style ? `#${song.style.replace(/[^a-zA-Z0-9]/g, '')}` : ''} #AIMusic #StrandsNation #S3Studio`;
    navigator.clipboard.writeText(caption).catch(() => {});
    window.open('https://www.tiktok.com/upload', '_blank');
  };

  const handleSharePinterest = () => {
    const description = `"${song.title}" - ${song.style || 'AI Generated Music'} | Made with S³ Strands Sound Studio`;
    const url = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(shareUrl)}&description=${encodeURIComponent(description)}`;
    window.open(url, '_blank', 'width=550,height=420');
  };

  const handleShareSnapchat = () => {
    // Snapchat creative kit web share
    const url = `https://www.snapchat.com/scan?attachmentUrl=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank');
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent(`Check out this AI track: ${song.title}`);
    const body = encodeURIComponent(`Hey!\n\n"${song.title}" by ${song.creator || 'Unknown Artist'}\n${song.style ? `Style: ${song.style}` : ''}\n\nListen: ${shareUrl}\n\nMade with S\u00b3 Strands Sound Studio`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 dark:bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Share</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-6 p-3 bg-zinc-50 dark:bg-black/30 rounded-xl">
          {song.coverUrl ? (
            <img src={song.coverUrl} alt={song.title} className="w-12 h-12 rounded-lg object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-accent-500 to-purple-500" />
          )}
          <div className="overflow-hidden">
            <div className="font-medium text-zinc-900 dark:text-white truncate">{song.title || 'Untitled'}</div>
            <div className="text-sm text-zinc-500 truncate">{song.style || 'No style'}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <button
            onClick={handleShareX}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-black text-white hover:bg-zinc-800 transition-colors"
            title="Share on X"
          >
            <XIcon />
            <span className="text-xs font-medium">X</span>
          </button>

          <button
            onClick={handleShareTikTok}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-black text-white hover:bg-zinc-800 transition-colors"
            title="Share on TikTok"
          >
            <TikTokIcon />
            <span className="text-xs font-medium">TikTok</span>
          </button>

          <button
            onClick={handleShareInstagram}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white hover:opacity-90 transition-opacity"
            title="Share on Instagram"
          >
            <InstagramIcon />
            <span className="text-xs font-medium">Instagram</span>
          </button>

          <button
            onClick={handleShareFacebook}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#1877F2] text-white hover:bg-[#166FE5] transition-colors"
            title="Share on Facebook"
          >
            <FacebookIcon />
            <span className="text-xs font-medium">Facebook</span>
          </button>

          <button
            onClick={handleShareTelegram}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#0088CC] text-white hover:bg-[#0077B5] transition-colors"
            title="Share on Telegram"
          >
            <TelegramIcon />
            <span className="text-xs font-medium">Telegram</span>
          </button>

          <button
            onClick={handleShareYouTube}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#FF0000] text-white hover:bg-[#CC0000] transition-colors"
            title="Upload to YouTube"
          >
            <YouTubeIcon />
            <span className="text-xs font-medium">YouTube</span>
          </button>

          <button
            onClick={handleSharePinterest}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#E60023] text-white hover:bg-[#CC001F] transition-colors"
            title="Share on Pinterest"
          >
            <PinterestIcon />
            <span className="text-xs font-medium">Pinterest</span>
          </button>

          <button
            onClick={handleShareSnapchat}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#FFFC00] text-black hover:bg-[#E6E300] transition-colors"
            title="Share on Snapchat"
          >
            <SnapchatIcon />
            <span className="text-xs font-medium">Snapchat</span>
          </button>

          <button
            onClick={handleShareEmail}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-zinc-600 dark:bg-zinc-700 text-white hover:bg-zinc-700 dark:hover:bg-zinc-600 transition-colors"
            title="Share via Email"
          >
            <EmailIcon />
            <span className="text-xs font-medium">Email</span>
          </button>

          <button
            onClick={handleCopyLink}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
            title="Copy Link"
          >
            {copied ? <Check size={20} className="text-green-500" /> : <Link size={20} />}
            <span className="text-xs font-medium">{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};
