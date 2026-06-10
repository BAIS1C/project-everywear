export type TourPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';

export interface TourStep {
  id: string;
  selector: string | null;
  placement?: TourPlacement;
  eyebrow: string;
  title: string;
  body: string;
  cta?: string;
}

export interface TourManifest {
  id: string;
  title: string;
  steps: TourStep[];
}

export const FIRST_RUN_TOUR: TourManifest = {
  id: 'first-run',
  title: 'Everywear first run',
  steps: [
    {
      id: 'home',
      selector: '.ew-desktop',
      placement: 'center',
      eyebrow: 'Home Node',
      title: 'This is the local desktop',
      body: 'Everywear starts from the shell: local applets, model state, Vault receipts, profile, Settings, and report tools stay in one OS surface.',
      cta: 'Start tour',
    },
    {
      id: 'my-mait',
      selector: 'button[data-applet-id="kasai"]',
      placement: 'right',
      eyebrow: 'Companion',
      title: 'My Mait is the front door',
      body: 'My Mait is the local companion chassis. Avatar Studio can now send a verified Drophunter Blank into the My Mait companion store.',
    },
    {
      id: 's3-folder',
      selector: 'button[aria-label="S3 Studio folder"]',
      placement: 'right',
      eyebrow: 'Creative suite',
      title: 'S3 Studio is a folder',
      body: 'Gener8, Gener8 Pro, Vid, AI Director, and DAW live inside this suite. The tour only promises flows that have native receipts.',
    },
    {
      id: 'gener8',
      selector: 'button[aria-label="S3 Studio folder"]',
      placement: 'right',
      eyebrow: 'Verified creative win',
      title: 'Create your first song',
      body: 'Gener8 4ever is verified for the basic path: name a song, describe the style, create it, register it in Vault, and play the local MP3.',
    },
    {
      id: 'vault',
      selector: 'button[aria-label="Open Vault"]',
      placement: 'left',
      eyebrow: 'Receipt layer',
      title: 'Vault proves what happened',
      body: 'Everywear Vault is the receipt surface for generated songs, stems, references, images, videos, and logs. Use it to confirm outputs became records.',
    },
    {
      id: 'settings',
      selector: 'button[aria-label="Open Settings"]',
      placement: 'left',
      eyebrow: 'Own the shell',
      title: 'Settings changes the whole OS',
      body: 'Themes, accents, density, chrome, wallpaper, and surface treatment are shell-wide so applets feel like one product, not loose tools.',
    },
    {
      id: 'setup-surfaces',
      selector: 'button[data-applet-id="1magen"]',
      placement: 'right',
      eyebrow: 'Setup truth',
      title: 'Some engines are setup-safe only',
      body: '1magen opens safely while runtime handoff is pending. DAW, Vid, and 3nvizen are also tourable, but their blocked runtime/export paths are not first-run promises yet.',
    },
    {
      id: 'done',
      selector: '.ew-taskbar',
      placement: 'top',
      eyebrow: 'Orientation complete',
      title: 'You know the map',
      body: 'Start with My Mait, make a song in Gener8, prove it in Vault, then branch into the Creator Studio surfaces as their runtimes come online.',
      cta: 'Finish',
    },
  ],
};
